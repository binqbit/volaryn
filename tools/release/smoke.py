#!/usr/bin/env python3
"""Verify hosted release identity and read paths; never signs or submits transactions."""

import argparse
import json
from pathlib import Path
from urllib.request import urlopen
from urllib.parse import urlsplit

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("url", help="HTTPS origin, or a loopback HTTP origin for a local rehearsal")
parser.add_argument("--release", type=Path, required=True)
parser.add_argument("--manifest", type=Path, required=True)
args = parser.parse_args()
origin = args.url.rstrip("/")
parsed = urlsplit(origin)
if parsed.scheme != "https" and not (
    parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1", "::1"}
):
    parser.error("Use HTTPS outside loopback")
expected = json.loads((args.release / "release.json").read_text())
manifest = json.loads(args.manifest.read_text())


def read(path):
    with urlopen(origin + path, timeout=10) as response:
        data = response.read(2 * 1024 * 1024 + 1)
        if len(data) > 2 * 1024 * 1024:
            raise RuntimeError("Response exceeds the smoke-check bound")
        return data


for path in ["/health/live", "/health/ready", "/health/index"]:
    read(path)
release = json.loads(read("/api/release"))
if (
    release["revision"] != expected["revision"]
    or release["programSha256"] != expected["programSha256"]
    or release["localnet"]
):
    raise SystemExit("Hosted application does not match the selected live release")
config = json.loads(read("/api/config"))
if config != manifest or config["mode"] != "mainnet" or config.get("localnet"):
    raise SystemExit("Hosted deployment identity differs from the reviewed manifest")
assets = json.loads(read("/api/assets"))
if assets != manifest["assets"]:
    raise SystemExit("Hosted asset identities differ from the manifest")
for path in ["/", "/offers", "/offers/new", "/portfolio/activity"]:
    if b'<div id="root"></div>' not in read(path):
        raise SystemExit(f"Frontend navigation failed: {path}")
print(
    "Live release, deployment identity, readiness, assets and navigation verified; no transaction sent."
)
