#!/usr/bin/env python3
"""Refresh the deterministic Flight Commander Firmware 4.0.0 source identity.

The DroneCAN allocator is applied to the expanded firmware tree after the base
4.0.0 migration. This helper recomputes the source revision/tree only after all
source transformations have completed, so the release manifest describes the
exact build input.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

# This helper is a required coordinated-build step after every generated-source
# transformation, including dynamic DroneCAN node allocation support.


def source_records(root: Path) -> list[str]:
    records: list[str] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.name == "RELEASE-MANIFEST.json":
            continue
        relative = path.relative_to(root).as_posix()
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        records.append(f"{digest}  {relative}\n")
    return records


def refresh(root: Path) -> dict[str, object]:
    root = root.resolve()
    manifest_path = root / "RELEASE-MANIFEST.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    records = source_records(root)
    manifest["source_revision"] = hashlib.sha1("".join(records).encode()).hexdigest()
    manifest["source_tree"] = hashlib.sha1(
        ("flight-commander-source-tree-v1\n" + "".join(records)).encode()
    ).hexdigest()
    manifest.setdefault("moving_baseline", {})["dynamic_node_allocation"] = (
        "Flight Commander non-redundant DroneCAN allocator; temporary IDs are "
        "persisted to AP_Periph CAN_NODE during pair setup"
    )
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True, type=Path)
    arguments = parser.parse_args()
    manifest = refresh(arguments.root)
    print(json.dumps({
        "source_revision": manifest["source_revision"],
        "source_tree": manifest["source_tree"],
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
