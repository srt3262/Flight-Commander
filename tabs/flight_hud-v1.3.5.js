import {
    DEFAULT_GROUND_CONTROL_UNIT_SYSTEM,
    getGroundControlUnitProfile,
    groundControlUnitLabel,
    normalizeGroundControlUnitSystem,
    toGroundControlDisplayState,
} from './../js/gcs/groundControlUnits.js';

const STORAGE_KEY = 'flightCommanderGroundControlPrimaryView';
const PRIMARY_VIEWS = new Set(['map', 'hud']);
const DEG_TO_RAD = Math.PI / 180;

export const HUD_GROUND_COLORS = Object.freeze({
    horizon: '#31523b',
    depth: '#172a20',
});

function finite(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}

function wrapHeading(value) {
    const heading = finite(value);
    return heading === null ? null : ((heading % 360) + 360) % 360;
}

function format(value, decimals = 0, suffix = '') {
    return Number.isFinite(value) ? `${value.toFixed(decimals)}${suffix}` : '--';
}

function headingLabel(value) {
    const heading = ((Math.round(value) % 360) + 360) % 360;
    if (heading === 0) return 'N';
    if (heading === 90) return 'E';
    if (heading === 180) return 'S';
    if (heading === 270) return 'W';
    return String(heading).padStart(3, '0');
}

function gpsFixLabel(value) {
    if (value >= 8) return 'PPP';
    if (value === 7) return 'STATIC';
    if (value === 6) return 'RTK';
    if (value === 5) return 'RTK F';
    if (value === 4) return 'DGPS';
    if (value === 3) return '3D';
    if (value === 2) return '2D';
    if (value === 1) return 'NO FIX';
    return 'NO GPS';
}

function roundedPath(context, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + r, y);
    context.lineTo(x + width - r, y);
    context.arcTo(x + width, y, x + width, y + r, r);
    context.lineTo(x + width, y + height - r);
    context.arcTo(x + width, y + height, x + width - r, y + height, r);
    context.lineTo(x + r, y + height);
    context.arcTo(x, y + height, x, y + height - r, r);
    context.lineTo(x, y + r);
    context.arcTo(x, y, x + r, y, r);
    context.closePath();
}

function fillPanel(context, x, y, width, height, color, stroke = null, radius = 3) {
    roundedPath(context, x, y, width, height, radius);
    context.fillStyle = color;
    context.fill();
    if (stroke) {
        context.strokeStyle = stroke;
        context.lineWidth = 1;
        context.stroke();
    }
}

export function normalizeHudState(state = {}) {
    const roll = finite(state.roll);
    const pitch = finite(state.pitch);
    const batteryRemaining = finite(state.batteryRemaining);
    const gpsFix = finite(state.gpsFix);
    const satellites = finite(state.satellites);
    return {
        connected: Boolean(state.connected),
        linkLost: Boolean(state.linkLost) || !state.connected,
        armed: Boolean(state.armed),
        modeName: String(state.modeName || '--'),
        roll: roll === null ? null : clamp(roll, -180, 180),
        pitch: pitch === null ? null : clamp(pitch, -90, 90),
        heading: wrapHeading(state.heading),
        groundSpeed: finite(state.groundSpeed),
        airSpeed: finite(state.airSpeed),
        relativeAltitude: finite(state.relativeAltitude),
        climbRate: finite(state.climbRate),
        voltage: finite(state.voltage),
        current: finite(state.current),
        batteryRemaining: batteryRemaining === null || batteryRemaining < 0
            ? null
            : clamp(batteryRemaining, 0, 100),
        gpsFix: gpsFix === null ? 0 : gpsFix,
        satellites: satellites === null || satellites === 255
            ? null
            : Math.max(0, Math.trunc(satellites)),
    };
}

export function hudAttitudeTransform(state, height) {
    const normalized = normalizeHudState(state);
    const pixelsPerDegree = clamp(height / 72, 2.2, 6);
    return {
        rollRadians: -(normalized.roll ?? 0) * DEG_TO_RAD,
        horizonOffset: (normalized.pitch ?? 0) * pixelsPerDegree,
        pixelsPerDegree,
    };
}

