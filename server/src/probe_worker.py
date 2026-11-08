"""
Long-lived probe worker: keeps yt-dlp and gallery-dl imported so a probe doesn't pay Python startup.

Spawning a fresh extractor process costs ~0.7 CPU-seconds before any network request is made. On a
small cloud instance (e.g. Render free, ~0.1 CPU) that alone is several seconds per probe. Here the
import happens once and each probe is just the network work.

Protocol (one JSON object per line, ASCII only):
  argv:    probe_worker.py <config-json>   {"range": "1-20", "cookies": "", "instagramCookies": ""}
  stdout:  {"ready": true, "ytdlp": "<version>", "gallerydl": "<version>"}   once, at startup
  stdin:   {"id": 1, "tool": "ytdlp", "args": [...yt-dlp CLI args...], "url": "..."}
           {"id": 2, "tool": "gallerydl", "url": "..."}
  stdout:  {"id": 1, "ok": true, "out": "<same JSON the CLI would print>"}
           {"id": 1, "ok": false, "stderr": "ERROR: ..."}
"""

import io
import json
import logging
import sys
import threading
from concurrent.futures import ThreadPoolExecutor

# The protocol owns the real stdout. Anything a library prints goes to stderr instead.
OUT = sys.stdout
sys.stdout = sys.stderr
OUT_LOCK = threading.Lock()


def send(obj):
    line = json.dumps(obj, ensure_ascii=True)
    with OUT_LOCK:
        OUT.write(line + "\n")
        OUT.flush()


try:
    import yt_dlp
    from yt_dlp.version import __version__ as YTDLP_VERSION
    from gallery_dl import config as gdl_config, job as gdl_job, util as gdl_util
    from gallery_dl.extractor.common import Extractor as GdlExtractor
    from gallery_dl.version import __version__ as GALLERYDL_VERSION
except Exception as exc:  # noqa: BLE001
    send({"ready": False, "error": f"{exc.__class__.__name__}: {exc}"})
    sys.exit(1)


class CaptureLogger:
    """Swallow yt-dlp output but keep error lines: they are what the CLI would print to stderr."""

    def __init__(self):
        self.errors = []

    def debug(self, msg):
        pass

    info = warning = debug

    def error(self, msg):
        self.errors.append(str(msg))


def setup_gallerydl(settings):
    """Mirror `gallery-dl --config-ignore --range 1-N [--cookies F]` once, process-wide.

    gallery-dl's config is global, so per-request values can't be set safely from threads. Cookies
    only differ between Instagram and everything else (see cookies.js), which maps onto gallery-dl's
    per-extractor config: deeper keys override shallower ones.
    """
    gdl_config.clear()
    gdl_config.set((), "file-range", settings.get("range") or "1-20")
    if settings.get("cookies"):
        gdl_config.set(("extractor",), "cookies", settings["cookies"])
    if settings.get("instagramCookies"):
        gdl_config.set(("extractor", "instagram"), "cookies", settings["instagramCookies"])
    logging.getLogger("gallery-dl").setLevel(logging.CRITICAL)


def probe_ytdlp(req):
    log = CaptureLogger()
    opts = yt_dlp.parse_options(req["args"]).ydl_opts
    opts.update(quiet=True, no_warnings=True, noprogress=True, logger=log, simulate=True,
                dump_single_json=False, forcejson=False)
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(req["url"], download=False)
            # The CLI's default ignoreerrors="only_download" makes some failures return None instead of
            # raising (the CLI then exits non-zero). Treat that, or any logged error, as a failure.
            if info is None or (log.errors and not info.get("formats") and not info.get("entries") and not info.get("url")):
                return {"ok": False, "stderr": "\n".join(log.errors) or "ERROR: no result"}
            return {"ok": True, "out": json.dumps(ydl.sanitize_info(info), ensure_ascii=True)}
    except yt_dlp.utils.DownloadError as exc:
        return {"ok": False, "stderr": "\n".join(log.errors + [str(exc)])}


def probe_gallerydl(req):
    buf = io.StringIO()
    # gallery-dl throttles requests (Instagram: 6-12 s apart) using ONE process-wide timestamp. A fresh
    # CLI process starts at 0; without this reset, any earlier probe would delay the next one.
    GdlExtractor.request_timestamp = 0.0
    job = gdl_job.DataJob(req["url"], file=None, resolve=True)
    job.run()
    gdl_util.dump_json(job.data, buf, True, 2)
    return {"ok": True, "out": buf.getvalue()}


HANDLERS = {"ytdlp": probe_ytdlp, "gallerydl": probe_gallerydl}


def handle(req):
    rid = req.get("id")
    try:
        result = HANDLERS[req["tool"]](req)
    except Exception as exc:  # noqa: BLE001 - report every failure to the caller, never crash the worker
        result = {"ok": False, "stderr": f"ERROR: {exc.__class__.__name__}: {exc}"}
    result["id"] = rid
    send(result)


# Sample links, used only to load extractor code ahead of time. No network requests are made.
WARM_URLS = [
    "https://www.instagram.com/p/AAAAAAAAAAA/",
    "https://x.com/a/status/1",
    "https://www.facebook.com/watch/?v=1",
    "https://www.pinterest.com/pin/1/",
    "https://www.tiktok.com/@a/video/1",
    "https://www.reddit.com/r/a/comments/a/a/",
    "https://www.threads.net/@a/post/A",
]


def warm_up():
    """Do the first-probe work (lazy imports, extractor classes, TLS setup) before anyone is waiting."""
    try:
        from gallery_dl import extractor as gdl_extractor

        with yt_dlp.YoutubeDL({"quiet": True, "logger": CaptureLogger()}) as ydl:
            for url in WARM_URLS:
                for ie in ydl._ies.values():
                    if ie.suitable(url):
                        ydl.get_info_extractor(ie.ie_key())
                        break
                gdl_extractor.find(url)
            ydl.urlopen  # noqa: B018 - touch the request director so its handlers load
            ydl._request_director  # noqa: B018
    except Exception:  # noqa: BLE001 - warm-up is best effort
        pass


def main():
    settings = json.loads(sys.argv[1]) if len(sys.argv) > 1 else {}
    setup_gallerydl(settings)
    send({"ready": True, "ytdlp": YTDLP_VERSION, "gallerydl": GALLERYDL_VERSION})
    threading.Thread(target=warm_up, daemon=True).start()

    pool = ThreadPoolExecutor(max_workers=int(settings.get("threads") or 8))
    for raw in sys.stdin.buffer:
        raw = raw.strip()
        if not raw:
            continue
        try:
            req = json.loads(raw.decode("utf-8"))
        except ValueError:
            continue
        pool.submit(handle, req)
    # stdin closed: the server is shutting down or restarting us.
    pool.shutdown(wait=False, cancel_futures=True)


if __name__ == "__main__":
    main()
