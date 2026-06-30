'use strict';

/**
 * Unit tests — no real Stremio, no real video files, no network.
 * Run: node test.js
 */

const assert = require('assert');
const path = require('path');
const { promises: fs } = require('fs');
const { Readable } = require('stream');
const http = require('http');

const { syncSubtitle, cacheKey, CACHE_DIR } = require('./syncer');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

// --- Helpers ---

const SAMPLE_SRT = '1\n00:00:01,000 --> 00:00:03,000\nHello world\n\n';
const SYNCED_SRT = '1\n00:00:01,500 --> 00:00:03,500\nHello world\n\n';

function makeFetch(responseMap) {
  return async url => {
    if (!(url in responseMap)) throw new Error(`Unexpected fetch URL: ${url}`);
    const body = responseMap[url];
    return {
      ok: true,
      status: 200,
      body: Readable.from([Buffer.from(body)]),
    };
  };
}

function makeFetchFailing(status) {
  return async () => ({ ok: false, status, body: Readable.from([]) });
}

function httpRequest(options) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, res => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

// --- Tests ---

async function runTests() {
  console.log('\ncacheKey');

  await test('same inputs → same hash', () => {
    assert.strictEqual(cacheKey('http://a.example/sub.srt', 'http://b.example/v.mkv'),
                       cacheKey('http://a.example/sub.srt', 'http://b.example/v.mkv'));
  });

  await test('different inputs → different hash', () => {
    assert.notStrictEqual(cacheKey('http://a.example/sub.srt', 'http://b.example/v.mkv'),
                          cacheKey('http://a.example/sub.srt', null));
  });

  await test('returns 40-char hex (SHA-1)', () => {
    assert.match(cacheKey('http://example.com/sub.srt', null), /^[0-9a-f]{40}$/);
  });

  console.log('\nsyncSubtitle — no videoUrl (pass-through)');

  await test('returns subtitle content unchanged', async () => {
    const subUrl = 'http://test.invalid/passthrough.srt';
    await fs.unlink(path.join(CACHE_DIR, `${cacheKey(subUrl, null)}.srt`)).catch(() => {});

    const result = await syncSubtitle({
      subUrl,
      videoUrl: null,
      fetch: makeFetch({ [subUrl]: SAMPLE_SRT }),
    });
    assert.strictEqual(result, SAMPLE_SRT);
  });

  await test('writes result to cache', async () => {
    const subUrl = 'http://test.invalid/write-cache.srt';
    const key = cacheKey(subUrl, null);
    const cachePath = path.join(CACHE_DIR, `${key}.srt`);
    await fs.unlink(cachePath).catch(() => {});

    await syncSubtitle({ subUrl, fetch: makeFetch({ [subUrl]: SAMPLE_SRT }) });
    const cached = await fs.readFile(cachePath, 'utf8');
    assert.strictEqual(cached, SAMPLE_SRT);
  });

  console.log('\nsyncSubtitle — cache hit');

  await test('skips fetch on cache hit', async () => {
    const subUrl = 'http://test.invalid/already-cached.srt';
    const key = cacheKey(subUrl, null);
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(path.join(CACHE_DIR, `${key}.srt`), 'pre-cached content', 'utf8');

    let fetchCalled = false;
    const result = await syncSubtitle({
      subUrl,
      fetch: async () => { fetchCalled = true; throw new Error('should not call'); },
    });

    assert.strictEqual(result, 'pre-cached content');
    assert.strictEqual(fetchCalled, false);
  });

  console.log('\nsyncSubtitle — with videoUrl');

  await test('calls runSync and returns its output', async () => {
    const subUrl   = 'http://test.invalid/video-sub.srt';
    const videoUrl = 'http://test.invalid/video.mkv';
    await fs.unlink(path.join(CACHE_DIR, `${cacheKey(subUrl, videoUrl)}.srt`)).catch(() => {});

    let syncCalledWith = null;
    const mockRunSync = async (videoPath, subPath, outPath) => {
      syncCalledWith = { videoPath, subPath, outPath };
      await fs.writeFile(outPath, SYNCED_SRT, 'utf8');
    };

    const result = await syncSubtitle({
      subUrl,
      videoUrl,
      fetch: makeFetch({ [subUrl]: SAMPLE_SRT, [videoUrl]: Buffer.alloc(16) }),
      runSync: mockRunSync,
    });

    assert.strictEqual(result, SYNCED_SRT);
    assert.ok(syncCalledWith, 'runSync was called');
    assert.ok(syncCalledWith.videoPath.endsWith('.mkv'), 'video path has correct extension');
  });

  await test('caches synced result', async () => {
    const subUrl   = 'http://test.invalid/synced-cache.srt';
    const videoUrl = 'http://test.invalid/synced-video.mkv';
    const key = cacheKey(subUrl, videoUrl);
    await fs.unlink(path.join(CACHE_DIR, `${key}.srt`)).catch(() => {});

    let syncCount = 0;
    const mockRunSync = async (_, __, outPath) => {
      syncCount++;
      await fs.writeFile(outPath, SYNCED_SRT, 'utf8');
    };
    const mockFetch = makeFetch({ [subUrl]: SAMPLE_SRT, [videoUrl]: Buffer.alloc(8) });

    await syncSubtitle({ subUrl, videoUrl, fetch: mockFetch, runSync: mockRunSync });
    // Second call — should hit cache, not call runSync again
    await syncSubtitle({ subUrl, videoUrl, fetch: mockFetch, runSync: mockRunSync });

    assert.strictEqual(syncCount, 1, 'runSync called only once');
  });

  await test('temp files are cleaned up after sync', async () => {
    const subUrl   = 'http://test.invalid/cleanup-sub.srt';
    const videoUrl = 'http://test.invalid/cleanup-video.mkv';
    await fs.unlink(path.join(CACHE_DIR, `${cacheKey(subUrl, videoUrl)}.srt`)).catch(() => {});

    let capturedTmpDir = null;
    const mockRunSync = async (videoPath, subPath, outPath) => {
      capturedTmpDir = path.dirname(outPath);
      await fs.writeFile(outPath, SYNCED_SRT, 'utf8');
    };

    await syncSubtitle({
      subUrl,
      videoUrl,
      fetch: makeFetch({ [subUrl]: SAMPLE_SRT, [videoUrl]: Buffer.alloc(8) }),
      runSync: mockRunSync,
    });

    if (capturedTmpDir) {
      await assert.rejects(fs.access(capturedTmpDir), 'tmp dir should be deleted');
    }
  });

  console.log('\nsyncSubtitle — error cases');

  await test('propagates HTTP error from subtitle download', async () => {
    const subUrl = 'http://test.invalid/404.srt';
    await fs.unlink(path.join(CACHE_DIR, `${cacheKey(subUrl, null)}.srt`)).catch(() => {});

    await assert.rejects(
      () => syncSubtitle({ subUrl, fetch: makeFetchFailing(404) }),
      /HTTP 404/
    );
  });

  await test('propagates runSync failure', async () => {
    const subUrl   = 'http://test.invalid/sync-fail.srt';
    const videoUrl = 'http://test.invalid/sync-fail.mkv';
    await fs.unlink(path.join(CACHE_DIR, `${cacheKey(subUrl, videoUrl)}.srt`)).catch(() => {});

    await assert.rejects(
      () => syncSubtitle({
        subUrl,
        videoUrl,
        fetch: makeFetch({ [subUrl]: SAMPLE_SRT, [videoUrl]: Buffer.alloc(8) }),
        runSync: async () => { throw new Error('ffsubsync not found'); },
      }),
      /ffsubsync not found/
    );
  });

  console.log('\naddon HTTP endpoints');

  // Load addon app (clears any cached require from syncer import above)
  const { app, videoUrlStore } = require('./addon');

  await test('POST /register stores videoUrl', async () => {
    videoUrlStore.clear();
    const server = app.listen(0);
    const { port } = server.address();
    try {
      const { status, body } = await httpRequest({
        hostname: 'localhost',
        port,
        path: '/register?imdbId=tt0000001&videoUrl=http%3A%2F%2Fstream.test%2Fv.mkv',
        method: 'POST',
      });
      assert.strictEqual(status, 200);
      assert.strictEqual(JSON.parse(body).ok, true);
      assert.strictEqual(videoUrlStore.get('tt0000001'), 'http://stream.test/v.mkv');
    } finally {
      await new Promise(r => server.close(r));
    }
  });

  await test('POST /register returns 400 without params', async () => {
    const server = app.listen(0);
    const { port } = server.address();
    try {
      const { status } = await httpRequest({ hostname: 'localhost', port, path: '/register', method: 'POST' });
      assert.strictEqual(status, 400);
    } finally {
      await new Promise(r => server.close(r));
    }
  });

  await test('GET /sync.srt returns 400 without subUrl or fileId', async () => {
    const server = app.listen(0);
    const { port } = server.address();
    try {
      const { status } = await httpRequest({ hostname: 'localhost', port, path: '/sync.srt' });
      assert.strictEqual(status, 400);
    } finally {
      await new Promise(r => server.close(r));
    }
  });

  await test('GET /manifest.json returns valid addon manifest', async () => {
    const server = app.listen(0);
    const { port } = server.address();
    try {
      const { status, body } = await httpRequest({ hostname: 'localhost', port, path: '/manifest.json' });
      assert.strictEqual(status, 200);
      const manifest = JSON.parse(body);
      assert.strictEqual(manifest.id, 'community.subsync');
      assert.ok(manifest.resources.includes('subtitles'));
    } finally {
      await new Promise(r => server.close(r));
    }
  });

  // Summary
  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('\nTest runner crashed:', err);
  process.exit(1);
});
