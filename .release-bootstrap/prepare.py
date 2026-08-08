#!/usr/bin/env python3
"""Create the clean Flight Commander 4.1.3 repository and finalize its metadata."""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import stat
import subprocess
import tempfile
import zipfile
from pathlib import Path


VERSION = "4.1.3"
SOURCE_DATE_EPOCH = 1786219200
LEGACY_FIRMWARE_ZIP = Path(
    "release/firmware/Flight-Commander-Firmware-Source-v4.0.8.zip"
)

DROP_ROOT_FILES = {
    "3D_model_creation.md",
    "CLAUDE.md",
    "MAPPROXY.md",
    "configurator-4.0.0-apply.log",
    "configurator-4.0.0-apply.status",
    "firmware-4.0.0-build-metadata.json",
    "firmware-4.0.0-build.log",
    "firmware-4.0.0-build.status",
    "firmware-4.0.0-tests.status",
    "firmware-source-inventory-3.0.7.txt",
}

DROP_PREFIXES = (
    ".github/",
    ".release-bootstrap/",
    ".vscode/",
    "dev/firmware-",
    "firmware-inspection/",
    "release/",
    "scripts/recovery/",
)

DROP_CONFIG_FILES = {
    "assets/linux/icon/inav_icon_128.png",
    "assets/linux/icon/inav_icon_english_128.png",
    "assets/windows/inav_installer_icon.ico",
    "images/cf_logo_white.svg",
}

DROP_CONFIG_SCRIPTS = {
    "apply-flight-commander-4.0.0.py",
    "apply-flight-commander-4.0.2-beta.py",
    "apply-flight-commander-4.0.3-beta.py",
    "apply-flight-commander-4.0.8-configurator-calibration.py",
    "apply-flight-commander-4.0.8-firmware-calibration.py",
    "apply-local-firmware-loader-fix.py",
    "assemble-flight-commander-4.0.8-beta.py",
    "build-flight-commander-4.0.6.py",
    "build-flight-commander-4.0.7-firmware.py",
    "build-flight-commander-4.0.8-firmware.py",
    "finalize-flight-commander-4.0.0-contracts.py",
    "finalize-flight-commander-4.0.8-calibration.py",
    "flight_commander_dronecan_allocator_4_0_0.py",
    "prepare-flight-commander-firmware-4.0.0.py",
    "prepare-flight-commander-firmware-4.0.1.py",
    "prepare-flight-commander-firmware-4.0.2.py",
    "prepare-flight-commander-firmware-4.0.3.py",
    "prepare-flight-commander-firmware-4.0.6.py",
    "rebuild-firmware-source-archive.sh",
    "refresh-flight-commander-firmware-manifest-4.0.0.py",
}

ROOT_README = """# Flight Commander

Flight Commander is an integrated autopilot project for the MICOAIR743 target.
The official 4.1.3 release pairs **Flight Commander Firmware 4.1.3** with
**Flight Commander Configurator 4.1.3**.

## Repository layout

The firmware follows the [INAV repository](https://github.com/inavflight/inav)
layout and is built directly from the repository root.

| Path | Purpose |
| --- | --- |
| `src/`, `lib/`, `cmake/`, `dev/` | Firmware source and build support |
| `flight-commander/` | Reproducible MICOAIR743 release tooling |
| `configurator/` | Electron Configurator application and tests |
| `docs/` | Flight Commander operator and developer documentation |
| `.github/workflows/` | Continuous integration and official release publication |

## Build and test

Firmware releases require Arm GNU Toolchain 13.2.1, CMake, Ninja, and Python 3:

```bash
export PATH="$(bash flight-commander/install-toolchain.sh):$PATH"
python3 flight-commander/package-release.py \
  --output /tmp/flight-commander-release \
  --build-dir /tmp/flight-commander-build
```

Configurator development requires Node.js 22 and Yarn 1.22.22:

```bash
cd configurator
yarn install --frozen-lockfile
yarn test
```

See the [documentation hub](docs/README.md), the
[firmware flashing guide](docs/FIRMWARE_FLASHING.md), and the
[4.1.3 release notes](docs/releases/v4.1.3.md).

## Upstream and licensing

The firmware is based on the hash-pinned INAV 9.1.0 source identified in
`flight-commander/INAV-9.1.0-BASELINE.json`. Flight Commander changes remain
licensed under GNU GPL v3; see [LICENSE](LICENSE).
"""

