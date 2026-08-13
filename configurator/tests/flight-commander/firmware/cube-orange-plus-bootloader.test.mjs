import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
    rebootFlightCommanderToVendorBootloader,
    rebootMavlinkAutopilotToBootloader,
} from '../../../js/connection/flightCommanderBootloaderEntry.js';
import {
    CUBE_ORANGE_PLUS_BOOTLOADER,
    parsedHexToCubeOrangePlusFirmware,
} from '../../../js/flightCommander/cubeOrangePlusFlasher.js';
import {
    PX4_BOOTLOADER,
    Px4BootloaderUploader,
} from '../../../js/protocols/px4bootloader.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function uint32LittleEndian(value) {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value, true);
    return bytes;
}

function cubeVectorBytes() {
    return Uint8Array.from([
        0x00, 0x00, 0x02, 0x20,
        0x31, 0xac, 0x0c, 0x08,
    ]);
}

function mspV1Response(command, payload = []) {
    const data = Uint8Array.from(payload);
    let checksum = data.byteLength ^ command;
    for (const value of data) checksum ^= value;
    return Uint8Array.from([
        0x24, 0x4d, 0x3e, data.byteLength, command,
        ...data,
        checksum,
    ]);
}

test('Cube Orange+ HEX conversion preserves the protected 128 KiB bootloader boundary', () => {
    const firmware = parsedHexToCubeOrangePlusFirmware({
        start_linear_address: CUBE_ORANGE_PLUS_BOOTLOADER.applicationAddress,
        data: [
            {
                address: CUBE_ORANGE_PLUS_BOOTLOADER.applicationAddress,
                data: [...cubeVectorBytes(), 1, 2],
            },
            {
                address: CUBE_ORANGE_PLUS_BOOTLOADER.applicationAddress + 12,
                data: [3, 4],
            },
        ],
    });

    assert.equal(firmware.boardId, 1063);
    assert.equal(firmware.imageSize, 14);
    assert.deepEqual([...firmware.image.slice(8)], [1, 2, 0xff, 0xff, 3, 4]);
});

test('Cube Orange+ HEX conversion rejects bootloader writes and the wrong application entry point', () => {
    assert.throws(
        () => parsedHexToCubeOrangePlusFirmware({
            data: [{
                address: 0x08000000,
                data: [...cubeVectorBytes()],
            }],
        }),
        /vendor bootloader stays protected/,
    );

    assert.throws(
        () => parsedHexToCubeOrangePlusFirmware({
            start_linear_address: 0x08040000,
            data: [{
                address: CUBE_ORANGE_PLUS_BOOTLOADER.applicationAddress,
                data: [...cubeVectorBytes()],
            }],
        }),
        /entry point/,
    );
});

test('PX4 bootloader identification reads and exposes the authoritative Cube board ID', async () => {
    const reads = [
        Uint8Array.from([PX4_BOOTLOADER.INSYNC, PX4_BOOTLOADER.response.OK]),
        uint32LittleEndian(5),
        Uint8Array.from([PX4_BOOTLOADER.INSYNC, PX4_BOOTLOADER.response.OK]),
        uint32LittleEndian(1063),
        Uint8Array.from([PX4_BOOTLOADER.INSYNC, PX4_BOOTLOADER.response.OK]),
        uint32LittleEndian(0),
        Uint8Array.from([PX4_BOOTLOADER.INSYNC, PX4_BOOTLOADER.response.OK]),
        uint32LittleEndian(0x001e0000),
        Uint8Array.from([PX4_BOOTLOADER.INSYNC, PX4_BOOTLOADER.response.OK]),
    ];
    const writes = [];
    const transport = {
        flushInput() {},
        async write(value) {
            writes.push([...value]);
            return value.byteLength;
        },
        async readExactly(length) {
            const value = reads.shift();
            assert.equal(value.byteLength, length);
            return value;
        },
    };

    const uploader = new Px4BootloaderUploader(transport, { maxRetries: 0 });
    assert.deepEqual(await uploader.identify(), {
        bootloaderRevision: 5,
        boardId: 1063,
        boardRevision: 0,
        flashSize: 0x001e0000,
    });
    assert.deepEqual(writes[0], [PX4_BOOTLOADER.command.GET_SYNC, PX4_BOOTLOADER.EOC]);
});

