#!/usr/bin/env python3
"""Minimal Prometheus exporter for Transmission's RPC API. Standard library only.

Env: TRANSMISSION_URL (…/transmission/rpc), TRANSMISSION_USERNAME, TRANSMISSION_PASSWORD, PORT.
Each scrape makes two RPC calls (session-stats, torrent-get); nothing is cached.
"""
import base64
import json
import os
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

URL = os.environ.get("TRANSMISSION_URL", "http://transmission:9091/transmission/rpc")
USER = os.environ.get("TRANSMISSION_USERNAME", "")
PASS = os.environ.get("TRANSMISSION_PASSWORD", "")
PORT = int(os.environ.get("PORT", "19091"))

# https://github.com/transmission/transmission/blob/main/docs/rpc-spec.md (torrent "status")
STATUS = {0: "stopped", 1: "check_wait", 2: "checking", 3: "download_wait", 4: "downloading", 5: "seed_wait", 6: "seeding"}


class RPC:
    def __init__(self):
        self.session_id = ""

    def call(self, method, arguments=None):
        body = json.dumps({"method": method, "arguments": arguments or {}}).encode()
        for _ in range(2):
            req = urllib.request.Request(URL, body, {"Content-Type": "application/json", "X-Transmission-Session-Id": self.session_id})
            if USER:
                req.add_header("Authorization", "Basic " + base64.b64encode(f"{USER}:{PASS}".encode()).decode())
            try:
                with urllib.request.urlopen(req, timeout=10) as resp:
                    data = json.load(resp)
            except urllib.error.HTTPError as e:
                if e.code == 409:  # Transmission's CSRF guard: retry with the session id it hands back
                    self.session_id = e.headers.get("X-Transmission-Session-Id", "")
                    continue
                raise
            if data.get("result") != "success":
                raise RuntimeError(f"{method}: {data.get('result')}")
            return data["arguments"]
        raise RuntimeError("session id handshake failed")


rpc = RPC()


def collect():
    out = []

    def metric(name, help_, samples, kind="gauge"):
        out.append(f"# HELP {name} {help_}")
        out.append(f"# TYPE {name} {kind}")
        for labels, value in samples:
            lbl = ",".join(f'{k}="{v}"' for k, v in labels.items())
            out.append(f"{name}{{{lbl}}} {value}" if lbl else f"{name} {value}")

    try:
        stats = rpc.call("session-stats")
        torrents = rpc.call("torrent-get", {"fields": ["status", "sizeWhenDone", "leftUntilDone", "error"]})["torrents"]
        up = 1
    except Exception as e:  # report down rather than failing the scrape
        print(f"scrape failed: {e}", flush=True)
        up = 0

    metric("transmission_up", "Whether the last RPC call to Transmission succeeded.", [({}, up)])
    if not up:
        return "\n".join(out) + "\n"

    metric("transmission_download_speed_bytes", "Current total download rate in bytes/s.", [({}, stats["downloadSpeed"])])
    metric("transmission_upload_speed_bytes", "Current total upload rate in bytes/s.", [({}, stats["uploadSpeed"])])

    counts = dict.fromkeys(STATUS.values(), 0)
    for t in torrents:
        s = STATUS.get(t["status"], "unknown")
        counts[s] = counts.get(s, 0) + 1
    metric("transmission_torrents", "Number of torrents by status.", [({"status": s}, n) for s, n in counts.items()])
    metric("transmission_torrents_errored", "Number of torrents reporting an error.", [({}, sum(1 for t in torrents if t.get("error")))])

    downloading = [t for t in torrents if t["status"] in (3, 4)]
    metric("transmission_downloading_size_bytes", "Total size of downloading/queued torrents.", [({}, sum(t["sizeWhenDone"] for t in downloading))])
    metric("transmission_downloading_left_bytes", "Bytes still to download for downloading/queued torrents.", [({}, sum(t["leftUntilDone"] for t in downloading))])
    return "\n".join(out) + "\n"


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/metrics":
            body, ctype = collect().encode(), "text/plain; version=0.0.4"
        elif self.path == "/healthz":
            body, ctype = b"ok\n", "text/plain"
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    print(f"listening on :{PORT}, scraping {URL}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
