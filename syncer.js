'use strict';

const { spawn } = require('child_process');
const { createWriteStream, promises: fs } = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { translateSrt } = require('./translator');

const CACHE_DIR = path.join(os.tmpdir(), 'subsync-cache');
const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;

async function downloadFile(url, dest, fetchFn) {
  const res = await fetchFn(url, { timeout: 15000, redirect: 'manual' });
  if (!res.ok) throw new Error(`HTTP ${res.status} downloading ${url}`);
  await new Promise((resolve, reject) => {
    const out = createWriteStream(dest);
    let bytes = 0;
    let finished = false;
    const fail = err => {
      if (finished) return;
      finished = true;
      out.destroy();
      reject(err);
    };
    const timer = setTimeout(() => fail(new Error(`Download timed out: ${url}`)), 15000);
    res.body.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > MAX_DOWNLOAD_BYTES) {
        fail(new Error(`Download too large: ${url}`));
      }
    });
    res.body.on('error', fail);
    out.on('error', fail);
    out.on('finish', () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve();
    });
    res.body.pipe(out);
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

function cacheKey(subUrl, videoUrl, targetLang = null, sourceLang = 'en') {
  return crypto.createHash('sha1').update(`${subUrl}|${videoUrl || ''}|${targetLang || ''}|${sourceLang || ''}`).digest('hex');
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
  targetLang = null,
  sourceLang = 'en',
  fetch: fetchFn = require('node-fetch'),
  runSync = runFfsubsync,
}) {
  await fs.mkdir(CACHE_DIR, { recursive: true });

  const key = cacheKey(subUrl, videoUrl, targetLang, sourceLang);
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

    if (targetLang) {
      result = await translateSrt(result, targetLang, fetchFn, sourceLang);
    }

    await fs.writeFile(cachedPath, result, 'utf8');
    return result;
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { syncSubtitle, cacheKey, downloadFile, runFfsubsync, CACHE_DIR };
