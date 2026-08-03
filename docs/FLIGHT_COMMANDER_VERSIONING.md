# Flight Commander release-version contract

Flight Commander Configurator and Flight Commander Firmware always share the
same major version.

- Every published Configurator update advances the Configurator version.
- If an update changes firmware source or behavior, the firmware must be
  rebuilt and its complete `X.Y.Z` version must match that Configurator
  release.
- If an update is strictly limited to Configurator software, the verified
  existing firmware binary may be reused under its real embedded version;
  minor and patch versions may therefore differ in that case.
- An existing firmware binary must never be relabeled or wrapped as a newer
  firmware build.
- A new major version in either product triggers a coordinated release of both
  products at `X.0.0`.
- No supported release may advertise a peer-product major different from its
  own major.
- Upstream INAV versions describe retained protocol/configuration compatibility
  only; they are not Flight Commander product versions.
- Firmware features remain negotiated through the `FCFW` capability bitmap, so
  a matching major does not imply every optional feature exists on every target.
- Any firmware release that includes Configurator changes must ship the matching
  Configurator release with both a named source ZIP and a portable Windows x64
  ZIP. Both archives must come from the same tested Configurator commit.
- The release workflow treats either missing archive, filename mismatch,
  checksum mismatch, or size mismatch as a publication failure.

For major version 2, `package.json` declares
`flightCommander.firmwareMajor: 2`. It also declares
`flightCommander.firmwareChangedInRelease`. The test suite runs
`scripts/check-flight-commander-version.mjs` and rejects a mismatched major,
an undeclared release type, or a firmware-changing release whose firmware
version does not exactly match the Configurator version.
The firmware has the reciprocal
`FLIGHT_COMMANDER_CONFIGURATOR_VERSION_MAJOR` compile-time contract.

Verified Configurator assets use these canonical names:

- `Flight-Commander-Configurator-Source-vX.Y.Z.zip`
- `Flight-Commander-Configurator-Windows-x64-vX.Y.Z.zip`
- `Flight-Commander-Firmware-X.Y.Z-TARGET.hex`
