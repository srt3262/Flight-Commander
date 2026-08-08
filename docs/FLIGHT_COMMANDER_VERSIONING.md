# Flight Commander release-version contract

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
