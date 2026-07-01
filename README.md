# SubSync — Stremio subtitle sync and translation addon

SubSync is a Stremio addon that automatically handles subtitle streams: it can translate them to a target language (Hebrew by default), and it can also repair subtitle timing with [ffsubsync](https://github.com/smacke/ffsubsync).

> No paid API is required. Translation uses Google Translate when available, with local fallbacks for offline-friendly use.

License: MIT. The project code is licensed under MIT; third-party dependencies and external services (such as ffsubsync, Argos Translate, Google Translate, and OpenSubtitles) remain subject to their own licenses and terms.

Compliance note: this project is a local automation tool. You are responsible for using it only with content you are authorized to access, and for complying with the terms of Stremio, any subtitle providers, and any translation services you enable. By default, the addon uses local/offline translation behavior and does not call remote translation services unless you explicitly enable `ENABLE_REMOTE_TRANSLATION=true`.

---

## Install (Windows)

**Prerequisites — install these first if you don't have them:**
- [Node.js](https://nodejs.org) (LTS version)
- [Python](https://python.org/downloads) ✔ check "Add to PATH" during install

### Easiest way: double-click the batch files

1. [Download ZIP](https://github.com/roies/stremio-subsync/archive/refs/heads/master.zip) → extract it
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

1. Stremio asks for subtitles for whatever you're watching.
2. SubSync can fetch subtitle candidates from OpenSubtitles when available.
3. It translates them to your target language (Hebrew by default).
4. It delivers the processed `.srt` back to Stremio.
5. Results are cached — each subtitle is processed only once per matching input.

**Bonus:** register the video URL before playing and SubSync will also repair subtitle timing offset using `ffsubsync`:

```bash
curl -X POST "http://localhost:7000/register?imdbId=tt1234567&videoUrl=http%3A%2F%2Fstream.example.com%2Fvideo.mkv"
```

---

## Direct endpoint

Process any subtitle URL on demand:

```
GET http://localhost:7000/sync.srt?subUrl=https%3A%2F%2Fexample.com%2Fsub.srt
```

Optional params: `videoUrl` (for timing sync), `lang` (default: `he`), `sourceLang` (default: `en`).

---

## Environment variables

| Variable           | Default | Description |
|--------------------|---------|-------------|
| `PORT`             | `7000`  | HTTP port |
| `BASE_URL`         | auto    | Public URL if running behind a proxy |
| `SOURCE_LANG`      | `en`    | Source language for translation (default: English) |
| `TARGET_LANG`      | `he`    | Translation target (default: Hebrew) |
| `ENABLE_REMOTE_TRANSLATION` | `false` | Set to `true` to allow Google Translate calls; default is off for safer, more explicit usage |
| `REGISTER_TOKEN`   | -       | If set, `/register` requires `Authorization: example-token` |
| `OPENSUBS_API_KEY` | -       | Optional free API key from [opensubtitles.com](https://www.opensubtitles.com) |

## Optional better offline translation

If you want higher-quality offline translation, install Argos Translate on the same machine running the addon. It works for the configured target language (Hebrew by default, but any installed language pair can be used):

```bash
pip install argostranslate
```

When `argos-translate` is available, SubSync uses it first for offline translation. If it is not installed or fails, it falls back to the built-in local translator.

## Security notes

- The addon blocks private/loopback/localhost URLs (`127.0.0.0/8`, `10/8`, `192.168/16`, `169.254/16`, `.local`, etc.) for outbound subtitle/video downloads.
| `REGISTER_TOKEN`   | -       | If set, `/register` requires `Authorization: example-token` |
- Subtitle text is sent to Google Translate for translation when that path is available; if you need zero-third-party processing, use a local translator instead.

---

## Tests

```bash
npm test   # 32 mocked tests, no network or video files needed
```


