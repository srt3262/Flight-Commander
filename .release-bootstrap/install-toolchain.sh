#!/usr/bin/env bash

set -euo pipefail

toolchain_release="arm-gnu-toolchain-13.2.Rel1-x86_64-arm-none-eabi"
archive_name="arm-gnu-toolchain-13.2.rel1-x86_64-arm-none-eabi.tar.xz"
archive_sha256="6cd1bbc1d9ae57312bcd169ae283153a9572bd6a8e4eeae2fedfbc33b115fdbb"
archive_url="https://developer.arm.com/-/media/Files/downloads/gnu/13.2.rel1/binrel/${archive_name}"
cache_root="${RUNNER_TEMP:-/tmp}/flight-commander-toolchain"
toolchain_root="${cache_root}/${toolchain_release}"

if [[ ! -x "${toolchain_root}/bin/arm-none-eabi-gcc" ]]; then
    mkdir -p "${cache_root}"
    archive_path="${cache_root}/${archive_name}"
    curl --fail --location --retry 3 --output "${archive_path}.partial" "${archive_url}"
    printf '%s  %s\n' "${archive_sha256}" "${archive_path}.partial" |
        sha256sum --check --strict
    mv "${archive_path}.partial" "${archive_path}"
    tar -xJf "${archive_path}" -C "${cache_root}"
fi

if [[ "$("${toolchain_root}/bin/arm-none-eabi-gcc" -dumpfullversion -dumpversion)" != "13.2.1" ]]; then
    echo "Arm GNU Toolchain 13.2.1 verification failed." >&2
    exit 1
fi

if [[ -n "${GITHUB_PATH:-}" ]]; then
    printf '%s\n' "${toolchain_root}/bin" >> "${GITHUB_PATH}"
else
    printf '%s\n' "${toolchain_root}/bin"
fi