export function buildHudAnnouncement(
    state,
    unitSystem = DEFAULT_GROUND_CONTROL_UNIT_SYSTEM,
) {
    const value = toGroundControlDisplayState(
        normalizeHudState(state),
        unitSystem,
    );
    const speedUnit = groundControlUnitLabel(
        'groundSpeed',
        unitSystem,
        { spoken: true },
    );
    const altitudeUnit = groundControlUnitLabel(
        'relativeAltitude',
        unitSystem,
        { spoken: true },
    );
    if (!value.connected) return 'Live flight HUD waiting for telemetry';
    const link = value.linkLost ? 'link lost' : 'link active';
    const armed = value.armed ? 'armed' : 'disarmed';
    return [
        `Live flight HUD, ${link}, ${armed}`,
        `mode ${value.modeName}`,
        `roll ${format(value.roll, 0, ' degrees')}`,
        `pitch ${format(value.pitch, 0, ' degrees')}`,
        `heading ${format(value.heading, 0, ' degrees')}`,
        `ground speed ${format(value.groundSpeed, 1, ` ${speedUnit}`)}`,
        `relative altitude ${format(value.relativeAltitude, 1, ` ${altitudeUnit}`)}`,
    ].join(', ');
}

function drawAttitude(context, width, height, state, compact) {
    const centerX = width / 2;
    const centerY = height / 2;
    const { rollRadians, horizonOffset, pixelsPerDegree } = hudAttitudeTransform(state, height);
    const extent = Math.hypot(width, height) * 1.8;

    context.save();
    context.beginPath();
    context.rect(0, 0, width, height);
    context.clip();
    context.translate(centerX, centerY);
    context.rotate(rollRadians);
    context.translate(0, horizonOffset);

    const sky = context.createLinearGradient(0, -extent, 0, 0);
    sky.addColorStop(0, '#075b94');
    sky.addColorStop(1, '#46aee0');
    context.fillStyle = sky;
    context.fillRect(-extent, -extent, extent * 2, extent);

    const ground = context.createLinearGradient(0, 0, 0, extent);
    ground.addColorStop(0, HUD_GROUND_COLORS.horizon);
    ground.addColorStop(1, HUD_GROUND_COLORS.depth);
    context.fillStyle = ground;
    context.fillRect(-extent, 0, extent * 2, extent);

    context.strokeStyle = '#ffffff';
    context.lineWidth = compact ? 1.5 : 2;
    context.beginPath();
    context.moveTo(-extent, 0);
    context.lineTo(extent, 0);
    context.stroke();

    context.font = `${compact ? 9 : 11}px "Segoe UI", sans-serif`;
    context.textBaseline = 'middle';
    context.fillStyle = '#ffffff';
    context.strokeStyle = 'rgba(0, 0, 0, 0.78)';
    context.lineWidth = 3;
    for (let degree = -40; degree <= 40; degree += 5) {
        if (degree === 0) continue;
        const y = -degree * pixelsPerDegree;
        const major = degree % 10 === 0;
        const halfWidth = major
            ? Math.min(width * 0.13, compact ? 34 : 52)
            : Math.min(width * 0.07, compact ? 20 : 30);
        context.beginPath();
        context.moveTo(-halfWidth, y);
        context.lineTo(halfWidth, y);
        context.strokeStyle = 'rgba(0, 0, 0, 0.72)';
        context.lineWidth = compact ? 3 : 4;
        context.stroke();
        context.strokeStyle = '#ffffff';
        context.lineWidth = compact ? 1 : 1.5;
        context.stroke();
        if (major) {
            const label = String(Math.abs(degree));
            context.strokeText(label, -halfWidth - (compact ? 13 : 18), y);
            context.fillText(label, -halfWidth - (compact ? 13 : 18), y);
            context.strokeText(label, halfWidth + (compact ? 5 : 7), y);
            context.fillText(label, halfWidth + (compact ? 5 : 7), y);
        }
    }
    context.restore();

    const wing = compact ? 30 : 43;
    const centerGap = compact ? 8 : 11;
    context.save();
    context.strokeStyle = '#fff200';
    context.lineWidth = compact ? 2.2 : 3;
    context.shadowColor = 'rgba(0, 0, 0, 0.9)';
    context.shadowBlur = 2;
    context.beginPath();
    context.moveTo(centerX - wing, centerY);
    context.lineTo(centerX - centerGap, centerY);
    context.lineTo(centerX - centerGap, centerY + (compact ? 6 : 8));
    context.moveTo(centerX + centerGap, centerY + (compact ? 6 : 8));
    context.lineTo(centerX + centerGap, centerY);
    context.lineTo(centerX + wing, centerY);
    context.stroke();
    context.beginPath();
    context.arc(centerX, centerY, compact ? 2.5 : 3.5, 0, Math.PI * 2);
    context.fillStyle = '#fff200';
    context.fill();
    context.restore();
}

