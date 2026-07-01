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
const { parseSrt, buildSrt, translateSrt } = require('./translator');

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
        path: '/register?imdbId=tt0000001&videoUrl=https%3A%2F%2Fexample.com%2Fv.mkv',
        method: 'POST',
      });
      assert.strictEqual(status, 200);
      assert.strictEqual(JSON.parse(body).ok, true);
      assert.strictEqual(videoUrlStore.get('tt0000001'), 'https://example.com/v.mkv');
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

  console.log('\nsecurity');

  const { validateUrl } = require('./addon');

  await test('validateUrl blocks private IPs (SSRF)', async () => {
    for (const url of [
      'http://169.254.169.254/latest/meta-data/',   // AWS metadata
      'http://10.0.0.1/admin',                       // RFC 1918
      'http://192.168.1.1/',                         // RFC 1918
      'http://127.0.0.1:6379/',                      // loopback
      'http://localhost/etc/passwd',                 // localhost
    ]) {
      await assert.rejects(() => validateUrl(url), /not allowed|Invalid/, `should block: ${url}`);
    }
  });

  await test('validateUrl blocks non-http schemes', async () => {
    await assert.rejects(() => validateUrl('file:///etc/passwd'), /not allowed|Only http/);
    await assert.rejects(() => validateUrl('ftp://files.example.com/sub.srt'), /not allowed|Only http/);
  });

  await test('validateUrl accepts legitimate http/https URLs', async () => {
    await assert.doesNotReject(() => validateUrl('https://example.com/subs/file.srt'));
    await assert.doesNotReject(() => validateUrl('https://example.com/video.mkv'));
  });

  await test('GET /sync.srt returns 400 for SSRF subUrl', async () => {
    const server = app.listen(0);
    const { port } = server.address();
    try {
      const { status } = await httpRequest({
        hostname: 'localhost',
        port,
        path: '/sync.srt?subUrl=http%3A%2F%2F169.254.169.254%2Flatest%2Fmeta-data%2F',
      });
      assert.strictEqual(status, 400);
    } finally {
      await new Promise(r => server.close(r));
    }
  });

  await test('GET /sync.srt 500 does not expose error details', async () => {
    // This test verifies that internal errors are not leaked
    const server = app.listen(0);
    const { port } = server.address();
    try {
      // subUrl pointing to a non-resolving host will error; body must not contain internal details
      const { status, body } = await httpRequest({
        hostname: 'localhost',
        port,
        path: '/sync.srt?subUrl=https%3A%2F%2Fexample.com%2Fsub.srt',
      });
      assert.strictEqual(status, 500);
      assert.ok(!body.includes('ENOTFOUND'), 'should not leak internal error code');
      assert.ok(!body.includes('example.com'), 'should not leak hostname');
    } finally {
      await new Promise(r => server.close(r));
    }
  });

  await test('POST /register returns 401 when REGISTER_TOKEN is set and token missing', async () => {
    process.env.REGISTER_TOKEN = 'secret123';
    // Reload addon with new env
    delete require.cache[require.resolve('./addon')];
    const { app: tokenApp } = require('./addon');
    const server = tokenApp.listen(0);
    const { port } = server.address();
    try {
      const { status } = await httpRequest({
        hostname: 'localhost',
        port,
        path: '/register?imdbId=tt9999999&videoUrl=https%3A%2F%2Fexample.com%2Fv.mkv',
        method: 'POST',
      });
      assert.strictEqual(status, 401);
    } finally {
      delete process.env.REGISTER_TOKEN;
      await new Promise(r => server.close(r));
    }
  });

  // Summary
  console.log('\ntranslator');

  const TWO_BLOCK_SRT =
    '1\n00:00:01,000 --> 00:00:03,000\nHello\n\n2\n00:00:05,000 --> 00:00:07,000\nGoodbye\n';

  await test('parseSrt extracts index, timing, text', () => {
    const blocks = parseSrt(TWO_BLOCK_SRT);
    assert.strictEqual(blocks.length, 2);
    assert.strictEqual(blocks[0].index, '1');
    assert.strictEqual(blocks[0].timing, '00:00:01,000 --> 00:00:03,000');
    assert.strictEqual(blocks[0].text, 'Hello');
    assert.strictEqual(blocks[1].text, 'Goodbye');
  });

  await test('buildSrt round-trips parseSrt', () => {
    const blocks = parseSrt(TWO_BLOCK_SRT);
    const rebuilt = buildSrt(blocks);
    assert.strictEqual(rebuilt, TWO_BLOCK_SRT);
  });

  await test('parseSrt handles Windows line endings', () => {
    const winSrt = '1\r\n00:00:01,000 --> 00:00:03,000\r\nHello\r\n\r\n';
    const blocks = parseSrt(winSrt);
    assert.strictEqual(blocks.length, 1);
    assert.strictEqual(blocks[0].text, 'Hello');
  });

  await test('parseSrt handles multi-line subtitle text', () => {
    const multiLine = '1\n00:00:01,000 --> 00:00:03,000\nLine one\nLine two\n\n';
    const blocks = parseSrt(multiLine);
    assert.strictEqual(blocks[0].text, 'Line one\nLine two');
  });

  await test('translateSrt calls translate fn for each block', async () => {
    const translated = [];
    const mockTranslateFetch = async url => {
      const text = decodeURIComponent(url.match(/&q=(.+)$/)[1]);
      translated.push(text);
      return {
        ok: true,
        status: 200,
        json: async () => [[[`[${text}]`, text]]],
      };
    };
    const result = await translateSrt(TWO_BLOCK_SRT, 'he', mockTranslateFetch);
    assert.ok(result.includes('[Hello]'), 'first block translated');
    assert.ok(result.includes('[Goodbye]'), 'second block translated');
    assert.strictEqual(translated.length, 2);
  });

  await test('translateSrt falls back to local translation on error', async () => {
    const mockFetch = async () => ({ ok: false, status: 429, json: async () => [] });
    const result = await translateSrt(TWO_BLOCK_SRT, 'he', mockFetch);
    // Should still be valid SRT and contain Hebrew-ish local fallback
    assert.ok(result.includes('שלום'));
    assert.ok(result.includes('להתראות'));
  });

  await test('translateSrt handles common phrases offline', async () => {
    const mockFetch = async () => ({ ok: false, status: 429, json: async () => [] });
    const result = await translateSrt(
      '1\n00:00:01,000 --> 00:00:03,000\nGood morning\n\n2\n00:00:05,000 --> 00:00:07,000\nPlease wait',
      'he',
      mockFetch
    );
    assert.ok(result.includes('בוקר טוב'));
    assert.ok(result.includes('בבקשה תחכה'));
  });

  await test('syncSubtitle translates when targetLang provided', async () => {
    const subUrl = 'http://test.invalid/translate-sub.srt';
    await fs.unlink(path.join(CACHE_DIR, `${cacheKey(subUrl, null, 'he')}.srt`)).catch(() => {});

    const mockFetch = async url => {
      if (url === subUrl) {
        return { ok: true, status: 200, body: require('stream').Readable.from([Buffer.from(TWO_BLOCK_SRT)]) };
      }
      // Translate endpoint
      const text = decodeURIComponent(url.match(/&q=(.+)$/)[1]);
      return {
        ok: true, status: 200,
        json: async () => [[[`TRANSLATED:${text}`, text]]],
      };
    };

    const result = await syncSubtitle({ subUrl, targetLang: 'he', fetch: mockFetch });
    assert.ok(result.includes('TRANSLATED:'), 'translation was applied');
  });

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('\nTest runner crashed:', err);
  process.exit(1);
});
