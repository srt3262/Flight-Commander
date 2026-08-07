#!/usr/bin/env python3
"""Recreate the exact Flight Commander 4.0.6 firmware source from 4.0.5.

The Configurator repository retains the published 4.0.5 source archive and a
reviewable patch containing every 4.0.6 firmware change. This script verifies,
extracts, patches and fingerprints that source before the coordinated build.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import zipfile
from pathlib import Path

VERSION = "4.0.6"
BASE_VERSION = "4.0.5"
SOURCE_DATE_EPOCH = 1786032000
BASE_SOURCE_SHA256 = "0f5b6b1225b928bbaee0e2078f41e59e788bbec76063ad2fb8b295c314cb7a88"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def source_records(root: Path) -> list[str]:
    records: list[str] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.name == "RELEASE-MANIFEST.json":
            continue
        relative = path.relative_to(root).as_posix()
        records.append(f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {relative}\n")
    return records


def source_identities(root: Path) -> tuple[str, str]:
    records = "".join(source_records(root))
    revision = hashlib.sha1(records.encode()).hexdigest()
    tree = hashlib.sha1(("flight-commander-source-tree-v1\n" + records).encode()).hexdigest()
    return revision, tree


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--patch", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--metadata", type=Path)
    args = parser.parse_args()

    archive = args.archive.resolve()
    patch = args.patch.resolve()
    output = args.output.resolve()
    expected_root = f"Flight-Commander-Firmware-Source-v{BASE_VERSION}"
    final_root = output / f"Flight-Commander-Firmware-Source-v{VERSION}"

    if sha256(archive) != BASE_SOURCE_SHA256:
        raise RuntimeError("Retained 4.0.5 firmware source archive SHA-256 does not match the published baseline")
    if output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True)

    with zipfile.ZipFile(archive) as zipped:
        members = zipped.namelist()
        if not members or any(not name.startswith(expected_root + "/") for name in members):
            raise RuntimeError(f"Firmware source archive must contain only {expected_root}/")
        zipped.extractall(output)

    extracted = output / expected_root
    extracted.rename(final_root)
    subprocess.run(
        ["git", "-C", str(final_root), "apply", "--whitespace=error-all", str(patch)],
        check=True,
    )

    manifest_path = final_root / "RELEASE-MANIFEST.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    revision, tree = source_identities(final_root)
    manifest.update({
        "schema": 1,
        "product": "Flight Commander Firmware",
        "version": VERSION,
        "target": "MICOAIR743",
        "source_revision": revision,
        "source_tree": tree,
        "source_date_epoch": SOURCE_DATE_EPOCH,
        "capability_mask": "0x00007fff",
        "artifact": {
            "name": f"Flight-Commander-Firmware-{VERSION}-MICOAIR743.hex",
            "sha256": "0" * 64,
            "bytes": 0,
        },
    })
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    metadata = {
        "version": VERSION,
        "root": str(final_root),
        "source_revision": revision,
        "source_tree": tree,
        "source_date_epoch": SOURCE_DATE_EPOCH,
        "patch_sha256": sha256(patch),
        "baseline_source_sha256": BASE_SOURCE_SHA256,
    }
    if args.metadata:
        args.metadata.parent.mkdir(parents=True, exist_ok=True)
        args.metadata.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(metadata))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
