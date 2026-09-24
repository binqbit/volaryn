#!/usr/bin/env python3
"""Initialize an operator-owned deployment directory from a verified release bundle."""

import argparse
import json
from pathlib import Path
import secrets
import shutil
from urllib.parse import urlsplit

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--release", type=Path, required=True)
parser.add_argument("--rpc-url-file", type=Path, required=True)
parser.add_argument("--authority", required=True, help="Public protocol authority")
parser.add_argument(
    "--upgrade-authority",
    required=True,
    help="Public upgrade authority, or 'none' for immutable code",
)
parser.add_argument("--output", type=Path, default=Path("deployment"))
args = parser.parse_args()
rpc = args.rpc_url_file.read_text().strip()
parsed = urlsplit(rpc)
if parsed.scheme != "https" or not parsed.hostname or "\n" in rpc or "\r" in rpc:
    parser.error("The external RPC secret must contain one HTTPS URL")
if args.output.exists():
    parser.error("The output directory already exists; existing credentials are never replaced")
manifest = json.loads((args.release / "deployment.example.json").read_text())
manifest["authority"] = args.authority
manifest["upgradeAuthority"] = None if args.upgrade_authority == "none" else args.upgrade_authority
# Validate the public input shape here; the application verifies decoded keys and chain ownership.
alphabet = set("123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz")
for value in [args.authority, manifest["upgradeAuthority"]]:
    if value is not None and (not 32 <= len(value) <= 44 or not set(value) <= alphabet):
        parser.error("Authorities must be public Solana addresses")
args.output.mkdir(mode=0o700)
secret_dir = args.output / "secrets"
secret_dir.mkdir(mode=0o700)
password = secrets.token_hex(32)
for name, content in {
    "postgres-password": secrets.token_hex(32),
    "database-password": password,
    "database-url": f"postgresql://volaryn:{password}@database:5432/volaryn",
    "rpc-url": rpc,
}.items():
    path = secret_dir / name
    path.write_text(content + "\n")
    # Parent directories restrict host access; runtime uid 1000 must read bind-mounted secrets.
    path.chmod(0o444)
(args.output / "deployment.json").write_text(json.dumps(manifest, indent=2) + "\n")
shutil.copyfile(args.release / "release.env", args.output / "release.env")
print(
    "Deployment files prepared. Review the admitted assets before the read-only deployment check."
)
