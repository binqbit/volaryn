#!/usr/bin/env python3
"""Extract checksum-pinned token programs from the locked LiteSVM source package."""

import hashlib
import json
import subprocess
from pathlib import Path


def find_program_source(root: Path, crate: str, version: str) -> Path:
    """Resolve fixtures from Cargo's locked dependency, not the global cache order."""
    metadata = json.loads(
        subprocess.check_output(
            ["cargo", "metadata", "--locked", "--format-version", "1"], cwd=root
        )
    )
    for package in metadata["packages"]:
        if package["name"] == crate and package["version"] == version:
            return Path(package["manifest_path"]).parent / "src/programs/elf"
    raise SystemExit(f"Locked fixture source not found: {crate} {version}")


def copy_verified_program(source: Path, destination: Path, expected: str) -> None:
    data = source.read_bytes()
    if hashlib.sha256(data).hexdigest() != expected:
        raise SystemExit(f"Token program checksum mismatch: {source.name}")
    destination.write_bytes(data)
    print(f"Verified token fixture: {source.name}")


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    manifest = json.loads((root / "tests/fixtures/programs.json").read_text())
    source = find_program_source(root, manifest["source_crate"], manifest["source_version"])
    destination = root / "target/fixtures"
    destination.mkdir(parents=True, exist_ok=True)
    for name, expected in manifest["programs"].items():
        copy_verified_program(source / name, destination / name, expected)


if __name__ == "__main__":
    main()
