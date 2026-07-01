# Windows Install Guide for SubSync

## Option 1: Double-click the batch files

1. Install [Node.js](https://nodejs.org) and [Python](https://python.org)
2. Download the repo ZIP from GitHub and extract it
3. Double-click `install.bat`
4. Double-click `start.bat`
5. Copy the URL it prints and paste it into Stremio

## Option 2: Copy-paste commands in Command Prompt or PowerShell

Open Command Prompt or PowerShell in the project folder and run:

```cmd
pip install ffsubsync
pip install argostranslate
npm install
npm start
```

If you are using PowerShell, the same commands work.

## What to paste into Stremio

Use the URL printed by `start.bat`, for example:

```text
http://192.168.1.50:7000/manifest.json
```

Then in Stremio:
1. Open Settings → Add-ons
2. Paste the URL
3. Click Install

## Notes

- Keep the terminal running while you watch.
- The computer running the addon should be on the same Wi-Fi as your TV.
- If `argostranslate` fails to install, the built-in fallback translator will still work.