function drawHeadingTape(context, width, state, compact) {
    const height = compact ? 31 : 38;
    const centerX = width / 2;
    const heading = state.heading ?? 0;
    const visibleDegrees = compact ? 70 : 90;
    const pixelsPerDegree = width / visibleDegrees;

    context.fillStyle = 'rgba(2, 12, 18, 0.78)';
    context.fillRect(0, 0, width, height);
    context.save();
    context.beginPath();
    context.rect(0, 0, width, height);
    context.clip();
    context.strokeStyle = '#ffffff';
    context.fillStyle = '#ffffff';
    context.textAlign = 'center';
    context.textBaseline = 'top';
    context.font = `${compact ? 8 : 10}px "Segoe UI", sans-serif`;
    if (state.heading !== null) {
        for (let offset = -60; offset <= 60; offset += 5) {
            const x = centerX + offset * pixelsPerDegree;
            const major = offset % 10 === 0;
            context.beginPath();
            context.moveTo(x, height - (major ? 13 : 8));
            context.lineTo(x, height - 3);
            context.lineWidth = major ? 1.5 : 1;
            context.stroke();
            if (major) {
                context.fillText(headingLabel(heading + offset), x, 3);
            }
        }
    }
    context.restore();

    const boxWidth = compact ? 42 : 52;
    fillPanel(
        context,
        centerX - boxWidth / 2,
        height - (compact ? 17 : 21),
        boxWidth,
        compact ? 17 : 21,
        'rgba(0, 0, 0, 0.88)',
        '#7cff6b',
        2,
    );
    context.fillStyle = '#7cff6b';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = `700 ${compact ? 11 : 14}px "Segoe UI", sans-serif`;
    context.fillText(
        state.heading === null
            ? '---'
            : String(((Math.round(state.heading) % 360) + 360) % 360).padStart(3, '0'),
        centerX,
        height - (compact ? 8.5 : 10.5),
    );
}

function drawVerticalTape(context, options) {
    const {
        x,
        y,
        width,
        height,
        value,
        step,
        decimals,
        label,
        align,
        compact,
    } = options;
    const middle = y + height / 2;
    const displayValue = Number.isFinite(value) ? value : null;
    const workingValue = displayValue ?? 0;
    const pixelsPerUnit = height / (step * 7);
    const base = Math.floor(workingValue / step) * step;

    context.fillStyle = 'rgba(2, 12, 18, 0.68)';
    context.fillRect(x, y, width, height);
    context.strokeStyle = 'rgba(255, 255, 255, 0.82)';
    context.fillStyle = '#ffffff';
    context.font = `${compact ? 8 : 10}px "Segoe UI", sans-serif`;
    context.textBaseline = 'middle';
    if (displayValue !== null) {
        for (let index = -5; index <= 5; index += 1) {
            const tickValue = base + index * step;
            const tickY = middle - (tickValue - workingValue) * pixelsPerUnit;
            if (tickY < y + 10 || tickY > y + height - 7) continue;
            const innerEdge = align === 'left' ? x + width : x;
            const direction = align === 'left' ? -1 : 1;
            context.beginPath();
            context.moveTo(innerEdge, tickY);
            context.lineTo(innerEdge + direction * (compact ? 7 : 10), tickY);
            context.stroke();
            context.textAlign = align === 'left' ? 'right' : 'left';
            const textX = align === 'left' ? x + width - 12 : x + 12;
            context.fillText(String(Math.round(tickValue)), textX, tickY);
        }
    }

    const boxHeight = compact ? 24 : 30;
    fillPanel(
        context,
        x + (align === 'left' ? 2 : 0),
        middle - boxHeight / 2,
        width - 2,
        boxHeight,
        'rgba(0, 0, 0, 0.9)',
        '#ffffff',
        2,
    );
    context.fillStyle = '#ffffff';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = `700 ${compact ? 12 : 15}px "Segoe UI", sans-serif`;
    context.fillText(
        displayValue === null ? '--' : displayValue.toFixed(decimals),
        x + width / 2,
        middle,
    );
    context.fillStyle = '#dce9ef';
    context.font = `700 ${compact ? 8 : 9}px "Segoe UI", sans-serif`;
    context.fillText(label, x + width / 2, y + (compact ? 7 : 9));
}

