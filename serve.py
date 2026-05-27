"""Local static server for Skibidi Tower (Windows-safe, correct ES-module MIME).

Serves the game at /, and mounts the sibling Three.js editor checkout under
/editor/ + /build/ + /examples/ + /files/ + /src/ so the editor shares the
game's origin (no CORS, no cross-origin module imports). The "Save Level"
menu item in the editor POSTs to /api/save-level here, which writes the
request body to data/levelData.json so the game picks it up on the next
reload.

Default port is 8081 (the user-requested port). Set PORT=xxxx to change.
"""
import errno
import http.server
import json
import os
import socket
import threading

_ROOT = os.path.dirname(os.path.abspath(__file__))
os.chdir(_ROOT)

# Three.js editor checkout. Project layout (per the user's environment):
#   D:/_Proj_src/Sandscape/Games/SkibidiTower/Skibidi Tower/   <- this folder
#   D:/_Proj_src/Sandscape/Games/three.js_Editor/              <- editor sibling
# Five URL prefixes get mapped onto its tree so the editor's importmap
# (../build/, ../examples/jsm/, ../files/, ../src/) keeps working.
_EDITOR_ROOT = os.path.normpath(
    os.path.join(_ROOT, "..", "..", "three.js_Editor")
)
_EDITOR_PREFIXES = ("/editor/", "/build/", "/examples/", "/files/", "/src/")

# Folders under assets/ that contain custom-prop GLBs. /api/asset-kits returns
# { filename: kit_folder } so the level adapter (and the game runtime, if it
# ever loads custom props) can resolve a bare filename to a URL. Drop a new
# folder name in here when you add a new kit.
_KIT_FOLDERS = ("models", "props")


def _requested_port() -> int:
    return int(os.environ.get("PORT", "8081"))


def _addr_in_use(err: OSError) -> bool:
    if err.errno == errno.EADDRINUSE:
        return True
    # Windows: 10048 (address already in use), 10013 (access denied / port
    # reserved — fires when a port is in TIME_WAIT or kernel-reserved).
    if getattr(err, "winerror", None) in (10013, 10048):
        return True
    return False


