#!/usr/bin/env bash

set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
manifest="${project_root}/package.json"

manifest_value() {
    node --input-type=module - "${manifest}" "$1" <<'NODE'
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(process.argv[2], 'utf8'));
let value = manifest;
for (const component of process.argv[3].split('.')) value = value[component];
if (typeof value !== 'string') process.exit(2);
process.stdout.write(value);
NODE
}

firmware_version="$(manifest_value flightCommander.bundledFirmwareVersion)"
firmware_sha256="$(manifest_value flightCommander.bundledFirmwareSha256)"
source_relative_path="$(manifest_value flightCommander.bundledFirmwareSourceArchive)"
source_sha256="$(manifest_value flightCommander.bundledFirmwareSourceSha256)"
source_revision="$(manifest_value flightCommander.bundledFirmwareSourceRevision)"
source_tree="$(manifest_value flightCommander.bundledFirmwareSourceTree)"

firmware_name="Flight-Commander-Firmware-${firmware_version}-MICOAIR743.hex"
firmware_path="${project_root}/resources/firmware/${firmware_name}"
source_archive="${project_root}/${source_relative_path}"

[[ "${firmware_version}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
[[ "${firmware_sha256}" =~ ^[0-9a-f]{64}$ ]]
[[ "${source_sha256}" =~ ^[0-9a-f]{64}$ ]]
[[ "${source_revision}" =~ ^[0-9a-f]{40}$ ]]
[[ "${source_tree}" =~ ^[0-9a-f]{40}$ ]]
[[ -f "${firmware_path}" ]]
[[ -f "${source_archive}" ]]

printf '%s  %s\n' "${firmware_sha256}" "${firmware_path}" | sha256sum --check --strict
printf '%s  %s\n' "${source_sha256}" "${source_archive}" | sha256sum --check --strict
unzip -tq "${source_archive}"

toolchain_release="arm-gnu-toolchain-13.2.Rel1-x86_64-arm-none-eabi"
toolchain_archive_name="arm-gnu-toolchain-13.2.rel1-x86_64-arm-none-eabi.tar.xz"
toolchain_archive_sha256="6cd1bbc1d9ae57312bcd169ae283153a9572bd6a8e4eeae2fedfbc33b115fdbb"
toolchain_url="https://developer.arm.com/-/media/Files/downloads/gnu/13.2.rel1/binrel/${toolchain_archive_name}"
cache_parent="${ARM_GNU_TOOLCHAIN_CACHE_DIR:-${RUNNER_TEMP:-/tmp}/flight-commander-toolchains}"
toolchain_root="${cache_parent}/${toolchain_release}"

compiler_version=''
if command -v arm-none-eabi-gcc >/dev/null 2>&1; then
    compiler_version="$(arm-none-eabi-gcc -dumpfullversion -dumpversion)"
fi
if [[ "${compiler_version}" != '13.2.1' ]]; then
    if [[ ! -x "${toolchain_root}/bin/arm-none-eabi-gcc" ]]; then
        mkdir -p "${cache_parent}"
        archive_path="${cache_parent}/${toolchain_archive_name}"
        partial_archive="${archive_path}.partial"
        curl --fail --location --retry 3 --output "${partial_archive}" "${toolchain_url}"
        printf '%s  %s\n' "${toolchain_archive_sha256}" "${partial_archive}" |
            sha256sum --check --strict
        mv "${partial_archive}" "${archive_path}"
        tar -xJf "${archive_path}" -C "${cache_parent}"
    fi
    export PATH="${toolchain_root}/bin:${PATH}"
fi

if [[ "$(arm-none-eabi-gcc -dumpfullversion -dumpversion)" != '13.2.1' ]]; then
    echo 'Arm GNU Toolchain 13.2.1 is required.' >&2
    exit 1
fi

work_root="$(mktemp -d "${RUNNER_TEMP:-/tmp}/flight-commander-firmware-rebuild.XXXXXX")"
cleanup() {
    rm -rf -- "${work_root}"
}
trap cleanup EXIT

unzip -q "${source_archive}" -d "${work_root}/source"
source_root="${work_root}/source/Flight-Commander-Firmware-Source-v${firmware_version}"
[[ -d "${source_root}" ]]

source_date_epoch="$(node --input-type=module - \
    "${source_root}/RELEASE-MANIFEST.json" \
    "${firmware_version}" "${firmware_name}" "${firmware_sha256}" \
    "${source_revision}" "${source_tree}" <<'NODE'
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const [version, firmwareName, firmwareSha256, sourceRevision, sourceTree] =
  process.argv.slice(3);
const expected = {
  schema: 1,
  product: 'Flight Commander Firmware',
  version,
  target: 'MICOAIR743',
  source_revision: sourceRevision,
  source_tree: sourceTree,
};
for (const [key, value] of Object.entries(expected)) {
  if (manifest[key] !== value) throw new Error(`firmware source manifest ${key} mismatch`);
}
if (manifest.artifact?.filename !== firmwareName) {
  throw new Error('firmware source manifest filename mismatch');
}
if (manifest.artifact?.sha256 !== firmwareSha256) {
  throw new Error('firmware source manifest HEX SHA-256 mismatch');
}
if (!Number.isSafeInteger(manifest.source_date_epoch) || manifest.source_date_epoch <= 0) {
  throw new Error('firmware source manifest source_date_epoch is invalid');
}
process.stdout.write(String(manifest.source_date_epoch));
NODE
)"
if (( source_date_epoch > $(date +%s) )); then
    echo 'Firmware source build epoch is in the future.' >&2
    exit 1
fi
# ZIP timestamps have no timezone. Normalize the extracted tree to the signed-in
# UTC build epoch so Ninja never sees future inputs on a runner in another zone.
find "${source_root}" -exec touch --date="@${source_date_epoch}" {} +

target_root="${source_root}/src/main/target"
mapfile -t target_directories < <(
    find "${target_root}" -mindepth 1 -maxdepth 1 -type d \
        ! -name link -printf '%f\n' | LC_ALL=C sort
)
if [[ "${#target_directories[@]}" -ne 1 || "${target_directories[0]}" != 'MICOAIR743' ]]; then
    echo 'Firmware source must expose exactly one MICOAIR743 hardware target.' >&2
    exit 1
fi
if grep -En 'MICOAIR743_EXTMAG' \
    "${target_root}/MICOAIR743/CMakeLists.txt" \
    "${target_root}/MICOAIR743/target.h" \
    "${target_root}/MICOAIR743/config.c"; then
    echo 'The retired external-compass firmware target is still present.' >&2
    exit 1
fi
grep -En 'mag_align[[:space:]]*=[[:space:]]*CW90_DEG' \
    "${target_root}/MICOAIR743/config.c"

bash "${source_root}/flight-commander/build-micoair743.sh" "${work_root}/build"
rebuilt_firmware="${work_root}/build/${firmware_name}"
cmp --silent "${firmware_path}" "${rebuilt_firmware}"
printf '%s  %s\n' "${firmware_sha256}" "${rebuilt_firmware}" |
    sha256sum --check --strict

echo "Rebuilt ${firmware_name} byte-for-byte from ${source_relative_path}."
