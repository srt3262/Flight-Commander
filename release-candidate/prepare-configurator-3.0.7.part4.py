
package_contract = read('tests/flight-commander/packaging/package-contract.test.mjs').replace('3.0.3', VERSION)
package_contract = package_contract.replace(
    '  assert.match(firmwareCatalogSource, /MICROAIR743/);\n',
    '  assert.match(firmwareCatalogSource, /MICROAIR743/);\n  assert.match(firmwareCatalogSource, /FLIGHT_COMMANDER_MINIMUM_SUPPORTED_FIRMWARE_VERSION = "3\\.0\\.7"/);\n  assert.match(firmwareCatalogSource, /isSupportedFlightCommanderFirmwareVersion/);\n',
    1,
)
package_contract = package_contract.replace(
    '  assert.match(releaseWorkflow, /Published online-flasher firmware asset/);\n',
    '  assert.match(releaseWorkflow, /Published online-flasher firmware asset/);\n  assert.match(releaseWorkflow, /Remove every superseded standalone Flight Commander firmware asset/);\n  assert.match(releaseWorkflow, /Superseded firmware asset remains after cleanup/);\n',
    1,
)
write('tests/flight-commander/packaging/package-contract.test.mjs', package_contract)

version_contract = read('tests/flight-commander/packaging/version-contract.test.mjs')
version_contract = version_contract.replace('3.0.3', VERSION).replace('3.0.4', '3.0.8')
write('tests/flight-commander/packaging/version-contract.test.mjs', version_contract)

# Release workflow: exact trigger, cleanup of old standalone firmware assets,
# and release notes documenting why the floor exists.
release_path = '.github/workflows/release.yml'
release = read(release_path).replace('Publish Flight Commander 3.0.3 release', 'Publish Flight Commander 3.0.7 release')
cleanup_anchor = '''          Assert-GitHubResourceMissing "git/ref/tags/$encodedTag" "Tag $tag"\n          Assert-GitHubResourceMissing "releases/tags/$encodedTag" "Release $tag"\n\n'''
cleanup_block = '''          # Remove every superseded standalone Flight Commander firmware asset\n          # before publishing the Configurator that consumes the online catalog.\n          # Historical release pages and Configurator bundles remain available,\n          # but firmware earlier than 3.0.7 is neither separately downloadable\n          # nor selectable in the Configurator.\n          $supersededFirmwarePatterns = @(\n            '^Flight-Commander-Firmware-.*\\.(?:hex|bin)$',\n            '^FC-Firmware-v.*\\.(?:hex|bin)$',\n            '^Flight-Commander-Firmware-Source-v.*\\.zip$',\n            '^FC-Firmware-Source-v.*\\.zip$'\n          )\n          $releasePage = 1\n          $removedFirmwareAssets = 0\n          while ($true) {\n            $releaseListResponse = Get-GitHubResource (\n              "releases?per_page=100&page=$releasePage"\n            )\n            if ([int]$releaseListResponse.StatusCode -ne 200) {\n              throw "Unable to enumerate existing releases; GitHub returned HTTP $($releaseListResponse.StatusCode)."\n            }\n            $releaseList = @($releaseListResponse.Content | ConvertFrom-Json)\n            if ($releaseList.Count -eq 0) { break }\n            foreach ($priorRelease in $releaseList) {\n              foreach ($asset in @($priorRelease.assets)) {\n                $assetName = [string]$asset.name\n                $isSupersededFirmware = $false\n                foreach ($pattern in $supersededFirmwarePatterns) {\n                  if ($assetName -match $pattern) {\n                    $isSupersededFirmware = $true\n                    break\n                  }\n                }\n                if (-not $isSupersededFirmware) { continue }\n                gh api --method DELETE `\n                  -H 'Accept: application/vnd.github+json' `\n                  -H 'X-GitHub-Api-Version: 2022-11-28' `\n                  "/repos/$env:GITHUB_REPOSITORY/releases/assets/$($asset.id)"\n                if ($LASTEXITCODE -ne 0) {\n                  throw "Failed to remove superseded firmware asset $assetName."\n                }\n                $removedFirmwareAssets++\n              }\n            }\n            if ($releaseList.Count -lt 100) { break }\n            $releasePage++\n          }\n\n          # Fail closed if any superseded standalone firmware survived cleanup.\n          $releasePage = 1\n          while ($true) {\n            $releaseListResponse = Get-GitHubResource (\n              "releases?per_page=100&page=$releasePage"\n            )\n            if ([int]$releaseListResponse.StatusCode -ne 200) {\n              throw "Unable to verify firmware cleanup; GitHub returned HTTP $($releaseListResponse.StatusCode)."\n            }\n            $releaseList = @($releaseListResponse.Content | ConvertFrom-Json)\n            if ($releaseList.Count -eq 0) { break }\n            foreach ($priorRelease in $releaseList) {\n              foreach ($asset in @($priorRelease.assets)) {\n                foreach ($pattern in $supersededFirmwarePatterns) {\n                  if ([string]$asset.name -match $pattern) {\n                    throw "Superseded firmware asset remains after cleanup: $($asset.name)"\n                  }\n                }\n              }\n            }\n            if ($releaseList.Count -lt 100) { break }\n            $releasePage++\n          }\n          Write-Host "Removed $removedFirmwareAssets superseded standalone firmware assets."\n\n'''
if cleanup_block.strip() not in release:
    if cleanup_anchor not in release:
        raise SystemExit('release workflow cleanup insertion anchor not found')
    release = release.replace(cleanup_anchor, cleanup_anchor + cleanup_block, 1)