function drawStatus(context, width, height, state, compact, unitProfile) {
    const barHeight = compact ? 29 : 35;
    const y = height - barHeight;
    context.fillStyle = 'rgba(2, 12, 18, 0.84)';
    context.fillRect(0, y, width, barHeight);
    context.textBaseline = 'middle';

    const mode = state.modeName.length > (compact ? 7 : 14)
        ? `${state.modeName.slice(0, compact ? 6 : 13)}…`
        : state.modeName;
    const modePanelX = compact ? 3 : 6;
    const modePanelWidth = compact ? 82 : 120;
    fillPanel(
        context,
        modePanelX,
        y + (compact ? 4 : 5),
        modePanelWidth,
        compact ? 21 : 25,
        state.armed ? '#a82727' : '#1d6d3c',
        state.armed ? '#ff8c8c' : '#7cff9c',
        3,
    );
    context.fillStyle = '#ffffff';
    context.textAlign = 'center';
    context.font = `700 ${compact ? 9 : 11}px "Segoe UI", sans-serif`;
    context.fillText(
        `${state.armed ? 'ARMED' : 'SAFE'} · ${mode}`,
        modePanelX + modePanelWidth / 2,
        y + barHeight / 2,
    );

    context.textAlign = 'center';
    context.font = `${compact ? 8 : 10}px "Segoe UI", sans-serif`;
    context.fillStyle = state.gpsFix >= 3 ? '#7cff6b' : '#ffd166';
    const gps = `GPS ${gpsFixLabel(state.gpsFix)} · ${state.satellites ?? '--'}`;
    context.fillText(gps, width * (compact ? 0.4 : 0.36), y + barHeight / 2);

    context.fillStyle = '#ffffff';
    const battery = state.batteryRemaining === null
        ? format(state.voltage, 1, 'V')
        : `${format(state.voltage, 1, 'V')} · ${format(state.batteryRemaining, 0, '%')}`;
    context.fillText(`BAT ${battery}`, width * (compact ? 0.66 : 0.58), y + barHeight / 2);

    if (!compact) {
        context.fillStyle = '#ffffff';
        context.fillText(
            `VS ${format(state.climbRate, 1)} ${unitProfile.verticalSpeed.symbol}`,
            width * 0.76,
            y + barHeight / 2,
        );
    }

    context.fillStyle = state.linkLost ? '#ff6b6b' : '#7cff6b';
    context.textAlign = 'right';
    context.font = `700 ${compact ? 8 : 10}px "Segoe UI", sans-serif`;
    context.fillText(state.linkLost ? 'LINK LOST' : 'LINK', width - (compact ? 5 : 8), y + barHeight / 2);
}

