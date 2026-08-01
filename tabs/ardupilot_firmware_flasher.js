'use strict';

import GUI from './../js/gui';
import {
    ArduPilotFirmwareProvider,
    Px4BootloaderUploader,
    checkFirmwareCompatibility,
    findArduPilotWithBootloaderEntry,
    parseApjPackage,
    resolveArduPilotPlatformForInav,
} from './../js/firmware/index.js';
import ElectronSerialByteTransport from './../js/connection/electronSerialByteTransport.js';
import { rebootArduPilotToBootloader } from './../js/connection/ardupilotBootloaderEntry.js';
import { identifyInavRuntime } from './../js/connection/inavRuntimeIdentity.js';

const BOOTLOADER_BAUD = 115200;
const BOOTLOADER_WAIT_MS = 20000;
const PORT_RETRY_MS = 650;
const DFU_PORT = 'DFU';
const MANIFEST_MAV_TYPE_BY_VEHICLE = Object.freeze({
    Copter: 'Copter',
    Plane: 'FIXED_WING',
    Rover: 'GROUND_ROVER',
    Sub: 'SUBMARINE',
    Tracker: 'ANTENNA_TRACKER',
});
const INVALID_PORTS = new Set([
    '',
    '0',
    'ble',
    'tcp',
    'udp',
    'sitl',
    'sitl-demo',
]);

