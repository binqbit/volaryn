import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import subprocess
import tempfile
from threading import Thread
import unittest

ROOT = Path(__file__).resolve().parents[2]


class SmokeTest(unittest.TestCase):
    def test_hosted_release_must_match_artifacts_and_readiness(self):
        release = {"revision": "a" * 40, "programSha256": "b" * 64, "localnet": False}
        manifest = {"mode": "mainnet", "assets": [{"mint": "public-asset"}]}
        state = {"release": release, "index_status": 200, "requests": []}

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                state["requests"].append(self.path)
                self.send_response(state["index_status"] if self.path == "/health/index" else 200)
                self.end_headers()
                bodies = {
                    "/api/release": state["release"],
                    "/api/config": manifest,
                    "/api/assets": manifest["assets"],
                }
                content = (
                    json.dumps(bodies[self.path]).encode()
                    if self.path in bodies
                    else b'<div id="root"></div>'
                )
                self.wfile.write(content)

            def log_message(self, *args):
                pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                (root / "release.json").write_text(json.dumps(release))
                (root / "deployment.json").write_text(json.dumps(manifest))
                command = [
                    "python3",
                    str(ROOT / "tools/release/smoke.py"),
                    f"http://127.0.0.1:{server.server_port}",
                    "--release",
                    str(root),
                    "--manifest",
                    str(root / "deployment.json"),
                ]
                self.assertEqual(subprocess.run(command, capture_output=True).returncode, 0)
                state["release"] = {**release, "revision": "c" * 40}
                self.assertNotEqual(subprocess.run(command, capture_output=True).returncode, 0)
                state["release"] = release
                state["index_status"] = 503
                self.assertNotEqual(subprocess.run(command, capture_output=True).returncode, 0)
                self.assertNotIn("/rpc", state["requests"])
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == "__main__":
    unittest.main()
