# stremio-subsync

Stremio addon that fetches English subtitles and **automatically translates them to Hebrew** in real time, with optional subtitle timing sync via [ffsubsync](https://github.com/smacke/ffsubsync).

---

## Install (Windows)

**Prerequisites — install these first if you don't have them:**
- [Node.js](https://nodejs.org) (LTS version)
- [Python](https://python.org/downloads) ✔ check "Add to PATH" during install

**Steps:**

1. [Download this repo as ZIP](https://github.com/roies/stremio-subsync/archive/refs/heads/master.zip) and extract it
2. Double-click **`install.bat`** — installs all dependencies
3. Double-click **`start.bat`** — starts the server and shows your URL
4. Copy the URL (looks like `http://192.168.1.X:7000/manifest.json`)
5. Open Stremio on any device → **Settings → Add-ons** → paste the URL → **Install**

> The PC running `start.bat` must be on and connected to the same Wi-Fi as your TV.

---

## How it works

1. Stremio requests subtitles for what you're watching (by IMDB ID)
2. SubSync fetches English subtitles from OpenSubtitles (set `OPENSUBS_API_KEY` env var)
3. Translates them to Hebrew automatically using Google Translate
4. Serves the translated `.srt` file back to Stremio (cached — each subtitle translated only once)

Optionally, if you register the video stream URL (see below), it also runs `ffsubsync` to fix timing offset before translating.

---

## Register a video URL for timing sync (optional)

Stremio doesn't share the video URL with addons, so you need to register it manually:

```bash
curl -X POST "http://localhost:7000/register?imdbId=tt1234567&videoUrl=http%3A%2F%2Fstream.example.com%2Fvideo.mkv"
```

Without this, subtitles are translated but not timing-corrected.

---

## Direct sync + translate endpoint

```
GET http://localhost:7000/sync.srt?subUrl=https%3A%2F%2Fexample.com%2Fsub.srt
```

Optional params: `videoUrl`, `lang` (default: `he`).

---

## Environment variables

| Variable           | Default | Description                              |
|--------------------|---------|------------------------------------------|
| `PORT`             | `7000`  | HTTP port                                |
| `BASE_URL`         | auto    | Public URL (set if behind a proxy)       |
| `TARGET_LANG`      | `he`    | Translation target language code         |
| `OPENSUBS_API_KEY` | —       | Free API key from opensubtitles.com      |

---

## Tests

```bash
npm test
```