old_notes = '''          Arm GNU 13.2.Rel1 toolchain. The Alignment tab retains live diagnostics\n          and normal editable INAV alignment without a forced compass override.\n'''
new_notes = '''          Arm GNU 13.2.Rel1 toolchain. Physical bench testing established the\n          canonical onboard IST8310 transform X=-nativeY, Y=-nativeX, Z=nativeZ\n          with user alignment CW 0 degrees. Future MICOAIR743 development is\n          contract-tested against that board/IMU relationship.\n\n          Firmware versions earlier than 3.0.7 had an incorrect onboard compass\n          transform. Their standalone firmware assets are removed before this\n          release is created, and Configurator 3.0.7 refuses to list firmware\n          older than 3.0.7 in the online firmware dropdown.\n'''
if old_notes not in release:
    raise SystemExit('release workflow notes replacement anchor not found')
release = release.replace(old_notes, new_notes, 1)
write(release_path, release)

changelog_entry = '''# Flight Commander 3.0.7\n\n- Publishes the first officially accepted MICOAIR743 onboard IST8310 compass baseline.\n- Preserves the physically validated transform `X=-nativeY`, `Y=-nativeX`, `Z=nativeZ` with onboard user alignment `CW 0°`.\n- Retires every earlier standalone Flight Commander firmware asset because those versions used an incorrect compass transform.\n- Filters the online firmware dropdown so versions older than 3.0.7 cannot be selected, even from stale GitHub API responses.\n- Coordinates Configurator, firmware HEX, Configurator source, and firmware source at version 3.0.7.\n\n'''
changelog = read('CHANGELOG.md')
if not changelog.startswith(changelog_entry):
    write('CHANGELOG.md', changelog_entry + changelog)

# Repository release firmware is canonical and release-only.
release_dir = path('release/firmware')
release_dir.mkdir(parents=True, exist_ok=True)
for existing in release_dir.iterdir():
    if existing.is_file():
        existing.unlink()

# Final fail-closed contracts before binaries are copied.
assert json.loads(read('package.json'))['version'] == VERSION
assert json.loads(read('manifest.json'))['version'] == VERSION
assert 'FLIGHT_COMMANDER_MINIMUM_SUPPORTED_FIRMWARE_VERSION = "3.0.7"' in read('js/flightCommander/firmwareCatalog.js')
assert 'isSupportedFlightCommanderFirmwareVersion(parsed.version)' in read('js/flightCommander/firmwareCatalog.js')
assert 'Publish Flight Commander 3.0.7 release' in read(release_path)
assert 'Remove every superseded standalone Flight Commander firmware asset' in read(release_path)
heading_doc = read('docs/HEADING_FUSION.md')
assert 'X = -native Y' in heading_doc and 'Y = -native X' in heading_doc and 'Z =  native Z' in heading_doc
print('Prepared Configurator 3.0.7 source and release policy.')
