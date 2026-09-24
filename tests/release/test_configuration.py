"""Exercise operator tooling without a Docker daemon, external service, or real credentials."""

import json
from pathlib import Path
import stat
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
ADDRESS = "11111111111111111111111111111111"


class ConfigurationTest(unittest.TestCase):
    def test_preparation_preserves_public_identity_and_never_replaces_secrets(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            release = root / "release"
            release.mkdir()
            (release / "deployment.example.json").write_text(
                json.dumps({"mode": "mainnet", "programSha256": "a" * 64, "assets": []})
            )
            (release / "release.env").write_text("VOLARYN_IMAGE=sha256:" + "b" * 64 + "\n")
            rpc = root / "rpc-secret"
            rpc.write_text("https://rpc.example.invalid/?key=private-value\n")
            output = root / "deployment"
            command = [
                "python3",
                str(ROOT / "tools/release/configure.py"),
                "--release",
                str(release),
                "--rpc-url-file",
                str(rpc),
                "--authority",
                ADDRESS,
                "--upgrade-authority",
                "none",
                "--output",
                str(output),
            ]
            result = subprocess.run(command, text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertNotIn("private-value", result.stdout + result.stderr)
            manifest = json.loads((output / "deployment.json").read_text())
            self.assertEqual(manifest["authority"], ADDRESS)
            self.assertIsNone(manifest["upgradeAuthority"])
            self.assertEqual(manifest["programSha256"], "a" * 64)
            password = (output / "secrets/database-password").read_text().strip()
            self.assertIn(password, (output / "secrets/database-url").read_text())
            self.assertNotEqual(
                password, (output / "secrets/postgres-password").read_text().strip()
            )
            self.assertEqual(stat.S_IMODE(output.stat().st_mode), 0o700)
            self.assertEqual(stat.S_IMODE((output / "secrets").stat().st_mode), 0o700)
            again = subprocess.run(command, text=True, capture_output=True)
            self.assertNotEqual(again.returncode, 0)
            self.assertEqual(password, (output / "secrets/database-password").read_text().strip())


if __name__ == "__main__":
    unittest.main()
