'use strict';

const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const express = require('express');
const fetch = require('node-fetch');
const dns = require('dns').promises;
const net = require('net');
const { URL } = require('url');
const { syncSubtitle } = require('./syncer');

const PORT = parseInt(process.env.PORT || '7000', 10);
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const REGISTER_TOKEN = process.env.REGISTER_TOKEN || null;
const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;

// RFC 1918, loopback, link-local, and cloud metadata ranges to block for SSRF
const BLOCKED_HOSTNAME_RE = /^(localhost|.*\.local)$/i;

function isBlockedIp(ip) {
  if (!net.isIP(ip)) return false;
  if (ip === '::1' || ip === '0.0.0.0') return true;
  if (net.isIPv4(ip)) {
    const octets = ip.split('.').map(Number);
    return octets[0] === 10 ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168) ||
      (octets[0] === 169 && octets[1] === 254) ||
      octets[0] === 127;
  }
  if (net.isIPv6(ip)) {
    return ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe8') || ip === '::1';
  }
  return false;
}

async function validateUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error('Invalid URL'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Only http/https URLs allowed');
  if (BLOCKED_HOSTNAME_RE.test(u.hostname)) throw new Error('URL hostname not allowed');

  const infos = await dns.lookup(u.hostname, { all: true });
  const blocked = infos.some(info => isBlockedIp(info.address));
  if (blocked) throw new Error('URL hostname not allowed');

  return u.href;
}

// ponytail: in-memory store; restarts lose registrations but re-syncing is cheap
const videoUrlStore = new Map();

const manifest = {
  id: 'community.subsync',
  version: '1.0.0',
  name: 'SubSync',
  description:
    'Subtitle sync and translation for Stremio. ' +
    'Fetches subtitle streams, translates them to your target language (Hebrew by default), ' +
    'and optionally repairs subtitle timing with ffsubsync.',
  resources: ['subtitles'],
  types: ['movie', 'series'],
  idPrefixes: ['tt'],
  catalogs: [],
};

const builder = new addonBuilder(manifest);

async function fetchOpenSubsList(imdbId, type, season, episode) {
  const key = process.env.OPENSUBS_API_KEY;
  if (!key) return [];

  const params = new URLSearchParams({ imdb_id: imdbId.replace('tt', ''), languages: 'en' });
  if (type === 'series' && season) {
    params.set('season_number', season);
    params.set('episode_number', episode);
  }

  const res = await fetch(`https://api.opensubtitles.com/api/v1/subtitles?${params}`, {
    headers: { 'Api-Key': key, 'User-Agent': 'SubSync/1.0' },
  });
  if (!res.ok) return [];
  return (await res.json()).data || [];
}

async function resolveOpenSubsDownloadUrl(fileId) {
  const key = process.env.OPENSUBS_API_KEY;
  if (!key) throw new Error('OPENSUBS_API_KEY not set');

  const res = await fetch('https://api.opensubtitles.com/api/v1/download', {
    method: 'POST',
    headers: {
      'Api-Key': key,
      'Content-Type': 'application/json',
      'User-Agent': 'SubSync/1.0',
    },
    body: JSON.stringify({ file_id: Number(fileId) }),
  });
  if (!res.ok) throw new Error(`OpenSubtitles download failed: ${res.status}`);
  return (await res.json()).link;
}

builder.defineSubtitlesHandler(async ({ type, id }) => {
  const [imdbId, season, episode] = id.split(':');
  const videoUrl = videoUrlStore.get(imdbId) || '';
  const targetLang = process.env.TARGET_LANG || 'he';
  const subs = await fetchOpenSubsList(imdbId, type, season, episode).catch(() => []);

  const subtitles = subs.slice(0, 5).flatMap(sub => {
    const file = sub.attributes?.files?.[0];
    if (!file?.file_id) return [];

    const q = new URLSearchParams({ fileId: String(file.file_id) });
    if (videoUrl) q.set('videoUrl', videoUrl);
    if (targetLang) q.set('lang', targetLang);

    return [{
      id: `subsync-${file.file_id}`,
      url: `${BASE_URL}/sync.srt?${q}`,
      lang: targetLang || sub.attributes?.language || 'eng',
      name: `[SubSync${targetLang ? `→${targetLang}` : ''}] ${sub.attributes?.release || 'Auto'}`,
    }];
  });

  return { subtitles };
});

const app = express();
app.use(express.json());

/**
 * Register a video URL for a content ID.
 * Call this before pressing play so the subtitle handler can embed the video URL.
 *
 * POST /register?imdbId=tt1234567&videoUrl=http%3A%2F%2Fstream.example.com%2Fvideo.mkv
 */
app.post('/register', async (req, res) => {
  // Require token if REGISTER_TOKEN env var is set
  if (REGISTER_TOKEN) {
    const auth = req.headers['authorization'] || '';
    if (auth !== `Bearer ${REGISTER_TOKEN}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }
  const { imdbId, videoUrl } = req.query;
  if (!imdbId || !videoUrl) {
    return res.status(400).json({ error: 'imdbId and videoUrl required' });
  }
  try {
    await validateUrl(videoUrl);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  videoUrlStore.set(imdbId, videoUrl);
  res.json({ ok: true });  // don't echo back values
});

/**
 * Sync endpoint — Stremio fetches this URL to get the (possibly corrected) subtitle.
 *
 * GET /sync.srt?subUrl=<encoded>&videoUrl=<encoded>   (direct subtitle URL)
 * GET /sync.srt?fileId=<id>&videoUrl=<encoded>        (OpenSubtitles file ID)
 */
app.get('/sync.srt', async (req, res) => {
  const { subUrl, fileId, videoUrl, lang } = req.query;
  const targetLang = lang || process.env.TARGET_LANG || 'he';

  try {
    let resolvedSubUrl = subUrl;
    if (!resolvedSubUrl && fileId) {
      resolvedSubUrl = await resolveOpenSubsDownloadUrl(fileId);
    }
    if (!resolvedSubUrl) {
      return res.status(400).send('Missing subUrl or fileId');
    }

    // Validate URLs before making any outbound requests
    try { resolvedSubUrl = await validateUrl(resolvedSubUrl); } catch (e) {
      return res.status(400).send(e.message);
    }
    let safeVideoUrl = null;
    if (videoUrl) {
      try { safeVideoUrl = await validateUrl(videoUrl); } catch (e) {
        return res.status(400).send(e.message);
      }
    }

    const content = await syncSubtitle({
      subUrl: resolvedSubUrl,
      videoUrl: safeVideoUrl,
      targetLang,
      fetch,
    });

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(content);
  } catch (err) {
    console.error('Subtitle processing failed');
    res.status(500).send('Subtitle processing failed');  // never expose internal error details
  }
});

// Mount the Stremio addon protocol router (handles /manifest.json, /subtitles/*)
app.use(getRouter(builder.getInterface()));

function start(port = PORT) {
  return app.listen(port, () => {
    console.log(`SubSync addon running — install in Stremio: ${BASE_URL}/manifest.json`);
  });
}

if (require.main === module) start();

module.exports = { app, videoUrlStore, resolveOpenSubsDownloadUrl, fetchOpenSubsList, validateUrl };