export function drawGroundControlHud(
    canvas,
    telemetryState,
    unitSystem = DEFAULT_GROUND_CONTROL_UNIT_SYSTEM,
) {
    if (!canvas || typeof canvas.getContext !== 'function') return false;
    const context = canvas.getContext('2d');
    if (!context) return false;
    const rect = canvas.getBoundingClientRect();
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);
    if (width < 40 || height < 40) return false;

    const pixelRatio = clamp(
        finite(globalThis.devicePixelRatio) ?? 1,
        1,
        2,
    );
    const targetWidth = Math.max(1, Math.round(width * pixelRatio));
    const targetHeight = Math.max(1, Math.round(height * pixelRatio));
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth;
        canvas.height = targetHeight;
    }
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, width, height);

    const normalizedUnitSystem = normalizeGroundControlUnitSystem(unitSystem);
    const unitProfile = getGroundControlUnitProfile(normalizedUnitSystem);
    const state = toGroundControlDisplayState(
        normalizeHudState(telemetryState),
        normalizedUnitSystem,
    );
    const compact = width < 500 || height < 300;
    const attitudeAvailable = Number.isFinite(state.roll) && Number.isFinite(state.pitch);
    if (attitudeAvailable) {
        drawAttitude(context, width, height, state, compact);
    } else {
        const unavailableBackground = context.createLinearGradient(0, 0, 0, height);
        unavailableBackground.addColorStop(0, '#102b3b');
        unavailableBackground.addColorStop(1, '#07131b');
        context.fillStyle = unavailableBackground;
        context.fillRect(0, 0, width, height);
    }
    drawHeadingTape(context, width, state, compact);

    const tapeTop = compact ? 36 : 45;
    const tapeBottom = height - (compact ? 34 : 41);
    const tapeHeight = Math.max(80, tapeBottom - tapeTop);
    const tapeWidth = compact ? 50 : 66;
    drawVerticalTape(context, {
        x: 0,
        y: tapeTop,
        width: tapeWidth,
        height: tapeHeight,
        value: state.groundSpeed,
        step: compact
            ? unitProfile.hudTapeSteps.groundSpeed.compact
            : unitProfile.hudTapeSteps.groundSpeed.regular,
        decimals: 1,
        label: `GS ${unitProfile.horizontalSpeed.symbol}`,
        align: 'left',
        compact,
    });
    drawVerticalTape(context, {
        x: width - tapeWidth,
        y: tapeTop,
        width: tapeWidth,
        height: tapeHeight,
        value: state.relativeAltitude,
        step: compact
            ? unitProfile.hudTapeSteps.relativeAltitude.compact
            : unitProfile.hudTapeSteps.relativeAltitude.regular,
        decimals: 1,
        label: compact
            ? `REL ${unitProfile.altitude.symbol}`
            : `REL ALT ${unitProfile.altitude.symbol}`,
        align: 'right',
        compact,
    });


    drawStatus(context, width, height, state, compact, unitProfile);

    if (!state.connected || state.linkLost || !attitudeAvailable) {
        const message = !state.connected
            ? 'WAITING FOR TELEMETRY'
            : state.linkLost
                ? 'TELEMETRY LINK LOST'
                : 'ATTITUDE DATA UNAVAILABLE';
        const panelWidth = Math.min(width - 36, compact ? 180 : 245);
        const panelHeight = compact ? 28 : 36;
        fillPanel(
            context,
            (width - panelWidth) / 2,
            height * 0.23,
            panelWidth,
            panelHeight,
            state.linkLost ? 'rgba(142, 20, 20, 0.9)' : 'rgba(2, 12, 18, 0.88)',
            state.linkLost ? '#ff9090' : '#b9d1df',
            4,
        );
        context.fillStyle = state.linkLost ? '#ffffff' : '#dce9ef';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.font = `700 ${compact ? 10 : 13}px "Segoe UI", sans-serif`;
        context.fillText(message, width / 2, height * 0.23 + panelHeight / 2);
    }

    return true;
}

function readPrimaryView(storage) {
    try {
        const value = storage?.getItem(STORAGE_KEY);
        return PRIMARY_VIEWS.has(value) ? value : 'map';
    } catch {
        return 'map';
    }
}

function writePrimaryView(storage, value) {
    try {
        storage?.setItem(STORAGE_KEY, value);
    } catch {
        // A denied storage write should not prevent the operator from changing views.
    }
}

export function normalizeMinorViewPosition(value) {
    // Retained as a compatibility export for extensions built against 2.0.1.
    // Ground Control 2.0.2 no longer uses a movable overlay.
    void value;
    return null;
}

