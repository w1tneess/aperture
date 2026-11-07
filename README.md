# Stash

A personal, self-hosted downloader for social media posts: paste a link, pick a quality, get the file.

Supports **Instagram** (reels, videos, photos, carousels), **X / Twitter**, **Facebook**, **TikTok**, **YouTube**, **Threads**, **Reddit** and **Pinterest**. You can add more sites with `EXTRA_HOSTS`.

![Stash](docs/screenshot-result.png)

## Why it needs a server

Browsers can't download from these platforms directly. Their pages block cross-site requests, media URLs are signed and short-lived, and many posts need a login. Every downloader site (snapgram, fdown, x-downloader) runs a backend. Stash runs that backend on **your** machine using two well-maintained open-source extractors:

- **[yt-dlp](https://github.com/yt-dlp/yt-dlp)**: video, with real quality choices and audio extraction
- **[gallery-dl](https://github.com/mikf/gallery-dl)**: photos and mixed photo/video carousels, which yt-dlp skips

For photo-capable sites both run in parallel. gallery-dl's result is used when the post contains photos, otherwise yt-dlp's.

```
React (Vite) ──/api──▶ Express ──execFile──▶ yt-dlp / gallery-dl ──▶ temp file ──▶ your browser
                         │  allowlisted hosts only · no shell · progress over SSE · files deleted after 30 min
```

## Quick start

Requirements: **Node 20.12+**, **Python 3.9+**, **ffmpeg**, **Git**.

### Windows: easiest way

Install Node.js and Python (step 1 below), then **double-click `Start Stash.bat`** in the project folder. It installs everything else, builds the app, and opens it in your browser at http://127.0.0.1:8787. Keep its window open while you use Stash.

### Windows (PowerShell, manual)

Run each line on its own. Windows PowerShell 5.1 doesn't support `&&`.

1. Install the prerequisites (skip any you already have), then **close and reopen PowerShell** so the new commands are found:

   ```powershell
   winget install OpenJS.NodeJS.LTS
   ```
   ```powershell
   winget install Python.Python.3.12
   ```
   ```powershell
   winget install Gyan.FFmpeg
   ```
   ```powershell
   winget install Git.Git
   ```

2. Install the extractors:

   ```powershell
   py -m pip install -U yt-dlp gallery-dl
   ```

3. Get the code and install dependencies:

   ```powershell
   git clone https://github.com/<you>/stash.git
   ```
   ```powershell
   cd stash
   ```
   ```powershell
   npm run setup
   ```

4. Run it:

   ```powershell
   npm run dev
   ```

   Open http://127.0.0.1:5173. The terminal shows a ✓ or ✗ for yt-dlp, gallery-dl and ffmpeg, so you can see at a glance if something is missing. If pip put `yt-dlp.exe` somewhere that isn't on PATH, Stash automatically falls back to `py -m yt_dlp`.

### macOS / Linux

```bash
pip install -U yt-dlp gallery-dl
```
```bash
npm run setup
```
```bash
npm run dev
```

### Production mode

`npm start` builds the frontend and serves everything from one process at http://127.0.0.1:8787.

**Keep the extractors updated.** Platforms change their sites often. When a link that used to work starts failing, this almost always fixes it:

```powershell
py -m pip install -U yt-dlp gallery-dl
```

## Instagram (and private posts) need cookies

Instagram blocks most anonymous requests. Facebook and X do so for some posts. Give Stash your browser's login cookies:

1. Install a "cookies.txt" exporter extension in a browser where you're logged in (e.g. *Get cookies.txt LOCALLY*).
2. Export cookies for instagram.com (and others if needed) to a file, e.g. `~/stash-cookies.txt`.
3. Copy `.env.example` to `.env` in the project folder and set `COOKIES_FILE=` to the file's full path (on Windows, e.g. `COOKIES_FILE=C:/Users/you/stash-cookies.txt`; forward slashes are fine).
4. Restart the server.

Treat that file like a password: it grants access to your accounts. It's git-ignored by default. A throwaway account is a sensible choice.

## Using it

| | |
|---|---|
| **Paste anywhere** | Press <kbd>Ctrl</kbd>+<kbd>V</kbd> anywhere on the page; no need to click the box. <kbd>/</kbd> focuses it. |
| **Shared text works** | Pasting "lol look at this https://… 🔥" finds the link. |
| **Carousels** | Every item is shown; download one or all. |
| **Quality** | Best / 1080p / 720p / 480p / audio-only (MP3 or M4A). Vertical videos are labelled by their short side, so a 720×1280 reel is "720p". |
| **Quick mode** | Settings → skip the preview and download at your default quality straight away. |
| **Batch** | Paste a list of links (or a whole chat message) and queue them all. |
| **History** | Finished downloads are remembered in your browser (only there). |
| **Phone** | Run with `HOST=0.0.0.0` and `APP_PASSCODE` set, open `http://<computer-ip>:8787` on your phone, and choose *Add to Home Screen*. On Android you can then *Share → Stash* from the Instagram/X/TikTok apps. |

## Configuration (`.env`)

See `.env.example`. The most relevant settings:

| Variable | Default | Purpose |
|---|---|---|
| `HOST` | `127.0.0.1` | `0.0.0.0` to reach it from other devices |
| `APP_PASSCODE` | *(none)* | Required whenever it's reachable beyond your computer |
| `SESSION_SECRET` | random per start | Set it to stay logged in across restarts |
| `COOKIES_FILE` | *(none)* | Netscape cookies.txt for logged-in access |
| `MAX_FILESIZE` | `2G` | Per-file cap |
| `MAX_CONCURRENT` | `3` | Parallel downloads |
| `JOB_TTL_MINUTES` | `30` | When temp files are deleted |
| `EXTRA_HOSTS` | *(none)* | Extra sites, e.g. `vimeo.com,soundcloud.com` |

## Docker

```bash
docker build -t stash .
```

```bash
docker run -p 8787:8787 -e APP_PASSCODE=change-me -v ~/stash-cookies.txt:/cookies.txt:ro -e COOKIES_FILE=/cookies.txt stash
```

## Security notes

- **Host allowlist.** The server only runs extractors on the listed platforms. Lookalike domains (`instagram.com.evil.example`), local addresses, `file:` and credentialed URLs are rejected.
- **No shell.** Extractors run via `execFile` with an argument array. The client never sends raw arguments, only a quality id checked against a strict pattern.
- **No open proxy.** Downloads and thumbnails reference server-side preview ids. The client can't make the server fetch an arbitrary URL.
- **Hardening.** Helmet security headers and CSP, rate limits, a 16 KB body limit, a per-file size cap and a 15-minute process timeout. In production, errors don't expose internal details.
- **Passcode gate.** Optional. Uses an HttpOnly, SameSite=Strict cookie, a constant-time comparison and a login rate limit.

## Development

```bash
npm test
```

Runs the server's URL-validation tests. The frontend type-checks on `npm run build`.

```
server/src/index.js      routes, passcode gate, static hosting
server/src/platforms.js  host allowlist + link extraction (unit-tested)
server/src/extract.js    yt-dlp / gallery-dl probing and error mapping
server/src/jobs.js       download queue, progress parsing, cleanup
web/src/App.tsx          views, paste handling, share target
web/src/components/      LinkForm, ResultView, QualityPicker, Downloads, History, Batch, Settings
web/src/styles.css       design tokens (light/dark) and all styles
```

## Use responsibly

This is for saving things you're entitled to keep: your own posts, content with permission, or material for personal offline viewing where your local law allows it. Downloading can breach a platform's terms of service, and re-uploading other people's work can infringe copyright. You're responsible for how you use it.