RELEASE_NOTES = """# Flight Commander 4.1.3

Flight Commander 4.1.3 is the coordinated official release of Configurator
4.1.3 and Firmware 4.1.3 for MICOAIR743.

## Highlights

- Restores the native Ground Control command path and the corrected firmware
  flashing flow completed for Configurator 4.1.3.
- Updates only the firmware release identity from 4.0.8 to 4.1.3; flight
  behavior and the reviewed INAV 9.1.0-based firmware implementation are
  unchanged.
- Makes the complete firmware source the repository root in an INAV-style
  layout and moves the Configurator to `configurator/`.
- Replaces archived reconstruction inputs and historical maintenance workflows
  with direct, reproducible source builds.

## Official assets

`Flight-Commander-v4.1.3.zip` contains exactly:

- `FC-Windows-v4.1.3.zip`
- `FC-Configurator-Source-v4.1.3.zip`
- `FC-Firmware-v4.1.3-MICOAIR743.hex`
- `FC-Firmware-Source-v4.1.3.zip`

The standalone `Flight-Commander-Firmware-4.1.3-MICOAIR743.hex` is also
published for the Configurator's online flasher. Both public release assets are
verified against the committed source and release metadata before publication.
"""

ROOT_GITIGNORE = """# Firmware build output
*.o
*.dep
*.elf
*.hex
*.map
*.bak
*.swp
*~
/.cache/
/build/
/build_*/
/cmake-build-debug/
/downloads/
/ninja/
/obj/
/release/
/settings.json
/[hs]itl/
/*_SITL/
__pycache__/

# Configurator dependencies and output
/configurator/node_modules/
/configurator/out/
/configurator/.vite/
/configurator/cache/
/configurator/dist/
/configurator/apps/
/configurator/build/
/configurator/eeprom.bin
/configurator/nbproject/
/configurator/.idea/
/configurator/*.iml
/configurator/npm-debug.log

# Retired UI files
/configurator/src/css/ardupilot_setup.css
/configurator/tabs/ardupilot_pid_tuning.html
/configurator/tabs/ardupilot_pid_tuning.js
/configurator/tabs/ardupilot_ports.html
/configurator/tabs/ardupilot_ports.js
/configurator/tabs/ardupilot_receiver.html
/configurator/tabs/ardupilot_receiver.js

# Local editor and operating-system files
.DS_Store
.project
.settings/
.vagrant/
launch.json
tags
TAGS
tokens.yaml
"""

ROOT_GITATTRIBUTES = """* -text
*.md text eol=lf
*.c text
*.h text
*.cc text
*.S text
*.s text
*.ld text
*.js text
*.mjs text
*.cjs text
*.json text
*.html -text
*.css text
*.txt text
*.sh text eol=lf
*.bat text eol=crlf
*.png -text -diff
*.svg -text -diff
*.hex -text -diff
*.elf -text -diff
*.zip -text -diff
LICENSE text
Makefile text
"""


def run(*args: str | Path, cwd: Path | None = None) -> str:
    command = [str(value) for value in args]
    print("+", " ".join(command), flush=True)
    return subprocess.check_output(command, cwd=cwd, text=True)


def copy_file(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)