function delay(milliseconds, signal) {
    return new Promise((resolve, reject) => {
        const finish = () => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        };
        const timer = setTimeout(finish, milliseconds);
        const onAbort = () => {
            clearTimeout(timer);
            reject(signal?.reason instanceof Error ? signal.reason : new Error('Operation cancelled.'));
        };
        if (signal?.aborted) {
            onAbort();
            return;
        }
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

function formatBytes(value) {
    if (!Number.isFinite(value)) return 'unknown';
    if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(2)} MiB`;
    if (value >= 1024) return `${(value / 1024).toFixed(1)} KiB`;
    return `${value} bytes`;
}

function basename(url) {
    try {
        return new URL(url).pathname.split('/').filter(Boolean).at(-1) ?? 'firmware.apj';
    } catch (_error) {
        return 'firmware.apj';
    }
}

function selectedConnectionTarget() {
    const option = $('div#port-picker #port option:selected');
    const selected = String(option.val() ?? '');
    const path = option.data('isManual')
        ? String($('#port-override').val() ?? '').trim()
        : selected;
    if (path === DFU_PORT) {
        return Object.freeze({ kind: 'dfu', path });
    }
    if (INVALID_PORTS.has(path)) {
        throw new Error('Select a local serial port or an STM32 DFU controller.');
    }
    return Object.freeze({ kind: 'serial', path });
}

function selectedPortPath() {
    const selected = selectedConnectionTarget();
    if (selected.kind !== 'serial') {
        throw new Error('Select the controller serial port for PX4 bootloader identification.');
    }
    return selected.path;
}

function selectedBaudRate() {
    const baud = Number.parseInt($('div#port-picker #baud').val(), 10);
    return Number.isInteger(baud) && baud > 0 ? baud : BOOTLOADER_BAUD;
}

class ArduPilotFirmwareFlasher {
    constructor(options = {}) {
        this.provider = options.provider ?? new ArduPilotFirmwareProvider();
        this.api = options.api ?? window.electronAPI;
        this.stm32Flash = options.stm32Flash ?? null;
        this.active = false;
        this.busy = false;
        this.manifest = null;
        this.entries = [];
        this.selectedEntry = null;
        this.firmware = null;
        this.boardInfo = null;
        this.runtimeIdentity = null;
        this.platformResolution = null;
        this.detectedPlatform = null;
        this.abortController = null;
        this.transport = null;
        this.uploader = null;
        this.stm32FlashActive = false;
    }

    initialize() {
        $('#ardupilot_vehicle, #ardupilot_release_channel')
            .off('.ardupilotFirmware')
            .on('change.ardupilotFirmware', () => {
                this.firmware = null;
                this.selectedEntry = null;
                this.refreshCatalog().catch(error => this.fail(error));
            });
        $('#ardupilot_board')
            .off('.ardupilotFirmware')
            .on('change.ardupilotFirmware', () => this.populateVersions());
        $('#ardupilot_firmware_version')
            .off('.ardupilotFirmware')
            .on('change.ardupilotFirmware', () => this.selectVersion());
        $('#ardupilot_target_search')
            .off('.ardupilotFirmware')
            .on('input.ardupilotFirmware', () => this.filterTargets());
        $('#ardupilot_detect_board')
            .off('.ardupilotFirmware')
            .on('click.ardupilotFirmware', event => {
                event.preventDefault();
                this.identifyController().catch(error => this.fail(error));
            });
        $('#cancel_firmware')
            .off('.ardupilotFirmware')
            .on('click.ardupilotFirmware', event => {
                event.preventDefault();
                this.cancel();
            });
    }

    async activate() {
        this.active = true;
        if (!this.manifest) {
            await this.loadCatalog();
        } else {
            await this.refreshCatalog();
        }
    }

    deactivate() {
        this.active = false;
        this.cancel();
    }

    async loadCatalog() {
        const controller = new AbortController();
        this.abortController = controller;
        this.setBusy(true);
        this.setStatus('Loading the official ArduPilot firmware catalog…');
        try {
            this.manifest = await this.provider.loadManifest({
                signal: controller.signal,
            });
            await this.refreshCatalog();
            this.setStatus(
                `Official ArduPilot catalog loaded (${this.manifest.entries.length} usable packages).`,
                'valid',
            );
        } catch (error) {
            if (controller.signal.aborted) {
                this.setStatus('ArduPilot firmware catalog download cancelled.');
                return;
            }
            throw error;
        } finally {
            if (this.abortController === controller) {
                this.abortController = null;
            }
            this.setBusy(false);
        }
    }

    async refreshCatalog() {
        if (!this.manifest) return;
        const vehicleClass = String($('#ardupilot_vehicle').val());
        const releaseChannel = String($('#ardupilot_release_channel').val());
        const listed = await this.provider.listFirmware({
            manifest: this.manifest,
            vehicleClass,
            mavType: MANIFEST_MAV_TYPE_BY_VEHICLE[vehicleClass],
            releaseChannel,
            flashableOnly: true,
        });
        this.entries = this.boardInfo
            ? listed.filter(entry => entry.boardId === this.boardInfo.boardId)
            : this.detectedPlatform
                ? listed.filter(entry => entry.platform === this.detectedPlatform)
                : listed;

        const platforms = new Map();
        for (const entry of this.entries) {
            if (!platforms.has(entry.platform)) {
                platforms.set(entry.platform, entry);
            }
        }

        const select = $('#ardupilot_board').empty();
        select.append($('<option>', {
            value: '',
            text: this.boardInfo
                ? `Select a target matching board ID ${this.boardInfo.boardId}`
                : this.detectedPlatform
                    ? `Detected ${this.detectedPlatform}`
                    : 'Select an ArduPilot target',
        }));
        for (const [platform, entry] of [...platforms.entries()].sort(([left], [right]) => (
            left.localeCompare(right)
        ))) {
            const brand = String(entry.metadata?.brand_name ?? '').trim();
            const label = brand && brand.toLowerCase() !== platform.toLowerCase()
                ? `${brand} (${platform})`
                : platform;
            select.append($('<option>', {
                value: platform,
                text: entry.boardId ? `${label} · board ID ${entry.boardId}` : label,
            }));
        }

        if ((this.boardInfo || this.detectedPlatform) && platforms.size === 1) {
            select.val([...platforms.keys()][0]);
        }
        this.populateVersions();
        this.renderBoardIdentity();
    }

    populateVersions() {
        const platform = String($('#ardupilot_board').val() ?? '');
        const select = $('#ardupilot_firmware_version').empty();
        this.selectedEntry = null;
        this.firmware = null;
        this.setFlashReady(false);

        if (!platform) {
            select.append($('<option>', {
                value: '',
                text: 'Select a controller target first',
            }));
            return;
        }

        const matches = this.entries.filter(entry => entry.platform === platform);
        select.append($('<option>', {
            value: '',
            text: `Select ${platform} firmware`,
        }));
        for (const entry of matches) {
            const label = [
                entry.version,
                entry.versionType,
                entry.packageFormat?.toUpperCase(),
            ].filter(Boolean).join(' · ');
            select.append(
                $('<option>', { value: String(entry.index), text: label }).data('entry', entry),
            );
        }
        if (matches.length === 1) {
            select.val(String(matches[0].index)).trigger('change');
        }
    }

    selectVersion() {
        this.selectedEntry = $('#ardupilot_firmware_version option:selected').data('entry') ?? null;
        this.firmware = null;
        this.setFlashReady(false);
        if (!this.selectedEntry) {
            $('div.release_info').slideUp();
            return;
        }
        this.renderRelease(this.selectedEntry);
        $('a.load_remote_file').removeClass('disabled').text('Download firmware');
        this.setStatus(
            `Selected ${this.selectedEntry.platform} ${this.selectedEntry.version}. Download it before flashing.`,
        );
    }

    filterTargets() {
        const query = String($('#ardupilot_target_search').val() ?? '').trim().toLowerCase();
        $('#ardupilot_board option').each(function(index) {
            const option = $(this);
            option.toggle(index === 0 || !query || option.text().toLowerCase().includes(query));
        });
    }

    async loadRemote() {
        if (!this.selectedEntry) {
            throw new Error('Select an ArduPilot controller target and firmware version first.');
        }
        const controller = new AbortController();
        this.abortController = controller;
        this.setBusy(true);
        this.setStatus(`Downloading ${this.selectedEntry.platform} ${this.selectedEntry.version}…`);
        try {
            this.firmware = await this.provider.downloadPackage(this.selectedEntry, {
                signal: controller.signal,
            });
            if (
                this.selectedEntry.boardId != null
                && this.selectedEntry.boardId !== this.firmware.boardId
            ) {
                throw new Error(
                    `Catalog board ID ${this.selectedEntry.boardId} does not match package board ID ${this.firmware.boardId}.`,
                );
            }
            this.renderFirmwareReady();
        } catch (error) {
            if (controller.signal.aborted) {
                this.setStatus('ArduPilot firmware download cancelled.');
                return;
            }
            throw error;
        } finally {
            if (this.abortController === controller) {
                this.abortController = null;
            }
            this.setBusy(false);
        }
    }

    async loadLocal() {
        const result = await this.api.showOpenDialog({
            filters: [
                { name: 'ArduPilot firmware package', extensions: ['apj', 'px4'] },
            ],
            properties: ['openFile'],
        });
        if (result.canceled || !result.filePaths?.length) return;

        this.setBusy(true);
        try {
            const filePath = result.filePaths[0];
            const response = await this.api.readFile(filePath);
            if (response.error) {
                throw new Error(response.error.message || String(response.error));
            }
            const extension = filePath.toLowerCase().endsWith('.px4') ? 'px4' : 'apj';
            this.firmware = parseApjPackage(response.data, { sourceFormat: extension });
            this.selectedEntry = null;
            $('div.release_info .target').text(`Board ID ${this.firmware.boardId}`);
            $('div.release_info .name').text(this.firmware.version || 'Local firmware').removeAttr('href');
            $('div.release_info .file').text(filePath).removeAttr('href');
            $('div.release_info .date').text('');
            $('div.release_info .status').text('local package').show();
            $('div.release_info .notes').text(
                this.firmware.description || this.firmware.summary || 'Locally loaded ArduPilot package.',
            );
            $('div.release_info').slideDown();
            this.renderFirmwareReady();
        } finally {
            this.setBusy(false);
        }
    }

    renderRelease(entry) {
        if (!this.active) return;
        $('div.release_info .target').text(entry.platform);
        $('div.release_info .name')
            .text(`${entry.vehicleType} ${entry.version}`)
            .prop('href', entry.url);
        $('div.release_info .file').text(basename(entry.url)).prop('href', entry.url);
        $('div.release_info .date').text(entry.gitSha ? `Git ${entry.gitSha.slice(0, 12)}` : '');
        $('div.release_info .status').text(entry.versionType || entry.releaseChannel).show();
        const brand = [entry.metadata?.manufacturer, entry.metadata?.brand_name]
            .filter(Boolean)
            .join(' · ');
        $('div.release_info .notes').text(
            `${brand ? `${brand}. ` : ''}Official ArduPilot ${entry.packageFormat?.toUpperCase()} package.`
        );
        $('div.release_info').slideDown();
    }

    renderFirmwareReady() {
        if (!this.active || !this.firmware) return;
        const compatibility = this.boardInfo
            ? checkFirmwareCompatibility(this.boardInfo, this.firmware)
            : null;
        if (compatibility && !compatibility.compatible) {
            this.setStatus(compatibility.reasons.join(' '), 'invalid');
            this.setFlashReady(false);
            return;
        }

        let verificationMessage = 'The controller will be identified and checked again before erase.';
        let kind = compatibility ? 'valid' : 'neutral';
        if (this.boardInfo) {
            verificationMessage = 'The package matches the authoritative PX4 bootloader board ID.';
        } else if (this.runtimeIdentity?.kind === 'inav' && this.detectedPlatform) {
            verificationMessage = (
                `INAV target ${this.runtimeIdentity.target} matches ${this.detectedPlatform}. `
                + 'The target will be rechecked before the official with-bootloader image is installed through STM32 DFU.'
            );
            kind = 'valid';
        } else if (this.runtimeIdentity?.kind === 'dfu') {
            verificationMessage = (
                'STM32 DFU cannot report a board model. The manually selected target will require explicit confirmation.'
            );
            kind = 'action';
        }

        this.setStatus(
            `Firmware loaded: board ID ${this.firmware.boardId}, ${formatBytes(this.firmware.imageSize)}. `
            + verificationMessage,
            kind,
        );
        this.setFlashReady(true);
    }

    async refreshCatalogPreservingLoadedFirmware() {
        const loadedFirmware = this.firmware;
        const selectedEntry = this.selectedEntry;
        await this.refreshCatalog();
        if (
            !loadedFirmware
            || !selectedEntry
            || !this.entries.some(entry => entry.index === selectedEntry.index)
        ) {
            return;
        }
        $('#ardupilot_board').val(selectedEntry.platform);
        this.populateVersions();
        $('#ardupilot_firmware_version').val(String(selectedEntry.index));
        this.selectedEntry = selectedEntry;
        this.firmware = loadedFirmware;
        this.renderRelease(selectedEntry);
        this.renderFirmwareReady();
    }

    async applyInavIdentity(inavInfo) {
        this.boardInfo = null;
        this.runtimeIdentity = Object.freeze({ kind: 'inav', ...inavInfo });
        this.platformResolution = resolveArduPilotPlatformForInav(
            inavInfo.target,
            this.manifest?.entries ?? [],
        );
        this.detectedPlatform = this.platformResolution.matched
            ? this.platformResolution.platform
            : null;
        await this.refreshCatalogPreservingLoadedFirmware();
        this.renderBoardIdentity();
        if (this.detectedPlatform) {
            const method = this.platformResolution.method === 'exact-name'
                ? 'exact target-name match'
                : 'documented hardware mapping';
            this.setStatus(
                `Detected INAV ${inavInfo.firmwareVersion} target ${inavInfo.target}; `
                + `${method} selected ArduPilot target ${this.detectedPlatform}.`,
                'valid',
            );
        } else {
            this.setStatus(
                `Detected INAV target ${inavInfo.target}, but no exact official ArduPilot target match exists. `
                + 'Select the documented hardware target manually before first installation.',
                'action',
            );
        }
        if (this.firmware) this.renderFirmwareReady();
    }

    async identifyController() {
        if (this.busy || GUI.connect_lock) return;
        const selected = selectedConnectionTarget();
        this.setBusy(true);
        this.abortController = new AbortController();
        try {
            if (selected.kind === 'dfu') {
                this.boardInfo = null;
                this.runtimeIdentity = Object.freeze({ kind: 'dfu', path: DFU_PORT });
                this.platformResolution = null;
                this.detectedPlatform = null;
                await this.refreshCatalogPreservingLoadedFirmware();
                this.renderBoardIdentity();
                this.setStatus(
                    'STM32 ROM DFU detected. It cannot report the board model; select the exact ArduPilot target manually.',
                    'action',
                );
                return;
            }

            const acquired = await this.acquireController(this.abortController.signal);
            if (acquired.kind === 'inav') {
                await this.applyInavIdentity(acquired.inavInfo);
                return;
            }

            this.boardInfo = acquired.boardInfo;
            this.runtimeIdentity = null;
            this.platformResolution = null;
            this.detectedPlatform = null;
            this.transport = acquired.transport;
            this.uploader = acquired.uploader;
            this.setStatus(
                `Identified PX4 bootloader board ID ${this.boardInfo.boardId}, revision ${this.boardInfo.boardRevision}.`,
                'valid',
            );
            this.renderBoardIdentity();
            await this.refreshCatalogPreservingLoadedFirmware();
            try {
                await this.uploader.reboot({ signal: this.abortController.signal });
            } catch (_error) {
                // Some boards remove the USB serial endpoint before the reboot
                // acknowledgement reaches the host.
            }
            await this.closeTransport();
            if (this.firmware) this.renderFirmwareReady();
        } finally {
            await this.closeTransport();
            this.abortController = null;
            this.setBusy(false);
        }
    }

    async acquireController(signal) {
        const selectedPath = selectedPortPath();
        const before = await this.api.listSerialDeviceInfo();
        const selectedInfo = before.find(info => info.path === selectedPath) ?? null;

        this.setStatus(`Checking ${selectedPath} for a PX4 bootloader or running INAV target…`);
        const direct = await this.tryControllerPort(selectedPath, signal);
        if (direct) return direct;

        this.setStatus('Requesting the running ArduPilot controller to enter its bootloader…');
        try {
            await rebootArduPilotToBootloader(selectedPath, {
                api: this.api,
                baudRate: selectedBaudRate(),
                heartbeatTimeoutMs: 4500,
                signal,
            });
        } catch (error) {
            GUI.log(`Automatic ArduPilot bootloader entry did not complete: ${error.message}`);
            this.setStatus(
                'Waiting for the bootloader. If needed, press the controller reset button or unplug/replug it now.',
                'action',
            );
        }

        const originalPaths = new Set(before.map(info => info.path));
        const lastAttempt = new Map();
        const deadline = Date.now() + BOOTLOADER_WAIT_MS;
        while (Date.now() < deadline) {
            if (signal.aborted) throw signal.reason ?? new Error('Operation cancelled.');
            const current = await this.api.listSerialDeviceInfo();
            const candidates = current
                .filter(info => (
                    info.path === selectedPath
                    || (selectedInfo?.serialNumber && info.serialNumber === selectedInfo.serialNumber)
                    || !originalPaths.has(info.path)
                ))
                .sort((left, right) => {
                    if (left.path === selectedPath) return -1;
                    if (right.path === selectedPath) return 1;
                    return left.path.localeCompare(right.path);
                });

            for (const candidate of candidates) {
                if (Date.now() - (lastAttempt.get(candidate.path) ?? 0) < PORT_RETRY_MS) continue;
                lastAttempt.set(candidate.path, Date.now());
                const acquired = await this.tryBootloaderPort(candidate.path, signal);
                if (acquired) {
                    if ($(`div#port-picker #port option[value="${CSS.escape(candidate.path)}"]`).length) {
                        $('div#port-picker #port').val(candidate.path);
                    }
                    return acquired;
                }
            }
            await delay(300, signal);
        }

        throw new Error(
            'No PX4 bootloader or running INAV MSP target was detected. Select the controller port, or enter STM32 DFU for a manual first install.',
        );
    }

    async tryControllerPort(path, signal) {
        const transport = new ElectronSerialByteTransport(this.api);
        try {
            await transport.open(path, BOOTLOADER_BAUD);
            try {
                const probe = new Px4BootloaderUploader(transport, {
                    timeoutMs: 900,
                    eraseTimeoutMs: 20000,
                    maxRetries: 0,
                    onProgress: event => this.handleProgress(event),
                });
                const boardInfo = await probe.identify({ signal });
                const uploader = new Px4BootloaderUploader(transport, {
                    onProgress: event => this.handleProgress(event),
                });
                uploader.boardInfo = boardInfo;
                return { kind: 'px4', path, transport, uploader, boardInfo };
            } catch (_bootloaderError) {
                transport.flushInput();
            }

            this.setStatus(`Checking ${path} for a running INAV MSP target…`);
            try {
                const inavInfo = await identifyInavRuntime(transport, {
                    timeoutMs: 1200,
                    signal,
                });
                await transport.close().catch(() => {});
                return { kind: 'inav', path, inavInfo };
            } catch (_inavError) {
                await transport.close().catch(() => {});
                return null;
            }
        } catch (_error) {
            await transport.close().catch(() => {});
            return null;
        }
    }

    async tryBootloaderPort(path, signal) {
        const transport = new ElectronSerialByteTransport(this.api);
        try {
            await transport.open(path, BOOTLOADER_BAUD);
            const probe = new Px4BootloaderUploader(transport, {
                timeoutMs: 900,
                eraseTimeoutMs: 20000,
                maxRetries: 0,
                onProgress: event => this.handleProgress(event),
            });
            const boardInfo = await probe.identify({ signal });
            const uploader = new Px4BootloaderUploader(transport, {
                onProgress: event => this.handleProgress(event),
            });
            uploader.boardInfo = boardInfo;
            return { kind: 'px4', path, transport, uploader, boardInfo };
        } catch (_error) {
            await transport.close().catch(() => {});
            return null;
        }
    }

    async flashPx4Firmware(acquired, signal) {
        this.transport = acquired.transport;
        this.uploader = acquired.uploader;
        this.boardInfo = acquired.boardInfo;
        this.runtimeIdentity = null;
        this.platformResolution = null;
        this.detectedPlatform = null;
        this.renderBoardIdentity();

        const compatibility = checkFirmwareCompatibility(this.boardInfo, this.firmware);
        if (!compatibility.compatible) {
            throw new Error(compatibility.reasons.join(' '));
        }

        const confirmed = await this.api.confirmDialog(
            `Erase and flash PX4 bootloader board ID ${this.boardInfo.boardId} `
            + `(revision ${this.boardInfo.boardRevision}) with firmware board ID `
            + `${this.firmware.boardId}, ${formatBytes(this.firmware.imageSize)}?`,
        );
        if (!confirmed) {
            try {
                await this.uploader.reboot({ signal });
            } catch (_error) {
                // The device may already have rebooted.
            }
            this.setStatus('ArduPilot firmware flash cancelled.');
            return;
        }

        const result = await this.uploader.flash(this.firmware, {
            signal,
            onProgress: event => this.handleProgress(event),
            reboot: true,
        });
        this.setStatus(
            `Firmware verified by CRC and controller rebooted. ${result.bytesProgrammed} bytes programmed.`,
            'valid',
        );
        $('.progress').val(100).addClass('valid').removeClass('invalid');
    }

    validateFirstInstallTarget(connection, selectedEntry) {
        if (connection.kind !== 'inav') {
            return null;
        }
        const resolution = resolveArduPilotPlatformForInav(
            connection.inavInfo.target,
            this.manifest?.entries ?? [],
        );
        if (resolution.matched && resolution.platform !== selectedEntry.platform) {
            throw new Error(
                `INAV target ${connection.inavInfo.target} matches ArduPilot target `
                + `${resolution.platform}, not the selected ${selectedEntry.platform}.`,
            );
        }
        if (
            resolution.ambiguous
            && !resolution.candidates.includes(selectedEntry.platform)
        ) {
            throw new Error(
                `Selected ArduPilot target ${selectedEntry.platform} is not one of the matches for `
                + `INAV target ${connection.inavInfo.target}.`,
            );
        }
        return resolution;
    }

    async flashFirstInstall(connection, signal) {
        const selectedEntry = this.selectedEntry;
        const firmware = this.firmware;
        if (!selectedEntry) {
            throw new Error(
                'A first ArduPilot install from INAV/DFU requires an online catalog selection. '
                + 'A local APJ does not include the ArduPilot bootloader.',
            );
        }
        if (selectedEntry.boardId !== firmware.boardId) {
            throw new Error(
                `Selected target board ID ${selectedEntry.boardId} does not match loaded firmware board ID ${firmware.boardId}.`,
            );
        }

        const resolution = this.validateFirstInstallTarget(connection, selectedEntry);
        if (connection.kind === 'inav') {
            this.boardInfo = null;
            this.runtimeIdentity = Object.freeze({
                kind: 'inav',
                ...connection.inavInfo,
            });
            this.platformResolution = resolution;
            this.detectedPlatform = resolution?.matched ? resolution.platform : null;
            this.renderBoardIdentity();
        } else {
            this.boardInfo = null;
            this.runtimeIdentity = Object.freeze({ kind: 'dfu', path: DFU_PORT });
            this.platformResolution = null;
            this.detectedPlatform = null;
            this.renderBoardIdentity();
        }

        const withBootloaderEntry = findArduPilotWithBootloaderEntry(
            this.manifest,
            selectedEntry,
        );
        if (!withBootloaderEntry) {
            throw new Error(
                `The official manifest does not provide a matching with-bootloader HEX for `
                + `${selectedEntry.platform} ${selectedEntry.version}.`,
            );
        }

        this.setStatus(
            `Downloading official first-install image ${basename(withBootloaderEntry.url)}…`,
        );
        const withBootloaderHex = await this.provider.downloadWithBootloaderHex(
            withBootloaderEntry,
            { signal },
        );

        const identityText = connection.kind === 'inav' && resolution?.matched
            ? `INAV target ${connection.inavInfo.target} matches ${selectedEntry.platform}.`
            : connection.kind === 'inav'
                ? `INAV target ${connection.inavInfo.target} has no exact catalog-name match; ${selectedEntry.platform} was selected manually.`
                : 'STM32 DFU cannot report a board model; the target was selected manually.';
        const confirmed = await this.api.confirmDialog(
            `${identityText} Install official ${selectedEntry.vehicleType} ${selectedEntry.version} `
            + `for board ID ${firmware.boardId}? This first install will fully erase INAV, `
            + 'write the ArduPilot bootloader and firmware, then verify every programmed byte.',
        );
        if (!confirmed) {
            this.setStatus('First-time ArduPilot installation cancelled. No erase was started.');
            return;
        }
        if (typeof this.stm32Flash !== 'function') {
            throw new Error('STM32 first-install bridge is unavailable in this build.');
        }

        this.stm32FlashActive = true;
        this.setBusy(true);
        this.setStatus(
            connection.kind === 'dfu'
                ? 'Full-chip erase and ArduPilot first install starting in STM32 DFU…'
                : 'Rebooting INAV to STM32 DFU for full-chip erase and ArduPilot first install…',
            'action',
        );
        const successful = await this.stm32Flash({
            path: connection.path,
            baudRate: selectedBaudRate(),
            hex: withBootloaderHex,
            options: {
                erase_chip: true,
                reboot_baud: selectedBaudRate(),
            },
        });
        if (!successful) {
            throw new Error(
                'STM32 erase, programming, or read-back verification failed. Enter DFU again and retry the same target.',
            );
        }

        this.runtimeIdentity = Object.freeze({
            kind: 'installed',
            platform: selectedEntry.platform,
            boardId: firmware.boardId,
        });
        this.detectedPlatform = selectedEntry.platform;
        this.setStatus(
            `ArduPilot bootloader and ${selectedEntry.vehicleType} ${selectedEntry.version} installed; `
            + `${withBootloaderHex.bytes_total} bytes passed STM32 read-back verification. Reconnect after USB returns.`,
            'valid',
        );
        $('.progress').val(100).addClass('valid').removeClass('invalid');
    }

    async flash() {
        if (this.busy || GUI.connect_lock) return;
        if (!this.firmware) {
            throw new Error('Download or load an ArduPilot APJ package before flashing.');
        }

        const selected = selectedConnectionTarget();
        const controller = new AbortController();
        this.setBusy(true);
        GUI.connect_lock = true;
        this.abortController = controller;
        try {
            if (selected.kind === 'dfu') {
                await this.flashFirstInstall(selected, controller.signal);
                return;
            }

            const acquired = await this.acquireController(controller.signal);
            if (acquired.kind === 'inav') {
                await this.flashFirstInstall(acquired, controller.signal);
                return;
            }
            await this.flashPx4Firmware(acquired, controller.signal);
        } catch (error) {
            if (controller.signal.aborted && !this.stm32FlashActive) {
                this.setStatus(
                    'Firmware operation cancelled before programming completed. Re-enter the bootloader/DFU and restart the flash.',
                    'invalid',
                );
            } else {
                throw error;
            }
        } finally {
            this.stm32FlashActive = false;
            await this.closeTransport();
            if (this.abortController === controller) {
                this.abortController = null;
            }
            GUI.connect_lock = false;
            this.setBusy(false);
        }
    }

    handleProgress(event) {
        const percent = Math.round((event.overallRatio ?? event.ratio ?? 0) * 100);
        $('.progress').val(percent).removeClass('valid invalid');
        const labels = {
            identify: 'Identifying bootloader',
            erase: 'Erasing controller flash',
            program: 'Programming firmware',
            verify: 'Verifying firmware CRC',
            reboot: 'Rebooting controller',
            complete: 'Firmware flash complete',
        };
        const label = labels[event.phase] ?? 'Working';
        this.setStatus(`${label}… ${percent}%`);
    }

    renderBoardIdentity() {
        const element = $('#ardupilot_board_identity')
            .removeClass('is-valid is-error');
        if (this.runtimeIdentity?.kind === 'inav') {
            const resolution = this.platformResolution;
            element
                .addClass(resolution?.matched ? 'is-valid' : 'is-error')
                .text(
                    `Running INAV ${this.runtimeIdentity.firmwareVersion} · MSP target `
                    + `${this.runtimeIdentity.target} · board ${this.runtimeIdentity.boardIdentifier}`
                    + (resolution?.matched
                        ? ` · ArduPilot first-install target: ${resolution.platform} (${resolution.method})`
                        : ' · no exact ArduPilot catalog-name match; manual hardware confirmation required')
                    + ' · PX4 board ID becomes available after the ArduPilot bootloader is installed',
                );
            return;
        }
        if (this.runtimeIdentity?.kind === 'dfu') {
            element
                .addClass('is-error')
                .text(
                    'STM32 ROM DFU · MCU recovery interface detected · board model and PX4 board ID unavailable · '
                    + 'select and confirm the exact hardware target manually',
                );
            return;
        }
        if (this.runtimeIdentity?.kind === 'installed') {
            element
                .addClass('is-valid')
                .text(
                    `First install verified · ${this.runtimeIdentity.platform} · firmware board ID `
                    + `${this.runtimeIdentity.boardId} · reconnect and identify again to read the new PX4 bootloader`,
                );
            return;
        }
        if (!this.boardInfo) {
            element.text(
                'Controller not identified. A PX4 bootloader provides the authoritative board ID. '
                + 'A running INAV controller can be pre-matched by its exact MSP target for a first install.',
            );
            return;
        }
        const platforms = this.manifest
            ? [...new Set(
                this.manifest.entries
                    .filter(entry => entry.boardId === this.boardInfo.boardId)
                    .map(entry => entry.platform),
            )].sort()
            : [];
        element
            .addClass(platforms.length ? 'is-valid' : 'is-error')
            .text(
                `PX4FMU bootloader ${this.boardInfo.bootloaderRevision} · board ID `
                + `${this.boardInfo.boardId} · board revision ${this.boardInfo.boardRevision} · `
                + `${formatBytes(this.boardInfo.flashSize)} flash`
                + (platforms.length
                    ? ` · catalog target${platforms.length === 1 ? '' : 's'}: ${platforms.join(', ')}`
                    : ' · no matching official APJ target in the selected catalog'),
            );
    }

    setFlashReady(ready) {
        if (!this.active) return;
        $('a.flash_firmware').toggleClass('disabled', !ready || this.busy);
    }

    setBusy(busy) {
        this.busy = busy;
        if (!this.active) return;
        $('#ardupilot_vehicle, #ardupilot_release_channel, #ardupilot_board, '
          + '#ardupilot_firmware_version, #ardupilot_detect_board')
            .prop('disabled', busy);
        $('#cancel_firmware')
            .toggleClass('disabled', !busy || this.stm32FlashActive)
            .toggleClass('is-hidden', !busy || this.stm32FlashActive);
        $('a.load_file').toggleClass('disabled', busy);
        $('a.load_remote_file').toggleClass('disabled', busy || !this.selectedEntry);
        this.setFlashReady(Boolean(this.firmware) && !busy);
    }

    setStatus(message, kind = 'neutral') {
        if (!this.active) return;
        $('span.progressLabel')
            .text(message)
            .removeClass('valid invalid actionRequired')
            .toggleClass('valid', kind === 'valid')
            .toggleClass('invalid', kind === 'invalid')
            .toggleClass('actionRequired', kind === 'action');
        if (kind === 'invalid') {
            $('.progress').addClass('invalid').removeClass('valid');
        }
    }

    fail(error) {
        console.error(error);
        if (!this.active) return;
        this.setStatus(error?.message || String(error), 'invalid');
        GUI.log(`ArduPilot firmware operation failed: ${error?.message || error}`);
        this.setBusy(false);
        GUI.connect_lock = false;
    }

    cancel() {
        if (this.stm32FlashActive) {
            this.setStatus(
                'STM32 programming cannot be cancelled safely after erase begins. Keep the controller connected until verification finishes.',
                'action',
            );
            return;
        }
        if (this.abortController && !this.abortController.signal.aborted) {
            this.abortController.abort(new Error('Cancelled by user.'));
        }
    }

    async closeTransport() {
        const transport = this.transport;
        this.transport = null;
        this.uploader = null;
        if (transport) {
            await transport.close().catch(() => {});
        }
    }

    async cleanup() {
        this.active = false;
        this.cancel();
        await this.closeTransport();
        $('#ardupilot_vehicle, #ardupilot_release_channel, #ardupilot_board, '
          + '#ardupilot_firmware_version, #ardupilot_target_search, '
          + '#ardupilot_detect_board, #cancel_firmware')
            .off('.ardupilotFirmware');
    }
}

export default ArduPilotFirmwareFlasher;
export {
    ArduPilotFirmwareFlasher,
    BOOTLOADER_BAUD,
    selectedConnectionTarget,
    selectedPortPath,
};
