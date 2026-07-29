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

## Compatibility boundaries preserved by the reconstruction

The source keeps transport responsibilities explicit:

- **INAV/MSP** is the wired configuration and native persistent mission path.
- **INAV/MAVLink** supplies telemetry and carefully gated AUX-backed operational
  commands. Stock INAV's limited MAVLink mission representation is validated
  before transfer.
- **INAV/LTM** is treated as read-only telemetry.
- **ArduPilot/MAVLink** supplies native telemetry, parameters, operational
  commands, and MAVLink mission transfer.
- Firmware flashing runs through the applicable serial bootloader and is not
  treated as a live-aircraft MAVLink command.

Controller-specific commands are never intentionally translated by silently
dropping information. For example, ArduPilot distance-camera command 206 is not
written to an INAV mission.

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
