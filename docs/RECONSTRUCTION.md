# Reconstruction and provenance

## Status

Flight Commander 1.3.6 is a **reconstructed source release**. The editable
project that originally produced Flight Commander 1.3.5 was no longer
available. The surviving 1.3.5 Windows package contained executable production
assets, not the original modules, build configuration, source maps, or complete
test suite.

Version 1.3.6 therefore must not be described as the exact historical source of
1.3.5 or as a bit-for-bit reproducible build of that release.

The purpose of the reconstruction is to establish an inspectable, maintainable,
and testable source baseline for all work from 1.3.6 onward.

## Inputs

The reconstruction used two independently identifiable inputs:

1. **INAV Configurator 9.1.1**
   - Upstream repository:
     [iNavFlight/inav-configurator](https://github.com/iNavFlight/inav-configurator)
   - Git commit:
     [`4c343e38aba4ef655afd88e8339ef21d0c3c53ac`](https://github.com/iNavFlight/inav-configurator/commit/4c343e38aba4ef655afd88e8339ef21d0c3c53ac)
   - License: GNU General Public License version 3
2. **Verified Flight Commander 1.3.5 Windows x64 runtime**
   - Release archive SHA-256:
     `7d8f45a3b93eec2a98e181013e8ce6ce6e49a0bbe804c2d8c4016b46c2e13ec3`
   - The archive had previously passed ZIP integrity, clean-extraction, and
     packaged-launcher checks.
   - Its compiled renderer, application resources, UI behavior, and packaged
     metadata were used as a behavioral reference. The runtime was not treated
     as if it contained the unavailable original source.

These inputs serve different roles: the tagged INAV project provides the
licensed, editable base, while the verified 1.3.5 runtime provides evidence of
Flight Commander behavior and release identity.

## Reconstruction method

The source baseline was rebuilt by:

1. Checking out the exact INAV Configurator 9.1.1 commit.
2. Comparing the verified 1.3.5 production assets with the upstream base.
3. Recovering readable Flight Commander UI assets where possible.
4. Reimplementing missing Flight Commander modules behind explicit,
   controller-aware interfaces.
5. Restoring the Flight Commander package identity, dependencies, Electron
   build wiring, and Windows x64 verification path.
6. Adding regression tests for the reconstructed mission, MAVLink, telemetry,
   parameter, firmware, and Ground Control boundaries.
7. Assigning the next version, 1.3.6, rather than falsely labeling the result as
   the exact source for 1.3.5.

The reconstruction favors readable modules and fail-closed protocol handling
over attempting to reproduce minified implementation details.

## Expected differences from the unavailable source

Even when visible behavior matches the verified runtime, the reconstructed
source may differ in:

- Module and file boundaries
- Internal names and data structures
- Comments and development-only code
- Error-message construction
- Build ordering and minifier output
- Tests that were present only in the lost source tree
- Dead or unreachable code embedded in the production bundle

For those reasons, a newly built 1.3.6 package is expected to have different
bytes and checksums from 1.3.5. That difference is not evidence that the
provenance statement is incomplete; it is the reason this is a new source
release.

## Firmware and transport boundaries after reconstruction

The source keeps transport responsibilities explicit while enforcing one
supported controller firmware family:

- **Flight Commander Firmware over MSP** uses the inherited wired handshake and
  native persistent mission/settings formats. The versioned FCFW identity is
  optional diagnostic metadata.
- **Flight Commander Firmware over MAVLink** supplies telemetry, active mission
  transfer, and commands after link and aircraft-profile checks.
- Runtime firmware authorization is intentionally absent because Flight
  Commander provides one firmware product and one feature contract.
- LTM remains telemetry-only because it cannot carry mission or command traffic.
- The online Firmware Flasher verifies official release assets; operator-chosen
  local HEX files are flashed as supplied.

Inherited INAV names remain in source identifiers, setting names, wire-format
code, licensing notices, and provenance where Flight Commander Firmware still
uses them. They are implementation history, not a stock-firmware product mode.

## Verification policy

The repository's required source gate is:

```bash
yarn install --frozen-lockfile
yarn test
```

The Windows publication gate additionally runs:

```bash
yarn package:windows
yarn verify:windows
```

Continuous integration repeats these gates on pull requests and pushes to
`main`. A release should not be represented as verified if either the tests or
the Windows package verifier fails.

Automated tests do not replace hardware validation. Mission write/readback,
resume behavior, command routing, failsafes, and firmware flashing require
bench testing with propellers removed before flight use. New controller and
firmware combinations should be treated as unvalidated until explicitly
tested.

## Signing and release identity

The recovered 1.3.5 executable was unsigned. Reconstruction does not create or
claim a publisher identity. Unless a future release is explicitly signed with a
trusted certificate, Windows SmartScreen may require an operator override.
Hosting an unsigned binary on GitHub does not by itself remove that warning.

Release binaries belong in GitHub Releases, not in the Git history. The
repository should contain source, tests, build metadata, documentation, and
small project assets needed to reproduce a release.

## Licensing

Flight Commander remains GPL-3.0 licensed. Copyright and licensing notices from
INAV Configurator and its dependencies must be preserved. New Flight Commander
code distributed with this repository is provided under the same repository
license unless an individual file states a compatible license.

Starting with 1.3.6, normal Git history should provide the provenance for every
subsequent source change.

## Visual identity recovery in 1.3.7

Version 1.3.6 retained Flight Commander's textual product identity but
accidentally selected inherited INAV artwork for the application header and
packaged executable. Version 1.3.7 restores the visual assets from the verified
1.3.5 runtime:

- The Flight Commander wordmark was recovered from the active 1.3.5 renderer.
- The six-size Windows icon was recovered from the 1.3.5 executable resources.
- PNG and macOS icon variants were derived from that same recovered master.

The recovered wordmark SVG has SHA-256
`cc9d64ac8af17e25ce88a0209499e770ffd71df9932f8253ccf419cc2d5241d5`.
The canonical six-frame Windows ICO has SHA-256
`0cd605edccc41fd9054c73c8ef93ad10c402a9939059d8acb8b21a25f4c21d08`.

The package verifier now reads active renderer CSS and Windows PE icon
resources, so product metadata alone can no longer allow an inherited INAV
visual identity to pass the release gate.
