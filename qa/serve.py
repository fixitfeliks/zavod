#!/usr/bin/env python3
# Static server with Cache-Control: no-store so edited modules are never served stale by the browser.
# Usage: python3 qa/serve.py [port] [bind-address]; default bind is localhost. It serves the repo folder, so .git and .env* are
# refused (a phone on the LAN can reach it when bound to 0.0.0.0).
import http.server, socketserver, sys, urllib.parse
class H(http.server.SimpleHTTPRequestHandler):
    def send_head(self):
        parts = urllib.parse.unquote(urllib.parse.urlsplit(self.path).path).split('/')
        if any(p == '.git' or p.startswith('.env') for p in parts): self.send_error(404); return None
        return super().send_head()
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate'); self.send_header('Pragma', 'no-cache'); self.send_header('Expires', '0')
        super().end_headers()
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
with socketserver.ThreadingTCPServer((sys.argv[2] if len(sys.argv) > 2 else '127.0.0.1', int(sys.argv[1]) if len(sys.argv) > 1 else 8790), H) as s: s.serve_forever()
