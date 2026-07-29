'use strict';

import GUI from './../js/gui';
import {
    ArduPilotFirmwareProvider,
    Px4BootloaderUploader,
    checkFirmwareCompatibility,
    parseApjPackage,
} from './../js/firmware/index.js';
import ElectronSerialByteTransport from './../js/connection/electronSerialByteTransport.js';
import { rebootArduPilotToBootloader } from './../js/connection/ardupilotBootloaderEntry.js';

const BOOTLOADER_BAUD = 115200;
const BOOTLOADER_WAIT_MS = 20000;
const PORT_RETRY_MS = 650;
const INVALID_PORTS = new Set([
    '',
    '0',
    'DFU',
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

function selectedPortPath() {
    const option = $('div#port-picker #port option:selected');
    const selected = String(option.val() ?? '');
    const path = option.data('isManual')
        ? String($('#port-override').val() ?? '').trim()
        : selected;
    if (INVALID_PORTS.has(path)) {
        throw new Error('Select a local serial port for the Cube/Pixhawk controller.');
    }
    return path;
}

function selectedBaudRate() {
    const baud = Number.parseInt($('div#port-picker #baud').val(), 10);
    return Number.isInteger(baud) && baud > 0 ? baud : BOOTLOADER_BAUD;
}

class ArduPilotFirmwareFlasher {
    constructor(options = {}) {
        this.provider = options.provider ?? new ArduPilotFirmwareProvider();
        this.api = options.api ?? window.electronAPI;
        this.active = false;
        this.busy = false;
        this.manifest = null;
        this.entries = [];
        this.selectedEntry = null;
        this.firmware = null;
        this.boardInfo = null;
        this.abortController = null;
        this.transport = null;
        this.uploader = null;
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
            releaseChannel,
            flashableOnly: true,
        });
        this.entries = this.boardInfo
            ? listed.filter(entry => entry.boardId === this.boardInfo.boardId)
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
                : 'Select a Cube/Pixhawk target',
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

        if (this.boardInfo && platforms.size === 1) {
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

        this.setStatus(
            `Firmware loaded: board ID ${this.firmware.boardId}, ${formatBytes(this.firmware.imageSize)}. `
            + (this.boardInfo
                ? 'The package matches the identified controller.'
                : 'The controller will be identified and checked again before erase.'),
            compatibility ? 'valid' : 'neutral',
        );
        this.setFlashReady(true);
    }

    async identifyController() {
        if (this.busy || GUI.connect_lock) return;
        this.setBusy(true);
        this.abortController = new AbortController();
        try {
            const acquired = await this.acquireBootloader(this.abortController.signal);
            this.boardInfo = acquired.boardInfo;
            this.transport = acquired.transport;
            this.uploader = acquired.uploader;
            this.setStatus(
                `Identified bootloader board ID ${this.boardInfo.boardId}, revision ${this.boardInfo.boardRevision}.`,
                'valid',
            );
            this.renderBoardIdentity();
            const loadedFirmware = this.firmware;
            const selectedEntry = this.selectedEntry;
            await this.refreshCatalog();
            this.firmware = loadedFirmware;
            this.selectedEntry = selectedEntry;
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

    async acquireBootloader(signal) {
        const selectedPath = selectedPortPath();
        const before = await this.api.listSerialDeviceInfo();
        const selectedInfo = before.find(info => info.path === selectedPath) ?? null;

        this.setStatus(`Checking ${selectedPath} for a PX4FMU bootloader…`);
        const direct = await this.tryBootloaderPort(selectedPath, signal);
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
            'The Cube/Pixhawk bootloader was not detected. Select its serial port, then press Identify again while reconnecting or resetting the controller.',
        );
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
            return { path, transport, uploader, boardInfo };
        } catch (_error) {
            await transport.close().catch(() => {});
            return null;
        }
    }

    async flash() {
        if (this.busy || GUI.connect_lock) return;
        if (!this.firmware) {
            throw new Error('Download or load an ArduPilot APJ package before flashing.');
        }

        this.setBusy(true);
        GUI.connect_lock = true;
        this.abortController = new AbortController();
        let acquired = null;
        try {
            acquired = await this.acquireBootloader(this.abortController.signal);
            this.transport = acquired.transport;
            this.uploader = acquired.uploader;
            this.boardInfo = acquired.boardInfo;
            this.renderBoardIdentity();

            const compatibility = checkFirmwareCompatibility(this.boardInfo, this.firmware);
            if (!compatibility.compatible) {
                throw new Error(compatibility.reasons.join(' '));
            }

            const confirmed = await this.api.confirmDialog(
                `Erase and flash bootloader board ID ${this.boardInfo.boardId} `
                + `(revision ${this.boardInfo.boardRevision}) with firmware board ID `
                + `${this.firmware.boardId}, ${formatBytes(this.firmware.imageSize)}?`,
            );
            if (!confirmed) {
                try {
                    await this.uploader.reboot({ signal: this.abortController.signal });
                } catch (_error) {
                    // The device may already have rebooted.
                }
                this.setStatus('ArduPilot firmware flash cancelled.');
                return;
            }

            const result = await this.uploader.flash(this.firmware, {
                signal: this.abortController.signal,
                onProgress: event => this.handleProgress(event),
                reboot: true,
            });
            this.setStatus(
                `Firmware verified by CRC and controller rebooted. ${result.bytesProgrammed} bytes programmed.`,
                'valid',
            );
            $('.progress').val(100).addClass('valid').removeClass('invalid');
        } catch (error) {
            if (this.abortController.signal.aborted) {
                this.setStatus(
                    'Firmware operation cancelled. The controller remains recoverable in its bootloader; restart the flash to complete programming.',
                    'invalid',
                );
            } else {
                throw error;
            }
        } finally {
            await this.closeTransport();
            this.abortController = null;
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
        if (!this.boardInfo) {
            element.text(
                'Controller not identified. Select a serial port, then identify the controller. '
                + 'Flight Commander will not infer a board model from its name or heartbeat.',
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
            .toggleClass('disabled', !busy)
            .toggleClass('is-hidden', !busy);
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
    selectedPortPath,
};