export function createGroundControlHud({
    getState,
    onLayoutChange,
    storage,
    unitSystem = DEFAULT_GROUND_CONTROL_UNIT_SYSTEM,
} = {}) {
    const workspace = document.getElementById('flightDataWorkspace');
    const visuals = document.getElementById('flightDataVisuals');
    const surface = document.getElementById('flightDataHud');
    const mapSurface = document.getElementById('flightDataMapSurface');
    const mapPane = document.getElementById('flightDataMapPane');
    const hudPane = document.getElementById('flightDataHudPane');
    const mapRole = document.getElementById('flightDataMapRole');
    const hudRole = document.getElementById('flightDataHudRole');
    const canvas = document.getElementById('flightDataHudCanvas');
    const button = document.getElementById('flightDataPrimaryView');
    if (
        !workspace || !visuals || !surface || !mapSurface || !canvas || !button
        || !mapPane || !hudPane || !mapRole || !hudRole
    ) {
        throw new Error('Ground Control HUD elements are unavailable.');
    }

    let preferenceStorage = storage;
    if (!preferenceStorage) {
        try {
            preferenceStorage = globalThis.localStorage;
        } catch {
            preferenceStorage = null;
        }
    }
    let destroyed = false;
    let lastState = normalizeHudState(typeof getState === 'function' ? getState() : {});
    let lastLiveState = lastState.connected && !lastState.linkLost ? lastState : null;
    let primaryView = readPrimaryView(preferenceStorage);
    let displayUnitSystem = normalizeGroundControlUnitSystem(unitSystem);
    const timeouts = new Set();
    let animationFrame = null;

    const updateSizes = () => {
        if (destroyed) return;
        drawGroundControlHud(canvas, lastState, displayUnitSystem);
        if (typeof onLayoutChange === 'function') onLayoutChange(primaryView);
    };

    const scheduleSizeUpdate = () => {
        if (animationFrame !== null) cancelAnimationFrame(animationFrame);
        animationFrame = requestAnimationFrame(() => {
            animationFrame = null;
            updateSizes();
        });
        const timeout = setTimeout(() => {
            timeouts.delete(timeout);
            updateSizes();
        }, 260);
        timeouts.add(timeout);
    };

    const applyPrimaryView = (value, persist = true) => {
        primaryView = PRIMARY_VIEWS.has(value) ? value : 'map';
        visuals.dataset.primary = primaryView;
        const hudPrimary = primaryView === 'hud';
        mapPane.dataset.role = hudPrimary ? 'minor' : 'major';
        hudPane.dataset.role = hudPrimary ? 'major' : 'minor';
        mapRole.textContent = hudPrimary ? 'Minor view' : 'Major view';
        hudRole.textContent = hudPrimary ? 'Major view' : 'Minor view';
        mapPane.setAttribute('aria-label', `${hudPrimary ? 'Minor' : 'Major'} live map view`);
        hudPane.setAttribute('aria-label', `${hudPrimary ? 'Major' : 'Minor'} live flight HUD view`);
        button.setAttribute('aria-pressed', String(hudPrimary));
        button.textContent = hudPrimary ? 'Make map major' : 'Make HUD major';
        button.title = hudPrimary
            ? 'Make the live map the larger view'
            : 'Make the live HUD the larger view';
        if (persist) writePrimaryView(preferenceStorage, primaryView);
        scheduleSizeUpdate();
    };

    const togglePrimaryView = () => {
        applyPrimaryView(primaryView === 'map' ? 'hud' : 'map');
    };

    const render = (state) => {
        const nextState = normalizeHudState(state);
        if (nextState.connected && !nextState.linkLost) {
            lastLiveState = nextState;
            lastState = nextState;
        } else if (lastLiveState) {
            lastState = {
                ...lastLiveState,
                connected: true,
                linkLost: true,
            };
        } else {
            lastState = nextState;
        }
        surface.setAttribute(
            'aria-label',
            buildHudAnnouncement(lastState, displayUnitSystem),
        );
        drawGroundControlHud(canvas, lastState, displayUnitSystem);
    };

    button.addEventListener('click', togglePrimaryView);
    let resizeObserver = null;
    const resizeHandler = () => scheduleSizeUpdate();
    if (typeof ResizeObserver === 'function') {
        resizeObserver = new ResizeObserver(resizeHandler);
        resizeObserver.observe(workspace);
        resizeObserver.observe(visuals);
        resizeObserver.observe(surface);
        resizeObserver.observe(mapSurface);
        resizeObserver.observe(mapPane);
        resizeObserver.observe(hudPane);
    } else {
        globalThis.addEventListener?.('resize', resizeHandler);
    }

    applyPrimaryView(primaryView, false);
    render(lastState);

    return {
        render,
        primaryView: () => primaryView,
        setPrimaryView: (value) => applyPrimaryView(value),
        unitSystem: () => displayUnitSystem,
        setUnitSystem(value) {
            displayUnitSystem = normalizeGroundControlUnitSystem(value);
            render(lastState);
            scheduleSizeUpdate();
        },
        destroy() {
            destroyed = true;
            button.removeEventListener('click', togglePrimaryView);
            resizeObserver?.disconnect();
            globalThis.removeEventListener?.('resize', resizeHandler);
            if (animationFrame !== null) cancelAnimationFrame(animationFrame);
            for (const timeout of timeouts) clearTimeout(timeout);
            timeouts.clear();
        },
    };
}
