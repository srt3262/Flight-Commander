#!/usr/bin/env python3
"""Finalize the 4.0.2 beta publication path, then remove this one-time helper."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "tests/flight-commander/packaging/package-contract.test.mjs"
BACKUP = ROOT / "tests/flight-commander/packaging/package-contract.test.mjs.pending"
PUBLISHER = ROOT / ".github/workflows/publish-flight-commander-beta.yml"
INTEGRATION = ROOT / "scripts/apply-flight-commander-4.0.2-beta.py"
SELF = ROOT / "scripts/finalize-flight-commander-4.0.2-beta.py"
WORKFLOW = ROOT / ".github/workflows/finalize-flight-commander-4.0.2-beta-once.yml"
COMPETING_WORKFLOWS = (
    ROOT / ".github/workflows/repair-4.0.2-release-branch.yml",
    ROOT / ".github/workflows/repair-4.0.2-release-branch-v2.yml",
)


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one occurrence, found {count}: {old!r}")
    return text.replace(old, new, 1)


def restore_contract() -> None:
    if CONTRACT.exists():
        raise RuntimeError(f"Temporary contract target unexpectedly exists: {CONTRACT}")
    text = BACKUP.read_text(encoding="utf-8")
    edits = (
        (
            ".github/workflows/publish-flight-commander-4.0.2-beta.yml",
            ".github/workflows/publish-flight-commander-beta.yml",
        ),
        (
            "assert.match(releaseOrchestrator, /Publish Flight Commander 4\\.0\\.2 beta prerelease/);",
            "assert.match(releaseOrchestrator, /name: Publish Flight Commander beta release/);",
        ),
        (
            "assert.match(releaseOrchestrator, /Remove every standalone Flight Commander firmware asset older than 4\\.0\\.0/);",
            "assert.match(releaseOrchestrator, /The beta candidate does not contain exactly the four canonical components/);",
        ),
        (
            "assert.match(releaseOrchestrator, /Superseded firmware remains after cleanup/);",
            "assert.match(releaseOrchestrator, /Complete beta ZIP contains exactly four byte-matched components/);",
        ),
    )
    for old, new in edits:
        text = replace_once(text, old, new, "package contract")
    CONTRACT.write_text(text, encoding="utf-8", newline="\n")
    BACKUP.unlink()


def update_integration_helper() -> None:
    text = INTEGRATION.read_text(encoding="utf-8")
    text = replace_once(
        text,
        'BETA_WORKFLOW = ".github/workflows/publish-flight-commander-4.0.2-beta.yml"',
        'BETA_WORKFLOW = ".github/workflows/publish-flight-commander-beta.yml"',
        "4.0.2 integration helper",
    )
    text = replace_once(
        text,
        "assert.match(releaseOrchestrator, /Publish Flight Commander 4\\\\.0\\\\.2 beta prerelease/);",
        "assert.match(releaseOrchestrator, /name: Publish Flight Commander beta release/);",
        "4.0.2 integration helper",
    )
    INTEGRATION.write_text(text, encoding="utf-8", newline="\n")


def trigger_canonical_publisher() -> None:
    text = PUBLISHER.read_text(encoding="utf-8")
    marker = "name: Publish Flight Commander beta release\n"
    run_name = "run-name: Flight Commander beta ${{ github.sha }}\n"
    if run_name not in text:
        text = replace_once(text, marker, marker + run_name, "canonical beta publisher")
    if "agent/fix-compass-persistence-and-local-flashing" not in text:
        raise RuntimeError("The reviewed release branch is not enabled for this beta publication run.")
    PUBLISHER.write_text(text, encoding="utf-8", newline="\n")


def remove_competing_workflows() -> None:
    for path in COMPETING_WORKFLOWS:
        path.unlink(missing_ok=True)


def verify() -> None:
    contract = CONTRACT.read_text(encoding="utf-8")
    publisher = PUBLISHER.read_text(encoding="utf-8")
    integration = INTEGRATION.read_text(encoding="utf-8")
    stale = ".github/workflows/publish-flight-commander-4.0.2-beta.yml"
    if stale in contract or stale in integration:
        raise RuntimeError("A stale version-specific beta workflow reference remains.")
    required = (
        "name: Publish Flight Commander beta release",
        "The beta candidate does not contain exactly the four canonical components",
        "Complete beta ZIP contains exactly four byte-matched components",
    )
    for marker in required:
        if marker not in contract and marker not in publisher:
            raise RuntimeError(f"Required publication contract is missing: {marker}")
    for path in COMPETING_WORKFLOWS:
        if path.exists():
            raise RuntimeError(f"Competing repair workflow remains: {path}")


def main() -> None:
    restore_contract()
    update_integration_helper()
    trigger_canonical_publisher()
    remove_competing_workflows()
    verify()
    WORKFLOW.unlink()
    SELF.unlink()
    print("Flight Commander 4.0.2 beta publication path finalized.")


if __name__ == "__main__":
    main()
