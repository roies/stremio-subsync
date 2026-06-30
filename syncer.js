'use strict';

const { spawn } = require('child_process');
const { createWriteStream, promises: fs } = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const CACHE_DIR = path.join(os.tmpdir(), 'subsync-cache');

async function downloadFile(url, dest, fetchFn) {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} downloading ${url}`);
  await new Promise((resolve, reject) => {
    const out = createWriteStream(dest);
    res.body.pipe(out);
    res.body.on('error', reject);
    out.on('finish', resolve);
  });
}

function runFfsubsync(videoPath, subPath, outPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffsubsync', [videoPath, '-i', subPath, '-o', outPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`ffsubsync exited ${code}: ${stderr.trim()}`));
    });
    proc.on('error', err => reject(new Error(`Failed to start ffsubsync: ${err.message}`)));
  });
}

function cacheKey(subUrl, videoUrl) {
  return crypto.createHash('sha1').update(`${subUrl}|${videoUrl || ''}`).digest('hex');
}

/**
 * Download subtitle (and optionally video), run ffsubsync, cache and return SRT content.
 * @param {object} opts
 * @param {string}   opts.subUrl    - URL of the subtitle file
 * @param {string}   [opts.videoUrl] - URL of the video file (required for actual sync)
 * @param {Function} [opts.fetch]   - injectable fetch (defaults to node-fetch, for testing)
 * @param {Function} [opts.runSync] - injectable sync fn (defaults to runFfsubsync, for testing)
 */
async function syncSubtitle({
  subUrl,
  videoUrl = null,
  fetch: fetchFn = require('node-fetch'),
  runSync = runFfsubsync,
}) {
  await fs.mkdir(CACHE_DIR, { recursive: true });

  const key = cacheKey(subUrl, videoUrl);
  const cachedPath = path.join(CACHE_DIR, `${key}.srt`);

  // Cache hit — skip download and sync
  try {
    return await fs.readFile(cachedPath, 'utf8');
  } catch {
    // cache miss, fall through
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'subsync-'));
  try {
    const subPath = path.join(tmpDir, 'input.srt');
    await downloadFile(subUrl, subPath, fetchFn);

    let result;
    if (videoUrl) {
      const ext = (videoUrl.match(/\.(mkv|mp4|avi|mov|webm)/i) || ['', 'mkv'])[1];
      const videoPath = path.join(tmpDir, `video.${ext}`);
      const outPath = path.join(tmpDir, 'synced.srt');
      await downloadFile(videoUrl, videoPath, fetchFn);
      await runSync(videoPath, subPath, outPath);
      result = await fs.readFile(outPath, 'utf8');
    } else {
      // ponytail: no video = no sync; return raw subtitle so Stremio still gets something
      result = await fs.readFile(subPath, 'utf8');
    }

    await fs.writeFile(cachedPath, result, 'utf8');
    return result;
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { syncSubtitle, cacheKey, downloadFile, runFfsubsync, CACHE_DIR };
