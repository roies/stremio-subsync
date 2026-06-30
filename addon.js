'use strict';

const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const express = require('express');
const fetch = require('node-fetch');
const { syncSubtitle } = require('./syncer');

const PORT = parseInt(process.env.PORT || '7000', 10);
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// ponytail: in-memory store; restarts lose registrations but re-syncing is cheap
const videoUrlStore = new Map();

const manifest = {
  id: 'community.subsync',
  version: '1.0.0',
  name: 'SubSync',
  description:
    'Auto-syncs subtitles using ffsubsync. Set OPENSUBS_API_KEY for OpenSubtitles integration.',
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
  const subs = await fetchOpenSubsList(imdbId, type, season, episode).catch(() => []);

  const subtitles = subs.slice(0, 5).flatMap(sub => {
    const file = sub.attributes?.files?.[0];
    if (!file?.file_id) return [];

    const q = new URLSearchParams({ fileId: String(file.file_id) });
    if (videoUrl) q.set('videoUrl', videoUrl);

    return [{
      id: `subsync-${file.file_id}`,
      url: `${BASE_URL}/sync.srt?${q}`,
      lang: sub.attributes?.language || 'eng',
      name: `[SubSync] ${sub.attributes?.release || 'Auto'}`,
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
app.post('/register', (req, res) => {
  const { imdbId, videoUrl } = req.query;
  if (!imdbId || !videoUrl) {
    return res.status(400).json({ error: 'imdbId and videoUrl required' });
  }
  videoUrlStore.set(imdbId, videoUrl);
  res.json({ ok: true, imdbId, videoUrl });
});

/**
 * Sync endpoint — Stremio fetches this URL to get the (possibly corrected) subtitle.
 *
 * GET /sync.srt?subUrl=<encoded>&videoUrl=<encoded>   (direct subtitle URL)
 * GET /sync.srt?fileId=<id>&videoUrl=<encoded>        (OpenSubtitles file ID)
 */
app.get('/sync.srt', async (req, res) => {
  const { subUrl, fileId, videoUrl } = req.query;

  try {
    let resolvedSubUrl = subUrl;
    if (!resolvedSubUrl && fileId) {
      resolvedSubUrl = await resolveOpenSubsDownloadUrl(fileId);
    }
    if (!resolvedSubUrl) {
      return res.status(400).send('Missing subUrl or fileId');
    }

    const content = await syncSubtitle({
      subUrl: resolvedSubUrl,
      videoUrl: videoUrl || null,
      fetch,
    });

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(content);
  } catch (err) {
    console.error('Sync error:', err.message);
    res.status(500).send(`Sync failed: ${err.message}`);
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

module.exports = { app, videoUrlStore, resolveOpenSubsDownloadUrl, fetchOpenSubsList };
