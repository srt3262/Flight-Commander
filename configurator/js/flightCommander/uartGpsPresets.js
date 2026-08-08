'use strict';

export const UART_RTK_ROVER_PRESET_ID = 'f9-rtk-rover';

export const UART_GPS_PRESETS = Object.freeze({
    m8: Object.freeze({
        name: 'u-blox M8',
        protocol: 'UBLOX',
        galileo: true,
        glonass: true,
        beidou: true,
        rate: 8,
        description: Object.freeze([
            '4 GNSS constellations for maximum accuracy',
            '8 Hz update rate (conservative for M8)',
            'Best for: Navigation, position hold, and slower aircraft',
        ]),
    }),
    'm9-precision': Object.freeze({
        name: 'u-blox M9 (Precision Mode)',
        protocol: 'UBLOX',
        galileo: true,
        glonass: false,
        beidou: true,
        rate: 5,
        description: Object.freeze([
            '3 GNSS constellations (GPS + Galileo + BeiDou)',
            '5 Hz update rate for stable precision',
            'Best for: Long-range cruise, position hold, and navigation missions',
        ]),
    }),
    'm9-sport': Object.freeze({
        name: 'u-blox M9 (Sport Mode)',
        protocol: 'UBLOX',
        galileo: true,
        glonass: false,
        beidou: true,
        rate: 10,
        description: Object.freeze([
            '3 GNSS constellations (GPS + Galileo + BeiDou)',
            '10 Hz update rate for faster response',
            'Best for: Fast flying, racing, and acrobatics',
        ]),
    }),
    m10: Object.freeze({
        name: 'u-blox M10',
        protocol: 'UBLOX',
        galileo: true,
        glonass: false,
        beidou: true,
        rate: 8,
        description: Object.freeze([
            '3 GNSS constellations (GPS + Galileo + BeiDou)',
            '8 Hz update rate (safe for the default M10 CPU clock)',
            'Best for: General use and balanced performance',
        ]),
    }),
    'm10-highperf': Object.freeze({
        name: 'u-blox M10 (High-Performance)',
        protocol: 'UBLOX',
        galileo: true,
        glonass: true,
        beidou: true,
        rate: 10,
        description: Object.freeze([
            '4 GNSS constellations for maximum satellites',
            '10 Hz update rate (requires a high-performance CPU clock)',
            'Use only when the M10 high-performance clock is confirmed',
        ]),
    }),
    [UART_RTK_ROVER_PRESET_ID]: Object.freeze({
        name: 'u-blox F9P / F9-series (RTK Rover)',
        protocol: 'UBLOX',
        baud: '115200',
        galileo: true,
        glonass: true,
        beidou: true,
        rate: 8,
        rtkRover: true,
        description: Object.freeze([
            'Aircraft-side multi-band RTK rover; this is not the ground base receiver',
            'UBLOX protocol, 115200 baud, all four major constellations, and 8 Hz navigation',
            'Receives RTCM3 corrections from Ground Control by direct NTRIP or a surveyed base',
        ]),
    }),
    manual: Object.freeze({
        name: 'Manual Settings',
        description: Object.freeze([
            'Full control over constellation selection and update rate',
            'For advanced users and special requirements',
        ]),
    }),
});

export function detectUartGpsPreset(hwVersion) {
    switch (Number(hwVersion)) {
        case 0x48: return 'm8';
        case 0x49: return 'm9-precision';
        case 0x4A: return 'm10';
        default: return 'manual';
    }
}

export function uartRtkRoverNextAction({ portIdentifier, supportsRtkUart }) {
    if (String(portIdentifier) === '-1' || portIdentifier == null) {
        return 'Choose the UART wired to the aircraft RTK rover above, then select Save and Reboot.';
    }
    if (!supportsRtkUart) {
        return 'Save and Reboot to use this as a standard u-blox GPS. Flight Commander Firmware is required to forward RTCM corrections to it.';
    }
    return 'Select Save and Reboot, then open Ground Control and choose Direct NTRIP, Surveyed Base, or NTRIP-Refined Base under RTK correction setup.';
}
