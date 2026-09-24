#!/usr/bin/env python3
"""Render the technical overview's PlantUML sources and update its online links."""

import argparse
import base64
import hashlib
from pathlib import Path
import sys
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET
import zlib


ROOT = Path(__file__).resolve().parents[1]
DIAGRAMS = ROOT / "docs" / "diagrams"
OVERVIEW = ROOT / "docs" / "technical-overview.md"
SERVER = "https://www.plantuml.com/plantuml"
START = "<!-- diagram-links:start -->"
END = "<!-- diagram-links:end -->"
ALPHABET = bytes.maketrans(
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",
    b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_",
)


def encode(source: bytes) -> str:
    """PlantUML uses raw DEFLATE and its own Base64 alphabet."""
    compressed = zlib.compress(source, level=9)[2:-4]
    return base64.b64encode(compressed).translate(ALPHABET).rstrip(b"=").decode("ascii")


def validate_svg(data: bytes) -> None:
    root = ET.fromstring(data)
    if root.tag != "{http://www.w3.org/2000/svg}svg":
        raise ValueError("Renderer did not return an SVG")
    text = " ".join(root.itertext())
    if "Syntax Error" in text or "An error has occurred" in text:
        raise ValueError("PlantUML reported a diagram error")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check", action="store_true", help="Check source fingerprints and links offline"
    )
    args = parser.parse_args()
    sources = sorted(DIAGRAMS.glob("*.puml"))
    if not sources:
        raise ValueError("No PlantUML sources found")
    document = OVERVIEW.read_text()
    if document.count(START) != 1 or document.count(END) != 1:
        raise ValueError("Overview must contain exactly one generated link block")
    before, rest = document.split(START)
    _, after = rest.split(END)
    links = []
    rendered = []
    for path in sources:
        source = path.read_bytes()
        encoded = encode(source)
        fingerprint = f"<!-- source-sha256: {hashlib.sha256(source).hexdigest()} -->".encode()
        target = path.with_suffix(".svg")
        links.append(f"[{path.stem}-online]: {SERVER}/uml/{encoded}")
        if args.check:
            data = target.read_bytes()
            validate_svg(data)
            if fingerprint not in data:
                raise ValueError(f"{target.name} needs regeneration")
        else:
            request = Request(f"{SERVER}/svg/{encoded}", headers={"User-Agent": "Volaryn-docs"})
            try:
                with urlopen(request, timeout=45) as response:
                    data = response.read()
            except OSError as error:
                raise ValueError(f"{path.name}: {error}") from error
            validate_svg(data)
            rendered.append((target, data + b"\n" + fingerprint + b"\n"))
        print(f"{'Checked' if args.check else 'Rendered'} {path.name}", flush=True)
    expected = before + START + "\n\n" + "\n".join(links) + "\n\n" + END + after
    if args.check:
        if expected != document:
            raise ValueError("Overview online links need regeneration")
    else:
        # Do not replace any artifacts unless every diagram rendered successfully.
        for target, data in rendered:
            target.write_bytes(data)
        OVERVIEW.write_text(expected)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, ET.ParseError) as error:
        sys.exit(str(error))
