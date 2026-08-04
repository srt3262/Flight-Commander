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
- Every release after Configurator 2.0.5 must also publish an exact firmware
  source ZIP matching the firmware HEX. Software-only releases continue to
  publish the retained source for the unchanged HEX.
- Configurator 2.0.5 is the one-time legacy exception: the custom Firmware
  2.0.1 source was not retained and cannot be reconstructed exactly from its
  compiled HEX. This exception cannot be reused by 2.0.6 or any later release.
- A firmware-changing release is blocked unless a canonical, version-matched
  firmware source ZIP is retained in the repository and its declared SHA-256,
  source revision, source tree, and embedded release manifest match the HEX.
- The release workflow treats any missing required archive, filename mismatch,
  checksum mismatch, or size mismatch as a publication failure.

For major version 3, `package.json` declares
`flightCommander.firmwareMajor: 3`. It also declares
`flightCommander.firmwareChangedInRelease`. The test suite runs
`scripts/check-flight-commander-version.mjs` and rejects a mismatched major,
an undeclared release type, or a firmware-changing release whose firmware
version does not exactly match the Configurator version. It also validates the
`bundledFirmwareSourceAvailable`, `bundledFirmwareSourceVersion`,
`bundledFirmwareSourceArchive`, `bundledFirmwareSourceSha256`,
`bundledFirmwareSourceRevision`, and `bundledFirmwareSourceTree` declarations
and rejects every post-2.0.5 release without exact firmware source.
The firmware has the reciprocal
`FLIGHT_COMMANDER_CONFIGURATOR_VERSION_MAJOR` compile-time contract.

Every release is delivered as one
`Flight-Commander-vX.Y.Z.zip`. That outer archive contains
exactly these four canonical files:

- `FC-Configurator-Source-vX.Y.Z.zip`
- `FC-Windows-vX.Y.Z.zip`
- `FC-Firmware-vX.Y.Z-TARGET.hex`
- `FC-Firmware-Source-vX.Y.Z.zip`

The GitHub release may additionally expose the exact same verified firmware
HEX as a standalone service asset. That duplicate is required by the
Configurator's **Download Online Firmware** action; it does not replace the
single four-component release bundle delivered to users.
