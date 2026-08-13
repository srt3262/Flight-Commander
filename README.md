# Flight Commander

Flight Commander is an integrated autopilot project for the MICOAIR743 and
CubePilot Cube Orange+ targets. The official 4.2.4 release pairs **Flight
Commander Configurator 4.2.4** with the unchanged, verified **Flight Commander
Firmware 4.2.0** images. This Configurator-only release adds protected
Cube/Pixhawk bootloader flashing for Cube Orange+ without rebuilding either
firmware target.

## Repository layout

The firmware follows the [INAV repository](https://github.com/inavflight/inav)
layout and is built directly from the repository root.

| Path | Purpose |
| --- | --- |
| `src/`, `lib/`, `cmake/`, `dev/` | Firmware source and build support |
| `flight-commander/` | Reproducible multi-target firmware release tooling |
| `configurator/` | Electron Configurator application and tests |
| `docs/` | Flight Commander operator and developer documentation |
| `.github/workflows/` | Continuous integration and official release publication |

## Build and test

Firmware releases require Arm GNU Toolchain 13.2.1, CMake, Ninja, and Python 3:

```bash
export PATH="$(bash flight-commander/install-toolchain.sh):$PATH"
python3 flight-commander/package-release.py   --output /tmp/flight-commander-release   --build-dir /tmp/flight-commander-build
```

Configurator development requires Node.js 22 and Yarn 1.22.22:

```bash
cd configurator
yarn install --frozen-lockfile
yarn test
```

See the [documentation hub](docs/README.md), the
[firmware flashing guide](docs/FIRMWARE_FLASHING.md), and the
[Cube Orange+ target guide](docs/CUBEORANGEPLUS.md), and the
[4.2.4 release notes](docs/releases/v4.2.4.md).

## Upstream and licensing

The firmware is based on the hash-pinned INAV 9.1.0 source identified in
`flight-commander/INAV-9.1.0-BASELINE.json`. Flight Commander changes remain
licensed under GNU GPL v3; see [LICENSE](LICENSE).
