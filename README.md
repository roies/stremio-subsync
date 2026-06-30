# stremio-subsync

Stremio addon that auto-syncs subtitles using [ffsubsync](https://github.com/smacke/ffsubsync).

## Install dependencies

```bash
pip install ffsubsync
npm install
```

Optional — free OpenSubtitles API key for subtitle search (register at [opensubtitles.com](https://www.opensubtitles.com)):

```bash
export OPENSUBS_API_KEY=your_key_here
```

## Run

```bash
npm start
# → SubSync addon running — install in Stremio: http://localhost:7000/manifest.json
```

Open Stremio → Settings → Add-ons → paste `http://localhost:7000/manifest.json`.

## How it works

1. Stremio requests subtitles for a movie/series (by IMDB ID)
2. SubSync fetches subtitle options from OpenSubtitles (requires `OPENSUBS_API_KEY`)
3. Returns subtitle URLs pointing to the local `/sync.srt` endpoint
4. When Stremio fetches that URL, SubSync:
   - Downloads the original subtitle to a temp file
   - If a video URL is registered (see below), downloads the video and runs `ffsubsync`
   - Serves the synced `.srt`, cached by content hash for future requests
   - Cleans up temp files

## Register a video URL for syncing

Stremio doesn't pass the video stream URL to subtitle requests, so you need to
register it before pressing play:

```bash
curl -X POST \
  "http://localhost:7000/register?imdbId=tt1234567&videoUrl=http%3A%2F%2Fstream.example.com%2Fvideo.mkv"
```

SubSync will embed the video URL in the subtitle links it returns for that content,
so ffsubsync can align the timing.

Without a registered video URL, subtitles are returned as-is (no timing correction).

## Direct sync endpoint

You can also call the sync endpoint directly with any subtitle and video URL:

```
GET http://localhost:7000/sync.srt?subUrl=https%3A%2F%2Fexample.com%2Fsub.srt&videoUrl=https%3A%2F%2Fexample.com%2Fvideo.mkv
```

## Tests

```bash
npm test
```

Tests run without a real Stremio instance, network, or video files — all external
calls (fetch, ffsubsync) are mocked.

## Environment variables

| Variable           | Default                    | Description                          |
|--------------------|----------------------------|--------------------------------------|
| `PORT`             | `7000`                     | HTTP port to listen on               |
| `BASE_URL`         | `http://localhost:{PORT}`  | Public URL (set if behind a proxy)   |
| `OPENSUBS_API_KEY` | *(unset)*                  | OpenSubtitles API key (free tier ok) |