def write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def replace_exact(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    if old not in text:
        raise RuntimeError(f"Expected text is missing from {path}: {old[:100]!r}")
    path.write_text(text.replace(old, new), encoding="utf-8")


def replace_regex(path: Path, pattern: str, replacement: str, count: int = 1) -> None:
    text = path.read_text(encoding="utf-8")
    changed, matches = re.subn(
        pattern,
        lambda _match: replacement,
        text,
        count=count,
        flags=re.DOTALL,
    )
    if matches != count:
        raise RuntimeError(
            f"Expected {count} match(es) in {path}, received {matches}: {pattern[:100]!r}"
        )
    path.write_text(changed, encoding="utf-8")


def safe_extract(archive_path: Path, destination: Path) -> Path:
    with zipfile.ZipFile(archive_path) as archive:
        root = destination.resolve()
        for member in archive.infolist():
            candidate = (destination / member.filename).resolve()
            if candidate != root and root not in candidate.parents:
                raise RuntimeError(f"Unsafe firmware source member: {member.filename}")
        archive.extractall(destination)
    directories = [path for path in destination.iterdir() if path.is_dir()]
    if len(directories) != 1:
        raise RuntimeError("Firmware source ZIP must contain exactly one root directory")
    return directories[0]


def is_configurator_file(relative: Path) -> bool:
    value = relative.as_posix()
    if value in DROP_ROOT_FILES:
        return False
    if value in DROP_CONFIG_FILES:
        return False
    if any(value.startswith(prefix) for prefix in DROP_PREFIXES):
        return False
    if value in {".gitattributes", ".gitignore", "README.md", "LICENSE"}:
        return False
    if value == "tests/flight-commander/firmware/export-calibration-source.test.mjs":
        return False
    if relative.parts[:1] == ("scripts",) and relative.name in DROP_CONFIG_SCRIPTS:
        return False
    return True


def stage_original_source(root: Path, staging: Path) -> tuple[Path, Path, Path]:
    archive = root / LEGACY_FIRMWARE_ZIP
    if not archive.is_file():
        raise RuntimeError(f"Retained Firmware 4.0.8 source ZIP is missing: {archive}")
    firmware_archive = staging / archive.name
    copy_file(archive, firmware_archive)

    tracked = run("git", "ls-files", "-z", cwd=root).split("\0")
    configurator = staging / "configurator"
    docs = staging / "docs"
    for raw in tracked:
        if not raw:
            continue
        relative = Path(raw)
        source = root / relative
        if relative.parts[:1] == ("docs",):
            copy_file(source, docs / Path(*relative.parts[1:]))
        elif is_configurator_file(relative):
            copy_file(source, configurator / relative)

    copy_file(root / "README.md", configurator / "README.md")
    copy_file(root / "LICENSE", configurator / "LICENSE")
    return firmware_archive, configurator, docs


def clear_worktree(root: Path) -> None:
    for path in root.iterdir():
        if path.name == ".git":
            continue
        if path.is_dir() and not path.is_symlink():
            shutil.rmtree(path)
        else:
            path.unlink()


def copy_tree_contents(source: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    for child in source.iterdir():
        target = destination / child.name
        if child.is_dir() and not child.is_symlink():
            shutil.copytree(child, target, copy_function=shutil.copy2)
        else:
            shutil.copy2(child, target)


def patch_firmware(root: Path) -> None:
    replace_exact(
        root / "CMakeLists.txt",
        "set(FLIGHT_COMMANDER_FIRMWARE_VERSION 4.0.8)",
        "set(FLIGHT_COMMANDER_FIRMWARE_VERSION 4.1.3)",
    )
    replace_exact(
        root / "src/main/build/flight_commander.h",
        "#define FLIGHT_COMMANDER_VERSION_MINOR 0\n#define FLIGHT_COMMANDER_VERSION_PATCH 8",
        "#define FLIGHT_COMMANDER_VERSION_MINOR 1\n#define FLIGHT_COMMANDER_VERSION_PATCH 3",
    )
    for relative in (
        "flight-commander/build-micoair743.sh",
        "flight-commander/verify-release.py",
        "flight-commander/verify-compass-release.py",
    ):
        path = root / relative
        path.write_text(
            path.read_text(encoding="utf-8").replace("4.0.8", VERSION),
            encoding="utf-8",
        )
    replace_exact(
        root / "flight-commander/verify-compass-release.py",
        "bytes((1, 4, 0, 8, 9, 1, 0, 0xFF, 0xFF, 0, 0))",
        "bytes((1, 4, 1, 3, 9, 1, 0, 0xFF, 0xFF, 0, 0))",
    )
    replace_exact(
        root / "flight-commander/verify-release.py",
        'r"set\\(FLIGHT_COMMANDER_FIRMWARE_VERSION 4\\.0\\.8\\)",',
        'r"set\\(FLIGHT_COMMANDER_FIRMWARE_VERSION 4\\.1\\.3\\)",',
    )
    replace_exact(
        root / "flight-commander/verify-release.py",
        'r"FLIGHT_COMMANDER_VERSION_MINOR 0",\n        r"FLIGHT_COMMANDER_VERSION_PATCH 8",',
        'r"FLIGHT_COMMANDER_VERSION_MINOR 1",\n        r"FLIGHT_COMMANDER_VERSION_PATCH 3",',
    )

    identity_function = '''def source_identities(root: Path) -> tuple[str, str]:
    entries = (
        ".dir-locals.el", ".dockerignore", ".gitattributes", ".gitignore",
        ".travis.sh", ".travis.yml", ".vimrc", "AGENT.md", "AUTHORS",
        "CMakeLists.txt", "Dockerfile", "JLinkSettings.ini", "LICENSE",
        "README.md", "Vagrantfile", "build.sh", "build_docs.sh", "cmake",
        "dev", "fake_travis_build.sh", "flight-commander", "lib", "src",
    )
    files: list[Path] = []
    for relative in entries:
        path = root / relative
        files.extend(
            [path]
            if path.is_file()
            else [
                item for item in path.rglob("*")
                if item.is_file() and "__pycache__" not in item.parts and item.suffix != ".pyc"
            ]
        )
    records: list[str] = []
    for path in sorted(set(files), key=lambda item: item.relative_to(root).as_posix()):
        if path.name == "RELEASE-MANIFEST.json":
            continue
        relative = path.relative_to(root).as_posix()
        records.append(f"{sha256(path)}  {relative}\\n")
    canonical = "".join(records).encode()
    return (
        hashlib.sha1(canonical).hexdigest(),
        hashlib.sha1(b"flight-commander-source-tree-v1\\n" + canonical).hexdigest(),
    )


'''
    replace_regex(
        root / "flight-commander/verify-release.py",
        r"def source_identities\(root: Path\) -> tuple\[str, str\]:.*?\n\n\ndef require_text",
        identity_function + "def require_text",
    )

    manifest_path = root / "RELEASE-MANIFEST.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["version"] = VERSION
    manifest["source_revision"] = "0" * 40
    manifest["source_tree"] = "0" * 40
    manifest["source_date_epoch"] = SOURCE_DATE_EPOCH
    manifest["artifact"] = {
        "filename": "Flight-Commander-Firmware-4.1.3-MICOAIR743.hex",
        "sha256": "0" * 64,
        "bytes": 0,
    }
    write_text(manifest_path, json.dumps(manifest, indent=2) + "\n")


def patch_direct_firmware_test(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    start = text.index("const projectRoot =")
    marker = "const source = (relative) =>"
    marker_start = text.index(marker, start)
    marker_end = text.index(";", marker_start) + 1
    replacement = '''const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const packageManifest = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
const firmwareVersion = packageManifest.flightCommander.firmwareSourceVersion;
const sourceRoot = resolve(projectRoot, '..');
const source = (relative) => readFileSync(join(sourceRoot, ...relative.split('/')), 'utf8');'''
    text = text[:start] + replacement + text[marker_end:]
    text = re.sub(r"\n\nafter\(\(\) => rmSync\(output, \{ recursive: true, force: true \}\)\);", "", text)
    for unused in (
        "import { mkdtempSync, readFileSync, rmSync } from 'node:fs';",
        "import { tmpdir } from 'node:os';",
        "import { spawnSync } from 'node:child_process';",
        "import { after, test } from 'node:test';",
    ):
        if unused in text:
            replacement_import = {
                "import { mkdtempSync, readFileSync, rmSync } from 'node:fs';": "import { readFileSync } from 'node:fs';",
                "import { after, test } from 'node:test';": "import { test } from 'node:test';",
            }.get(unused, "")
            text = text.replace(unused, replacement_import)
    path.write_text(text, encoding="utf-8")


def patch_package_contract(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    text = text.replace(
        'resolve(projectRoot, ".github/workflows/release.yml")',
        'resolve(projectRoot, "../.github/workflows/release.yml")',
    )
    text = text.replace(
        'resolve(projectRoot, "scripts/rebuild-firmware-source-archive.sh")',
        'resolve(projectRoot, "../flight-commander/install-toolchain.sh")',
    )
    text = text.replace(
        'resolve(projectRoot, "docs/README.md")',
        'resolve(projectRoot, "../docs/README.md")',
    )
    text = text.replace(
        'resolve(projectRoot, "docs/SETTINGS_REFERENCE.md")',
        'resolve(projectRoot, "../docs/SETTINGS_REFERENCE.md")',
    )
    text = text.replace(
        'existsSync(resolve(projectRoot, "docs", match[1]))',
        'existsSync(resolve(projectRoot, "../docs", match[1]))',
    )
    text = text.replace("/INAV-Configurator\\//", "/INAV-Configurator\\//")
    text = text.replace(
        "assert.match(packageVerifier, /INAV-Configurator\\//);",
        "assert.doesNotMatch(packageVerifier, /INAV-Configurator\\//);",
    )
    text = text.replace(
        "assert.match(packageVerifier, /Windows MAVLink DTR\\/RTS-low open setup/);",
        "assert.match(packageVerifier, /configuring-control-lines/);",
    )
    text = text.replace(
        "assert.match(packageVerifier, /connectionBaudPreferencesByProtocol/);",
        "assert.match(packageVerifier, /serial-open-complete/);",
    )
    text = text.replace(
        "assert.match(packageVerifier, /Windows extraction budget is 140/);",
        "assert.match(packageVerifier, /windowsPathBudget = 140/);",
    )
    for forbidden_marker in (
        "Official INAV Firmware",
        "Official INAV is connected in compatibility mode",
        "ArduPilot support has been removed",
    ):
        text = text.replace(
            f"assert.doesNotMatch(packageVerifier, /{forbidden_marker}/);",
            f"assert.match(packageVerifier, /{forbidden_marker}/);",
        )
    text = text.replace(
        '''  for (const propInches of [10, 12, 15, 17]) {
    assert.match(
      packageVerifier,
      new RegExp(`Multirotor with ${propInches}.*propellers`),
    );
  }
  assert.match(packageVerifier, /generated roll P\\/I\\/D\\/FF/);
  assert.match(packageVerifier, /ez_snappiness/);
''',
        "",
    )
    for stale_verifier_marker in (
        "miles per hour",
        "#31523b",
        "#172a20",
    ):
        text = text.replace(
            f"  assert.match(packageVerifier, /{stale_verifier_marker}/);\n",
            "",
        )
    for stale_selector in (
        '    "fc-flight-visuals",\n',
        '    "fc-live-pane",\n',
        '    "compass-calibration-card",\n',
        '    "rtk-workflow-option",\n',
        '    "mixer-preview-image-numbers \\\\.motorNumber",\n',
    ):
        text = text.replace(stale_selector, "")
    text = text.replace("tree/main/docs", "tree/master/docs")
    text = text.replace('firmwareReleaseVersion, "4.0.8"', 'firmwareReleaseVersion, "4.1.3"')
    text = text.replace('firmwareChangedInRelease, false', 'firmwareChangedInRelease, true')
    text = text.replace('firmwareSourceVersion, "4.0.8"', 'firmwareSourceVersion, "4.1.3"')
    text = text.replace(
        '"release/firmware/Flight-Commander-Firmware-Source-v4.0.8.zip"',
        '"FC-Firmware-Source-v4.1.3.zip"',
    )

    policy_test = '''test("release policy requires a coordinated reproducible Firmware 4.1.3 build", () => {
  assert.equal(packageManifest.flightCommander.firmwareChangedInRelease, true);
  assert.equal(packageManifest.flightCommander.firmwareReleaseVersion, packageManifest.version);
  assert.equal(packageManifest.flightCommander.firmwareSourceVersion, packageManifest.version);
  assert.match(releaseWorkflow, /branches:/);
  assert.match(releaseWorkflow, /- master/);
  assert.match(releaseWorkflow, /Build verified Firmware 4\\.1\\.3/);
  assert.match(releaseWorkflow, /flight-commander\\/package-release\\.py/);
  assert.match(releaseWorkflow, /flight-commander\\/install-toolchain\\.sh/);
  assert.match(firmwareRebuildScript, /arm-gnu-toolchain-13\\.2\\.rel1/);
  assert.match(
    firmwareRebuildScript,
    /6cd1bbc1d9ae57312bcd169ae283153a9572bd6a8e4eeae2fedfbc33b115fdbb/,
  );
});'''
    text, matches = re.subn(
        r'test\("release policy distinguishes software-only updates from firmware rebuilds", \(\) => \{.*?\n\}\);',
        lambda _match: policy_test,
        text,
        count=1,
        flags=re.DOTALL,
    )
    if matches != 1:
        raise RuntimeError("Could not replace the retained-firmware release policy test")

    bundle_test = '''test("official release publishes one complete bundle plus the online-flasher HEX", () => {
  for (const filename of [
    "Flight-Commander-v4.1.3.zip",
    "FC-Windows-v4.1.3.zip",
    "FC-Configurator-Source-v4.1.3.zip",
    "FC-Firmware-v4.1.3-MICOAIR743.hex",
    "FC-Firmware-Source-v4.1.3.zip",
    "Flight-Commander-Firmware-4.1.3-MICOAIR743.hex",
  ]) {
    assert.match(releaseWorkflow, new RegExp(filename.replaceAll(".", "\\\\.")));
  }
  assert.match(releaseWorkflow, /exactly the four canonical files/);
  assert.match(releaseWorkflow, /exactly the two public assets/);
  assert.match(releaseWorkflow, /gh release create/);
  assert.doesNotMatch(releaseWorkflow, /--prerelease/);
});'''
    text, matches = re.subn(
        r'test\("source-backed releases publish one complete bundle plus the online-flasher HEX", \(\) => \{.*?\n\}\);',
        lambda _match: bundle_test,
        text,
        count=1,
        flags=re.DOTALL,
    )
    if matches != 1:
        raise RuntimeError("Could not replace the legacy bundle policy test")
    path.write_text(text, encoding="utf-8")


def patch_configurator(root: Path) -> None:
    config = root / "configurator"
    package_path = config / "package.json"
    package = json.loads(package_path.read_text(encoding="utf-8"))
    package["version"] = VERSION
    declaration = package["flightCommander"]
    declaration.update(
        {
            "firmwareMajor": 4,
            "firmwareReleaseVersion": VERSION,
            "firmwareReleaseSha256": "0" * 64,
            "firmwareChangedInRelease": True,
            "firmwareSourceAvailable": True,
            "firmwareSourceVersion": VERSION,
            "firmwareSourceArchive": "FC-Firmware-Source-v4.1.3.zip",
            "firmwareSourceSha256": "0" * 64,
            "firmwareSourceRevision": "0" * 40,
            "firmwareSourceTree": "0" * 40,
        }
    )
    write_text(package_path, json.dumps(package, indent=2) + "\n")

    replace_exact(
        config / "scripts/check-flight-commander-version.mjs",
        "`release/firmware/Flight-Commander-Firmware-Source-v${firmwareReleaseVersion}.zip`",
        "`FC-Firmware-Source-v${firmwareReleaseVersion}.zip`",
    )
    version_test = config / "tests/flight-commander/packaging/version-contract.test.mjs"
    version_test.write_text(
        version_test.read_text(encoding="utf-8").replace(
            "release/firmware/Flight-Commander-Firmware-Source-v", "FC-Firmware-Source-v"
        ),
        encoding="utf-8",
    )

    verifier = config / "scripts/verify-windows-package.mjs"
    verifier_text = verifier.read_text(encoding="utf-8")
    verifier_text = verifier_text.replace(
        '"flight_commander_icon_windows.ico"', '"flight-commander.ico"'
    )
    verifier_text = verifier_text.replace('!== "4.0.8"', '!== "4.1.3"')
    verifier_text = verifier_text.replace("expected 4.0.8", "expected 4.1.3")
    verifier_text = verifier_text.replace(
        "firmwareChangedInRelease !== false", "firmwareChangedInRelease !== true"
    )
    verifier_text = verifier_text.replace(
        "Flight Commander 4.1.3 must retain verified Firmware 4.0.8 unchanged",
        "Flight Commander 4.1.3 must publish coordinated Firmware 4.1.3",
    )
    verifier_text = verifier_text.replace(
        "Flight Commander 4.1.3 must retain the Firmware 4.0.8 source archive",
        "Flight Commander 4.1.3 must publish the Firmware 4.1.3 source archive",
    )
    verifier.write_text(verifier_text, encoding="utf-8")

    generator = config / "scripts/generate-flight-commander-settings-docs.mjs"
    replace_exact(
        generator,
        "const outputPath = join(projectRoot, 'docs', 'SETTINGS_REFERENCE.md');",
        "const outputPath = resolve(projectRoot, '../docs/SETTINGS_REFERENCE.md');",
    )

    patch_package_contract(
        config / "tests/flight-commander/packaging/package-contract.test.mjs"
    )

    for relative in (
        "tests/flight-commander/firmware/onboard-ist8310-transform.test.mjs",
        "tests/flight-commander/firmware/heading-source-liveness.test.mjs",
        "tests/flight-commander/firmware/imu-handedness-regression.test.mjs",
    ):
        patch_direct_firmware_test(config / relative)

    compass = config / "tests/flight-commander/firmware/compass-orientation.test.mjs"
    compass_text = compass.read_text(encoding="utf-8").replace(
        "'dev/firmware-4.0.7-source/src/main/", "'../src/main/"
    )
    compass.write_text(compass_text, encoding="utf-8")

    policy = config / "tests/flight-commander/firmware/flight-commander-only-policy.test.mjs"
    policy.write_text(
        policy.read_text(encoding="utf-8").replace(
            'firmwareReleaseVersion, "4.0.8"', 'firmwareReleaseVersion, "4.1.3"'
        ),
        encoding="utf-8",
    )

    write_text(
        config / "tests/flight-commander/firmware/dronecan-dynamic-node-allocation.test.mjs",
        '''import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const configuratorRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const repositoryRoot = resolve(configuratorRoot, "..");
const source = (relative) => readFileSync(resolve(repositoryRoot, relative), "utf8");

test("current firmware source includes the non-redundant DroneCAN allocator", () => {
  const allocator = source("src/main/drivers/dronecan/dronecan_allocator.c");
  const transport = source("src/main/drivers/dronecan/dronecan.c");
  assert.match(allocator, /UAVCAN_PROTOCOL_DYNAMIC_NODE_ID_ALLOCATION_ID/);
  assert.match(allocator, /DRONECAN_ALLOCATOR_UNIQUE_ID_LENGTH 16U/);
  assert.match(allocator, /pendingUniqueID/);
  assert.match(allocator, /pendingPreferredNodeID/);
  assert.match(allocator, /createAllocation\\(pendingUniqueID, pendingPreferredNodeID\\)/);
  assert.match(transport, /USE_FLIGHT_COMMANDER_DRONECAN_DNA_ALLOCATOR/);
});

test("release packaging validates source identity before compilation", () => {
  const packager = source("flight-commander/package-release.py");
  const validator = packager.indexOf("validate_manifest(manifest, revision, tree)");
  const compiler = packager.indexOf("subprocess.run(", validator);
  assert.ok(validator >= 0, "source and manifest validation is missing");
  assert.ok(compiler > validator, "firmware must validate its source contract before compilation");
});

test("permanent CI builds firmware directly from the repository source tree", () => {
  const workflow = source(".github/workflows/ci.yml");
  assert.match(workflow, /Build and package firmware from the repository source tree/);
  assert.match(workflow, /python3 flight-commander\\/package-release\\.py/);
  assert.match(workflow, /working-directory: configurator/);
  assert.match(workflow, /run: yarn test/);
  assert.doesNotMatch(workflow, /source ZIP|rebuild-firmware-source-archive/);
});
''',
    )

    legacy_release_test = config / "tests/flight-commander/release/software-only-beta-publisher.test.mjs"
    coordinated_test = config / "tests/flight-commander/release/official-4.1.3-release.test.mjs"
    write_text(
        coordinated_test,
        '''import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const publisher = readFileSync(resolve(root, "../.github/workflows/release.yml"), "utf8");

test("4.1.3 coordinates Configurator and Firmware versions", () => {
  assert.equal(packageJson.version, "4.1.3");
  assert.equal(packageJson.flightCommander.firmwareChangedInRelease, true);
  assert.equal(packageJson.flightCommander.firmwareReleaseVersion, "4.1.3");
  assert.equal(packageJson.flightCommander.firmwareSourceVersion, "4.1.3");
});

test("official publisher creates a verified non-prerelease bundle", () => {
  assert.match(publisher, /Publish verified release/);
  assert.match(publisher, /gh release create/);
  assert.match(publisher, /exactly the four canonical files/);
  assert.match(publisher, /exactly the two public assets/);
  assert.doesNotMatch(publisher, /--prerelease/);
});
''',
    )
    legacy_release_test.unlink()

    readme = config / "README.md"
    readme_text = readme.read_text(encoding="utf-8")
    readme_text = readme_text.replace("](docs/", "](../docs/")
    readme.write_text(readme_text, encoding="utf-8")

    for path in config.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in {
            ".js", ".mjs", ".cjs", ".json", ".html", ".css", ".md", ".yml", ".yaml"
        }:
            continue
        try:
            original = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        text = original
        text = text.replace(
            "https://github.com/srt3262/Flight-Commander/blob/main/",
            "https://github.com/srt3262/Flight-Commander/blob/master/",
        )
        text = text.replace(
            "https://github.com/srt3262/Flight-Commander/tree/main/",
            "https://github.com/srt3262/Flight-Commander/tree/master/",
        )
        if text != original:
            path.write_text(text, encoding="utf-8")


def prepare(root: Path, templates: Path) -> None:
    if not (root / ".git").exists():
        raise RuntimeError(f"Not a Git worktree: {root}")
    with tempfile.TemporaryDirectory(prefix="flight-commander-4.1.3-") as temp:
        staging = Path(temp)
        archive, configurator, docs = stage_original_source(root, staging)
        extracted = safe_extract(archive, staging / "firmware")
        clear_worktree(root)
        copy_tree_contents(extracted, root)

        for legacy in (
            root / "COMPASS-3.0.4-README.md",
            root / "COMPASS-3.0.7-README.md",
            root / "readme.md",
        ):
            if legacy.exists():
                legacy.unlink()

        shutil.copytree(configurator, root / "configurator", copy_function=shutil.copy2)
        shutil.copytree(docs, root / "docs", copy_function=shutil.copy2)
        obsolete_bench_notes = root / "docs/BENCH_TEST_4.0.0.md"
        if obsolete_bench_notes.exists():
            obsolete_bench_notes.unlink()
        write_text(root / "README.md", ROOT_README)
        write_text(root / "docs/releases/v4.1.3.md", RELEASE_NOTES)
        write_text(root / ".gitignore", ROOT_GITIGNORE)
        write_text(root / ".gitattributes", ROOT_GITATTRIBUTES)

        copy_file(templates / "ci.yml", root / ".github/workflows/ci.yml")
        copy_file(templates / "release.yml", root / ".github/workflows/release.yml")
        copy_file(
            templates / "package-release.py",
            root / "flight-commander/package-release.py",
        )
        copy_file(
            templates / "install-toolchain.sh",
            root / "flight-commander/install-toolchain.sh",
        )
        for executable in (
            root / "flight-commander/package-release.py",
            root / "flight-commander/install-toolchain.sh",
        ):
            executable.chmod(executable.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)

        patch_firmware(root)
        patch_configurator(root)

        write_text(
            root / "docs/FLIGHT_COMMANDER_VERSIONING.md",
            '''# Flight Commander release-version contract

Flight Commander Configurator and Firmware always share the same major version.
A firmware-changing release uses the exact Configurator `X.Y.Z` version; a
strictly Configurator-only release may retain an older firmware patch version
within the same major series without relabeling its HEX.

The firmware source is maintained directly at the repository root. Every
official release builds it with the pinned Arm GNU 13.2.1 toolchain, verifies
the embedded `FCFW` version and capabilities, and records the resulting HEX
hash, source archive hash, source revision, and source tree in
`configurator/package.json` and `RELEASE-MANIFEST.json`.

Every release is delivered as `Flight-Commander-vX.Y.Z.zip` containing exactly:

- `FC-Windows-vX.Y.Z.zip`
- `FC-Configurator-Source-vX.Y.Z.zip`
- `FC-Firmware-vX.Y.Z-MICOAIR743.hex`
- `FC-Firmware-Source-vX.Y.Z.zip`

The same verified firmware HEX is also published under its canonical long
filename for the Configurator's online flasher. The GitHub release therefore
has exactly two public assets: the complete four-file bundle and that standalone
HEX. Publication fails on a version, source identity, checksum, filename, or
asset-count mismatch.

For 4.1.3, both Configurator and Firmware are 4.1.3 and
`firmwareChangedInRelease` is `true`; only the firmware version identity changed
from the reviewed 4.0.8 implementation.
''',
        )
        documentation_hub = root / "docs/README.md"
        replace_exact(
            documentation_hub,
            "- [Release notes](../CHANGELOG.md)",
            "- [Flight Commander 4.1.3 release notes](releases/v4.1.3.md)",
        )

        for path in root.rglob("*"):
            if not path.is_file() or path.suffix.lower() not in {".md", ".html", ".js"}:
                continue
            try:
                original = path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                continue
            text = original
            text = text.replace(
                "https://github.com/srt3262/Flight-Commander/blob/main/",
                "https://github.com/srt3262/Flight-Commander/blob/master/",
            )
            text = text.replace(
                "https://github.com/srt3262/Flight-Commander/tree/main/",
                "https://github.com/srt3262/Flight-Commander/tree/master/",
            )
            if text != original:
                path.write_text(text, encoding="utf-8")

    expected_workflows = {"ci.yml", "release.yml"}
    workflows = {path.name for path in (root / ".github/workflows").iterdir() if path.is_file()}
    if workflows != expected_workflows:
        raise RuntimeError(f"Unexpected final workflow set: {sorted(workflows)}")
    print("Prepared clean INAV-style Flight Commander 4.1.3 source tree")


def finalize(root: Path, metadata_path: Path) -> None:
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    if metadata.get("version") != VERSION or metadata.get("target") != "MICOAIR743":
        raise RuntimeError("Firmware release metadata is not the 4.1.3 MICOAIR743 build")
    package_path = root / "configurator/package.json"
    package = json.loads(package_path.read_text(encoding="utf-8"))
    declaration = package["flightCommander"]
    declaration.update(
        {
            "firmwareReleaseSha256": metadata["firmware"]["sha256"],
            "firmwareSourceSha256": metadata["source"]["sha256"],
            "firmwareSourceRevision": metadata["source"]["revision"],
            "firmwareSourceTree": metadata["source"]["tree"],
        }
    )
    write_text(package_path, json.dumps(package, indent=2) + "\n")
    print("Finalized Configurator metadata from the verified Firmware 4.1.3 build")


def main() -> int:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    prepare_parser = subparsers.add_parser("prepare")
    prepare_parser.add_argument("--root", type=Path, required=True)
    prepare_parser.add_argument("--templates", type=Path, required=True)
    finalize_parser = subparsers.add_parser("finalize")
    finalize_parser.add_argument("--root", type=Path, required=True)
    finalize_parser.add_argument("--metadata", type=Path, required=True)
    args = parser.parse_args()
    root = args.root.resolve()
    if args.command == "prepare":
        prepare(root, args.templates.resolve())
    else:
        finalize(root, args.metadata.resolve())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
