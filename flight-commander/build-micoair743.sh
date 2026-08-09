#!/usr/bin/env bash

set -euo pipefail

source_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
echo "build-micoair743.sh is retained for compatibility; building every official target." >&2
exec bash "${source_root}/flight-commander/build-targets.sh" "$@"
