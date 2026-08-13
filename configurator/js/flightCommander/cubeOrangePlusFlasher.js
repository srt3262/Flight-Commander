'use strict';

import ElectronSerialByteTransport from '../connection/electronSerialByteTransport.js';
import {
    rebootFlightCommanderToVendorBootloader,
    rebootMavlinkAutopilotToBootloader,
} from '../connection/flightCommanderBootloaderEntry.js';
import Px4BootloaderUploader from '../protocols/px4bootloader.js';

export const CUBE_ORANGE_PLUS_BOOTLOADER = Object.freeze({
    target: 'CUBEORANGEPLUS',
    boardId: 1063,
    applicationAddress: 0x08020000,
    flashEndAddress: 0x08200000,
    baudRate: 115200,
    waitMs: 20000,
    pollMs: 200,
});

function delay(milliseconds, signal) {
    return new Promise((resolve, reject) => {
        let timer;
        const onAbort = () => {
            clearTimeout(timer);
            reject(signal?.reason instanceof Error ? signal.reason : new Error('Firmware operation cancelled.'));
        };
        timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, milliseconds);
        if (signal?.aborted) {
            onAbort();
            return;
        }
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

function readUint32LittleEndian(bytes, offset) {
    return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
}

export function parsedHexToCubeOrangePlusFirmware(parsedHex) {
    const contract = CUBE_ORANGE_PLUS_BOOTLOADER;
    if (!Array.isArray(parsedHex?.data) || parsedHex.data.length === 0) {
        throw new Error('The selected Cube Orange+ HEX contains no programmable data.');
    }

    const blocks = parsedHex.data
        .map((block) => ({
            address: Number(block?.address),
            data: Uint8Array.from(block?.data ?? []),
        }))
        .filter((block) => block.data.byteLength > 0)
        .sort((left, right) => left.address - right.address);
    if (blocks.length === 0) {
        throw new Error('The selected Cube Orange+ HEX contains no programmable data.');
    }

    let imageEnd = contract.applicationAddress;
    for (const block of blocks) {
        const blockEnd = block.address + block.data.byteLength;
        if (!Number.isSafeInteger(block.address) || !Number.isSafeInteger(blockEnd)) {
            throw new Error('The selected HEX contains an invalid address.');
        }
        if (block.address < contract.applicationAddress || blockEnd > contract.flashEndAddress) {
            throw new Error(
                `Cube Orange+ application data must remain within 0x${contract.applicationAddress.toString(16)}-` +
                `0x${(contract.flashEndAddress - 1).toString(16)} so the vendor bootloader stays protected.`,
            );
        }
        imageEnd = Math.max(imageEnd, blockEnd);
    }

    if (blocks[0].address !== contract.applicationAddress) {
        throw new Error(
            `Cube Orange+ firmware must begin at 0x${contract.applicationAddress.toString(16)}.`,
        );
    }
    if (
        parsedHex.start_linear_address &&
        parsedHex.start_linear_address !== contract.applicationAddress
    ) {
        throw new Error('The Cube Orange+ HEX entry point does not match its protected application address.');
    }

    const image = new Uint8Array(imageEnd - contract.applicationAddress);
    image.fill(0xff);
    const written = new Uint8Array(image.byteLength);
    for (const block of blocks) {
        const offset = block.address - contract.applicationAddress;
        for (let index = 0; index < block.data.byteLength; index += 1) {
            const destination = offset + index;
            if (written[destination] && image[destination] !== block.data[index]) {
                throw new Error('The selected HEX contains conflicting overlapping data records.');
            }
            image[destination] = block.data[index];
            written[destination] = 1;
        }
    }

    if (image.byteLength < 8) {
        throw new Error('The Cube Orange+ firmware vector table is incomplete.');
    }
    const initialStackPointer = readUint32LittleEndian(image, 0);
    const resetVector = readUint32LittleEndian(image, 4);
    if (initialStackPointer < 0x20000000 || initialStackPointer >= 0x40000000) {
        throw new Error('The Cube Orange+ firmware has an invalid initial stack pointer.');
    }
    const resetAddress = resetVector & ~1;
    if (
        (resetVector & 1) !== 1 ||
        resetAddress < contract.applicationAddress ||
        resetAddress >= contract.flashEndAddress
    ) {
        throw new Error('The Cube Orange+ firmware has an invalid reset vector.');
    }

    return Object.freeze({
        boardId: contract.boardId,
        boardRevision: 0,
        boardRevisionMin: null,
        boardRevisionMax: null,
        image,
        imageSize: image.byteLength,
        requiresExternalFlash: false,
    });
}

async function tryBootloaderPort(api, path, signal, onProgress) {
    const transport = new ElectronSerialByteTransport(api);
    try {
        await transport.open(path, CUBE_ORANGE_PLUS_BOOTLOADER.baudRate);
        const probe = new Px4BootloaderUploader(transport, {
            timeoutMs: 800,
            eraseTimeoutMs: 30000,
            maxRetries: 0,
            onProgress,
        });
        const boardInfo = await probe.identify({ signal, onProgress });
        const uploader = new Px4BootloaderUploader(transport, {
            timeoutMs: 2500,
            eraseTimeoutMs: 30000,
            maxRetries: 2,
            onProgress,
        });
        uploader.boardInfo = boardInfo;
        return { path, transport, uploader, boardInfo };
    } catch (_error) {
        await transport.close().catch(() => {});
        return null;
    }
}

async function acquireCubeOrangePlusBootloader({
    api,
    path,
    runtimeBaudRate,
    signal,
    onProgress,
    onStatus,
}) {
    const listedBefore = await api.listSerialDeviceInfo();
    const before = Array.isArray(listedBefore) ? listedBefore : [];
    const selectedInfo = before.find((info) => info.path === path) ?? null;

    onStatus?.(`Checking ${path} for the Cube/Pixhawk bootloader…`);
    const direct = await tryBootloaderPort(api, path, signal, onProgress);
    if (direct) return direct;

    let automaticHandoffCompleted = false;
    onStatus?.('Checking for Flight Commander so it can reboot normally through the protected Cube bootloader…');
    try {
        const identity = await rebootFlightCommanderToVendorBootloader(path, {
            api,
            baudRate: runtimeBaudRate,
            signal,
        });
        automaticHandoffCompleted = true;
        onStatus?.(
            `Flight Commander ${identity.firmwareVersion} on ${identity.target} accepted a normal reboot. ` +
            'Waiting for the Cube vendor bootloader…',
        );
    } catch (flightCommanderError) {
        console.warn('Cube Orange+ Flight Commander bootloader handoff did not complete:', flightCommanderError);
        onStatus?.('No compatible Flight Commander runtime responded; checking for ArduPilot over MAVLink…');
        try {
            await rebootMavlinkAutopilotToBootloader(path, {
                api,
                baudRate: runtimeBaudRate,
                heartbeatTimeoutMs: 5000,
                signal,
            });
            automaticHandoffCompleted = true;
            onStatus?.('ArduPilot accepted the bootloader reboot request. Waiting for the Cube vendor bootloader…');
        } catch (mavlinkError) {
            console.warn('Cube Orange+ MAVLink bootloader handoff did not complete:', mavlinkError);
        }
    }

    if (!automaticHandoffCompleted) {
        onStatus?.(
            'Neither Flight Commander nor ArduPilot acknowledged automatic bootloader entry. ' +
            'Unplug and reconnect the Cube USB cable now; ' +
            'Flight Commander will watch for its bootloader for 20 seconds.',
            'action',
        );
    }

    const originalPaths = new Set(before.map((info) => info.path));
    const lastAttempt = new Map();
    const deadline = Date.now() + CUBE_ORANGE_PLUS_BOOTLOADER.waitMs;
    while (Date.now() < deadline) {
        if (signal?.aborted) {
            throw signal.reason instanceof Error ? signal.reason : new Error('Firmware operation cancelled.');
        }
        const listedCurrent = await api.listSerialDeviceInfo();
        const current = Array.isArray(listedCurrent) ? listedCurrent : [];
        const candidates = current
            .filter((info) => (
                info.path === path ||
                (selectedInfo?.serialNumber && info.serialNumber === selectedInfo.serialNumber) ||
                !originalPaths.has(info.path)
            ))
            .sort((left, right) => {
                if (left.path === path) return -1;
                if (right.path === path) return 1;
                return left.path.localeCompare(right.path);
            });

        for (const candidate of candidates) {
            if (Date.now() - (lastAttempt.get(candidate.path) ?? 0) < 500) continue;
            lastAttempt.set(candidate.path, Date.now());
            const acquired = await tryBootloaderPort(api, candidate.path, signal, onProgress);
            if (acquired) return acquired;
        }
        await delay(CUBE_ORANGE_PLUS_BOOTLOADER.pollMs, signal);
    }

    throw new Error(
        'The Cube/Pixhawk bootloader did not appear. Close Mission Planner and every other serial program, ' +
        'then retry and unplug/reconnect the Cube when prompted.',
    );
}

export async function flashCubeOrangePlusViaVendorBootloader({
    api = globalThis.window?.electronAPI,
    path,
    runtimeBaudRate = CUBE_ORANGE_PLUS_BOOTLOADER.baudRate,
    parsedHex,
    signal = null,
    onProgress = null,
    onStatus = null,
}) {
    if (!api) throw new Error('The Cube Orange+ bootloader bridge is unavailable.');
    if (!path || path === '0' || path === 'DFU') {
        throw new Error('Select the Cube Orange+ serial port before flashing.');
    }

    const firmware = parsedHexToCubeOrangePlusFirmware(parsedHex);
    const acquired = await acquireCubeOrangePlusBootloader({
        api,
        path,
        runtimeBaudRate,
        signal,
        onProgress,
        onStatus,
    });

    try {
        if (acquired.boardInfo.boardId !== CUBE_ORANGE_PLUS_BOOTLOADER.boardId) {
            throw new Error(
                `Refusing to flash: the bootloader reported board ID ${acquired.boardInfo.boardId}; ` +
                `Cube Orange+ requires ${CUBE_ORANGE_PLUS_BOOTLOADER.boardId}.`,
            );
        }
        onStatus?.(
            `Cube Orange+ bootloader identified (board ID ${acquired.boardInfo.boardId}). ` +
            'Erasing only its application area; the vendor bootloader remains protected.',
        );
        const result = await acquired.uploader.flash(firmware, {
            signal,
            onProgress,
            reboot: true,
        });
        return Object.freeze({ ...result, port: acquired.path });
    } finally {
        await acquired.transport.close().catch(() => {});
    }
}
