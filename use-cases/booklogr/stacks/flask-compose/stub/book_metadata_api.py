#!/usr/bin/env python3
"""Book-metadata API for booklogr's BookProvider.

Implements the endpoints BookProvider hits when DATA_PROVIDER is a custom URL
(the "booklogr-api" provider shape): /v1/search/<q>, /v1/edition/<isbn>,
/v1/work/<id>. Self-contained (stdlib only) so the deployment serves book
metadata locally instead of depending on the public internet API.
"""
import json
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, unquote

LATENCY_MS = int(os.environ.get("LATENCY_MS", "1200"))
PORT = int(os.environ.get("PORT", "8080"))


class Handler(BaseHTTPRequestHandler):
    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/health":
            return self._json(200, {"ok": True})

        time.sleep(LATENCY_MS / 1000.0)

        parts = [p for p in path.split("/") if p]
        if len(parts) >= 3 and parts[:2] == ["v1", "edition"]:
            isbn = unquote(parts[2])
            return self._json(200, {
                "title": f"Book {isbn}",
                "author_names": ["A. Author"],
                "work_ids": [f"/works/W{isbn}"],
                "number_of_pages": 300,
            })
        if len(parts) >= 3 and parts[:2] == ["v1", "work"]:
            return self._json(200, {"description": "A generated description."})
        if len(parts) >= 3 and parts[:2] == ["v1", "search"]:
            q = unquote(parts[2])
            return self._json(200, [
                {
                    "isbn_13": [f"978{str(1000000000 + i).zfill(10)[:10]}"],
                    "isbn_10": [],
                    "title": f"{q} result {i}",
                    "author_names": ["A. Author"],
                }
                for i in range(10)
            ])
        return self._json(404, {"message": "Not found"})

    def log_message(self, *args):
        pass  # quiet


if __name__ == "__main__":
    print(f"book-metadata-api listening on :{PORT}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
