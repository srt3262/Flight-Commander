#!/usr/bin/env bash

set -euo pipefail

source_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
build_dir="${1:-${source_root}/build-flight-commander}"
manifest="${source_root}/RELEASE-MANIFEST.json"
targets=(MICOAIR743 CUBEORANGEPLUS)

manifest_value() {
    python3 - "${manifest}" "$1" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    value = json.load(handle)
for component in sys.argv[2].split("."):
    value = value[component]
print(value)
PY
}

source_revision="${FLIGHT_COMMANDER_SOURCE_REVISION:-}"
if [[ -z "${source_revision}" && -f "${manifest}" ]]; then
    source_revision="$(manifest_value source_revision)"
fi
if [[ -z "${source_revision}" ]] && git -C "${source_root}" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    if ! git -C "${source_root}" diff --quiet || ! git -C "${source_root}" diff --cached --quiet; then
        echo "Refusing a release build from a dirty Git worktree." >&2
        exit 1
    fi
    source_revision="$(git -C "${source_root}" rev-parse HEAD)"
fi
if [[ ! "${source_revision}" =~ ^[0-9A-Fa-f]{40}$ ]]; then
    echo "A 40-character FLIGHT_COMMANDER_SOURCE_REVISION or RELEASE-MANIFEST.json is required." >&2
    exit 1
fi

if [[ -z "${SOURCE_DATE_EPOCH:-}" && -f "${manifest}" ]]; then
    SOURCE_DATE_EPOCH="$(manifest_value source_date_epoch)"
fi
if [[ ! "${SOURCE_DATE_EPOCH:-}" =~ ^[0-9]+$ ]]; then
    echo "A numeric SOURCE_DATE_EPOCH or RELEASE-MANIFEST.json is required." >&2
    exit 1
fi
export SOURCE_DATE_EPOCH

for command in cmake ninja arm-none-eabi-gcc python3; do
    command -v "${command}" >/dev/null || {
        echo "Required build command is unavailable: ${command}" >&2
        exit 1
    }
done
if [[ "$(arm-none-eabi-gcc -dumpfullversion -dumpversion)" != "13.2.1" ]]; then
    echo "Arm GNU Toolchain 13.2.1 is required." >&2
    exit 1
fi
if [[ -e "${build_dir}" ]]; then
    echo "Build directory already exists; choose a new empty path: ${build_dir}" >&2
    exit 1
fi

version="$(manifest_value version)"
cmake -S "${source_root}" -B "${build_dir}" -G Ninja \
    -DCMAKE_BUILD_TYPE=Release \
    -DWARNINGS_AS_ERRORS=ON \
    -DFLIGHT_COMMANDER_SOURCE_REVISION="${source_revision}"
cmake --build "${build_dir}" --target "${targets[@]}"

hexes=()
for target in "${targets[@]}"; do
    hex="${build_dir}/Flight-Commander-Firmware-${version}-${target}.hex"
    python3 "${source_root}/flight-commander/verify-compass-release.py" "${hex}"
    hexes+=("${hex}")
done

printf 'Built and verified:\n'
sha256sum "${hexes[@]}"
