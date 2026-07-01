# HebTitles — Stremio Hebrew Subtitles Addon

Stremio addon that **automatically fetches English subtitles and translates them to Hebrew** for any movie or series. Optionally fixes subtitle timing using [ffsubsync](https://github.com/smacke/ffsubsync).

> No API key required. Translation is free via Google Translate.

---

## Install (Windows)

**Prerequisites — install these first if you don't have them:**
- [Node.js](https://nodejs.org) (LTS version)
- [Python](https://python.org/downloads) ✔ check "Add to PATH" during install

### Easiest way: double-click the batch files

1. [Download ZIP](https://github.com/roies/stremio-hebtitles/archive/refs/heads/master.zip) → extract it
2. Double-click **`install.bat`** — installs all dependencies (run once)
3. Double-click **`start.bat`** — starts the server and shows your URL:
   ```
   Add this URL to Stremio: http://192.168.1.X:7000/manifest.json
   ```
4. Open Stremio on any device → **Settings → Add-ons** → paste the URL → **Install**

> Keep `start.bat` running while you watch. The PC must be on the same Wi-Fi as your TV.

### Command Prompt / PowerShell version (copy-paste)

Open Command Prompt or PowerShell in the extracted folder and run:

```cmd
pip install ffsubsync
pip install argostranslate
npm install
npm start
```

If you prefer PowerShell, use the same commands:

```powershell
pip install ffsubsync
pip install argostranslate
npm install
npm start
```

The addon will print the install URL when it starts. Use that URL in Stremio.

---

## What it does

1. Stremio asks for subtitles for whatever you're watching
2. HebTitles fetches English subtitles from OpenSubtitles (set `OPENSUBS_API_KEY` for this)
3. Translates them to Hebrew automatically
4. Delivers the Hebrew `.srt` back to Stremio
5. Results are cached — each subtitle is translated only once

**Bonus:** register the video URL before playing and HebTitles will also fix subtitle timing offset using `ffsubsync`:

```bash
curl -X POST "http://localhost:7000/register?imdbId=tt1234567&videoUrl=http%3A%2F%2Fstream.example.com%2Fvideo.mkv"
```

---

## Direct endpoint

Translate any subtitle URL on demand:

```
GET http://localhost:7000/sync.srt?subUrl=https%3A%2F%2Fexample.com%2Fsub.srt
```

Optional params: `videoUrl` (for timing sync), `lang` (default: `he`).

---

## Environment variables

| Variable           | Default | Description                                      |
|--------------------|---------|--------------------------------------------------|
| `PORT`             | `7000`  | HTTP port                                        |
| `BASE_URL`         | auto    | Public URL if running behind a proxy             |
| `TARGET_LANG`      | `he`    | Translation target (`he` = Hebrew)               |
| `REGISTER_TOKEN`   | —       | If set, `/register` requires `Authorization: Bearer <token>` |
| `OPENSUBS_API_KEY` | —       | Free API key from [opensubtitles.com](https://www.opensubtitles.com) |

## Optional better offline translation

If you want higher-quality offline translation, install Argos Translate on the same machine running the addon:

```bash
pip install argostranslate
```

When `argos-translate` is available, HebTitles uses it first for offline translation. If it is not installed or fails, it falls back to the built-in local translator.

## Security notes

- The addon blocks private/loopback/localhost URLs (`127.0.0.0/8`, `10/8`, `192.168/16`, `169.254/16`, `.local`, etc.) for outbound subtitle/video downloads.
- `/register` is protected by `REGISTER_TOKEN` when you set it.
- Subtitle text is sent to Google Translate for translation; if you need zero-third-party processing, use a local translator instead.

---

## Tests

```bash
npm test   # 22 tests, all mocked — no network or video files needed
```