# Register before Windows mimetypes: stdlib checks extensions_map first.
_extensions = dict(http.server.SimpleHTTPRequestHandler.extensions_map)
_extensions.update(
    {
        ".js": "application/javascript",
        ".mjs": "application/javascript",
        ".wasm": "application/wasm",
        ".json": "application/json",
        ".glb": "model/gltf-binary",
        ".gltf": "model/gltf+json",
    }
)


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = _extensions

    def do_GET(self) -> None:
        path = self.path.split("?", 1)[0]
        if path == "/api/asset-kits":
            self._serve_asset_kits()
            return
        super().do_GET()

    def _serve_asset_kits(self) -> None:
        # Return { filename: "kit_folder", ... } for every .glb under each
        # known kit folder. Collisions warn on the console; last writer wins.
        manifest = {}
        for kit in _KIT_FOLDERS:
            kit_dir = os.path.join(_ROOT, "assets", kit)
            if not os.path.isdir(kit_dir):
                continue
            for name in os.listdir(kit_dir):
                if not name.lower().endswith(".glb"):
                    continue
                if name in manifest and manifest[name] != kit:
                    print(f"  [asset-kits] WARNING: {name} exists in both "
                          f"{manifest[name]} and {kit}; using {kit}.")
                manifest[name] = kit

        body = json.dumps(manifest).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        # Editor and game both fetch this once at boot; bypass any CDN cache
        # so a fresh GLB drop shows up on the next page load.
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def translate_path(self, path: str) -> str:
        clean = path.split("?", 1)[0].split("#", 1)[0]
        # Bare "/editor" → treat as "/editor/" so the editor's index.html
        # serves when the user types just /editor.
        if clean == "/editor":
            clean = "/editor/"
        for prefix in _EDITOR_PREFIXES:
            if clean.startswith(prefix):
                rel = clean[1:]  # strip leading "/"
                candidate = os.path.normpath(
                    os.path.join(_EDITOR_ROOT, *rel.split("/"))
                )
                # Block traversal outside the editor tree.
                if candidate == _EDITOR_ROOT or candidate.startswith(_EDITOR_ROOT + os.sep):
                    return candidate
                break
        return super().translate_path(path)

    def do_POST(self) -> None:
        path = self.path.split("?", 1)[0]
        if path != "/api/save-level":
            self.send_error(405, "Method Not Allowed")
            return

        length_hdr = self.headers.get("Content-Length")
        if not length_hdr:
            self.send_error(400, "Missing Content-Length")
            return
        try:
            n = int(length_hdr)
        except ValueError:
            self.send_error(400, "Bad Content-Length")
            return

        body = self.rfile.read(n)
        try:
            text = body.decode("utf-8")
        except UnicodeDecodeError:
            self.send_error(400, "Body must be UTF-8")
            return

        try:
            json.loads(text)
        except json.JSONDecodeError as e:
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(
                json.dumps({"ok": False, "error": "Invalid JSON", "detail": str(e)}).encode("utf-8")
            )
            return

        out_path = os.path.join(_ROOT, "data", "levelData.json")
        tmp_path = out_path + ".tmp"
        with self.server.save_lock:
            try:
                os.makedirs(os.path.dirname(out_path), exist_ok=True)
                with open(tmp_path, "w", encoding="utf-8", newline="\n") as f:
                    f.write(text)
                os.replace(tmp_path, out_path)
            except OSError as e:
                try:
                    if os.path.isfile(tmp_path):
                        os.remove(tmp_path)
                except OSError:
                    pass
                self.send_error(500, f"Write failed: {e}")
                return

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"ok":true}')


class _Server(http.server.ThreadingHTTPServer):
    # Default socketserver backlog is 5 — way too low for the editor's burst
    # of ~100 parallel module fetches at startup. Bump it so SYNs past 5
    # don't get RST'd by the kernel.
    request_queue_size = 256
    daemon_threads = True
    # ThreadingHTTPServer defaults these to True; on Windows that lets a
    # second process bind the same port and the kernel splits incoming
    # connections between them. Disable both and let _bind roll forward.
    allow_reuse_address = False
    allow_reuse_port = False
    save_lock = threading.Lock()

    def server_bind(self) -> None:
        # SO_EXCLUSIVEADDRUSE is Windows-only and guarantees no other socket
        # can bind this port while we hold it.
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def _bind_server(start_port: int, attempts: int = 30):
    """Return (server, actual_port). Tries start_port, start_port+1, … if busy."""
    last_err = None
    for p in range(start_port, start_port + attempts):
        try:
            return _Server(("", p), Handler), p
        except OSError as e:
            if _addr_in_use(e):
                last_err = e
                continue
            raise
    raise OSError(
        f"No free port in {start_port}–{start_port + attempts - 1}. "
        "Close the other server or set PORT to an open port."
    ) from last_err


if __name__ == "__main__":
    want = _requested_port()
    httpd, bound = _bind_server(want)
    editor_exists = os.path.isdir(_EDITOR_ROOT)
    with httpd:
        print()
        print("  Skibidi Tower dev server")
        print(f"  Game root:  {_ROOT}")
        print(f"  Editor:     {_EDITOR_ROOT}"
              + ("" if editor_exists else "   [NOT FOUND — /editor/ will 404]"))
        if bound != want:
            print(f"  Port {want} was busy — using {bound} instead.")
        print()
        print(f"  Game URL:   http://localhost:{bound}/index.html")
        print(f"  Editor URL: http://localhost:{bound}/editor/")
        print()
        print("  Open the URLs above in your browser. Ctrl+C to stop.")
        print()
        httpd.serve_forever()
