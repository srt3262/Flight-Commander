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

Every 50-target release is delivered as `Flight-Commander-vX.Y.Z.zip`
containing exactly 53 files:

- `FC-Windows-vX.Y.Z.zip`
- `FC-Configurator-Source-vX.Y.Z.zip`
- one `FC-Firmware-vX.Y.Z-TARGET.hex` for each of the 50 official targets
- `FC-Firmware-Source-vX.Y.Z.zip`

The same 50 verified firmware HEX files are also published under their
canonical long filenames for the Configurator's online flasher. The GitHub
release therefore has exactly 51 public assets: the complete bundle and 50
standalone HEX files. Publication fails on a version, source identity,
checksum, filename, target inventory, or asset-count mismatch.

For 4.3.2, both Configurator and Firmware are 4.3.2 and
`firmwareChangedInRelease` is `true`. The coordinated release rebuilds all 50
images with the same embedded version and records an independent filename,
size, and SHA-256 for each target.