test('PX4 uploader refuses a non-Cube board ID before issuing application erase', async () => {
    const reads = [
        Uint8Array.from([PX4_BOOTLOADER.INSYNC, PX4_BOOTLOADER.response.OK]),
        uint32LittleEndian(5),
        Uint8Array.from([PX4_BOOTLOADER.INSYNC, PX4_BOOTLOADER.response.OK]),
        uint32LittleEndian(9),
        Uint8Array.from([PX4_BOOTLOADER.INSYNC, PX4_BOOTLOADER.response.OK]),
        uint32LittleEndian(0),
        Uint8Array.from([PX4_BOOTLOADER.INSYNC, PX4_BOOTLOADER.response.OK]),
        uint32LittleEndian(0x001e0000),
        Uint8Array.from([PX4_BOOTLOADER.INSYNC, PX4_BOOTLOADER.response.OK]),
    ];
    const writes = [];
    const transport = {
        flushInput() {},
        async write(value) {
            writes.push([...value]);
            return value.byteLength;
        },
        async readExactly(length) {
            const value = reads.shift();
            assert.equal(value.byteLength, length);
            return value;
        },
    };
    const uploader = new Px4BootloaderUploader(transport, { maxRetries: 0 });

    await assert.rejects(
        uploader.flash({
            boardId: 1063,
            image: Uint8Array.from([1, 2, 3, 4]),
        }, { reboot: false }),
        /does not match controller board ID 9/,
    );
    assert.equal(
        writes.some((value) => value[0] === PX4_BOOTLOADER.command.CHIP_ERASE),
        false,
    );
});

test('MAVLink handoff sends reboot command 246 with bootloader selector 3', async () => {
    let mavlinkMessage;
    let encodedRequest;
    const api = {
        mavlinkReset() {},
        onSerialData(callback) {
            this.serialData = callback;
            return callback;
        },
        offSerialData() {},
        mavlinkFeed() {
            queueMicrotask(() => mavlinkMessage({
                messageName: 'HEARTBEAT',
                protocol: 'MAVLinkV2',
                header: { sysid: 42, compid: 1 },
                data: { type: 2, autopilot: 3 },
            }));
        },
        onMavlinkMessage(callback) {
            mavlinkMessage = callback;
            return callback;
        },
        offMavlinkMessage() {},
        async serialConnect() {
            queueMicrotask(() => this.serialData({
                connectionId: 1,
                data: Uint8Array.from([1, 2]),
            }));
            return { id: 1 };
        },
        async mavlinkEncode(name, data, options) {
            encodedRequest = { name, data, options };
            return Uint8Array.from([1, 2, 3]);
        },
        async serialSend(value) {
            return { bytesWritten: value.byteLength };
        },
        async serialClose() {},
    };

    await rebootMavlinkAutopilotToBootloader('COM4', { api });
    assert.equal(encodedRequest.name, 'CommandLong');
    assert.equal(encodedRequest.data.command, 246);
    assert.equal(encodedRequest.data.param1, 3);
    assert.equal(encodedRequest.data.targetSystem, 42);
});

test('running Flight Commander updates use an MSP normal reset before reacquiring the Cube bootloader', async () => {
    const target = [...Buffer.from('CUBEORANGEPLUS', 'ascii')];
    const replies = new Map([
        [1, [1, 46, 0]],
        [2, [...Buffer.from('INAV', 'ascii')]],
        [3, [4, 2, 0]],
        [4, [
            ...Buffer.from('CUBE', 'ascii'),
            0, 0,
            0, 0,
            target.length,
            ...target,
        ]],
        [68, []],
    ]);
    const writes = [];
    const transport = {
        pending: new Uint8Array(0),
        async open(path, baudRate) {
            assert.equal(path, 'COM7');
            assert.equal(baudRate, 115200);
        },
        flushInput() {
            this.pending = new Uint8Array(0);
        },
        async write(value) {
            writes.push([...value]);
            const command = value[4];
            assert.ok(replies.has(command), `unexpected MSP command ${command}`);
            this.pending = mspV1Response(command, replies.get(command));
            return value.byteLength;
        },
        async readExactly(length) {
            assert.ok(this.pending.byteLength >= length);
            const value = this.pending.slice(0, length);
            this.pending = this.pending.slice(length);
            return value;
        },
        async close() {},
    };

    const identity = await rebootFlightCommanderToVendorBootloader('COM7', {
        api: {},
        transportFactory: () => transport,
    });

    assert.equal(identity.target, 'CUBEORANGEPLUS');
    assert.equal(identity.acknowledged, true);
    assert.deepEqual(writes.at(-1), [0x24, 0x4d, 0x3c, 0, 68, 68]);
});

test('Firmware Flasher routes Cube Orange+ serial installs through its vendor bootloader and explains disabled clicks', () => {
    const source = readFileSync(resolve(root, 'tabs/firmware_flasher.js'), 'utf8');
    assert.match(source, /flashCubeOrangePlusViaVendorBootloader/);
    assert.match(source, /cubeOrangePlusImageIsActive\(\) && selectedPort !== 'DFU'/);
    assert.match(source, /Firmware is not loaded\. Select a target and click Load Firmware \[Online\]/);
    assert.match(source, /Select the Cube Orange\+ USB serial port before flashing/);
});
