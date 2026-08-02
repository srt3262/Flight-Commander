'use strict';

export const RTK_WORKFLOWS = Object.freeze({
    DIRECT_NTRIP: 'direct-ntrip',
    SURVEY_BASE: 'survey-base',
    REFINED_BASE: 'refined-base',
});

const WORKFLOW_VALUES = new Set(Object.values(RTK_WORKFLOWS));

export const RTK_WORKFLOW_DETAILS = Object.freeze({
    [RTK_WORKFLOWS.DIRECT_NTRIP]: Object.freeze({
        title: 'Direct NTRIP → Aircraft',
        summary: 'Use an internet NTRIP caster as the correction source. No local base receiver is required.',
        steps: Object.freeze([
            'Choose a caster stream and enter its account details.',
            'Connect NTRIP, then connect the aircraft.',
            'Confirm the route reports NTRIP → aircraft and frames are increasing.',
        ]),
    }),
    [RTK_WORKFLOWS.SURVEY_BASE]: Object.freeze({
        title: 'Survey-in USB Base → Aircraft',
        summary: 'Survey a local u-blox F9 base, then send its RTCM corrections to the aircraft.',
        steps: Object.freeze([
            'Connect the USB F9 and apply the survey-in configuration.',
            'Keep the antenna motionless until survey-in is complete and valid.',
            'Connect the aircraft and confirm local-base frames are increasing.',
        ]),
    }),
    [RTK_WORKFLOWS.REFINED_BASE]: Object.freeze({
        title: 'NTRIP-refined USB Base → Aircraft',
        summary: 'Use NTRIP to refine a completed survey, save that position as the local base, then forward local RTCM.',
        steps: Object.freeze([
            'Connect the USB F9, apply survey-in, and wait for a valid survey.',
            'Choose an NTRIP stream and start refinement while the antenna remains motionless.',
            'Finalize the stable RTK Fixed samples as the local fixed base.',
            'Connect the aircraft; NTRIP may then be disconnected because the USB base is the correction source.',
        ]),
    }),
});

export function normalizeRtkWorkflow(value) {
    return WORKFLOW_VALUES.has(value) ? value : RTK_WORKFLOWS.DIRECT_NTRIP;
}

export function settingsForRtkWorkflow(settings = {}, requestedWorkflow) {
    const workflow = normalizeRtkWorkflow(requestedWorkflow);
    const ntrip = { ...(settings.ntrip ?? {}) };
    const result = {
        ...settings,
        workflow,
        forwarding: true,
        ntrip,
    };

    if (workflow === RTK_WORKFLOWS.DIRECT_NTRIP) {
        result.correctionSource = 'ntrip';
        ntrip.destination = 'aircraft';
        ntrip.ggaSource = ntrip.ggaSource === 'manual' ? 'manual' : 'none';
        return result;
    }

    result.profile = 'ublox-f9';
    result.mode = 'survey-in';
    result.correctionSource = 'usb-base';
    if (workflow === RTK_WORKFLOWS.REFINED_BASE) {
        ntrip.destination = 'usb-base';
        ntrip.ggaSource = 'usb-base';
    }
    return result;
}

function aircraftReady(route) {
    return Boolean(route?.available);
}

export function rtkWorkflowGuidance(requestedWorkflow, state = {}, route = {}) {
    const workflow = normalizeRtkWorkflow(requestedWorkflow);
    const forwarding = (state.forwarding ?? state.stats?.enabled) !== false;
    const ntripConnected = Boolean(state.ntrip?.connected);
    const survey = state.surveyIn;
    const configurationMode = state.lastConfiguration?.mode;
    const refinementPhase = state.refinement?.phase ?? 'idle';

    if (!forwarding) {
        return {
            tone: 'warning',
            title: 'Enable correction forwarding',
            detail: 'Turn on “Forward validated corrections to the aircraft” before connecting the rover link.',
        };
    }

    if (workflow === RTK_WORKFLOWS.DIRECT_NTRIP) {
        if (!ntripConnected) {
            return {
                tone: 'next',
                title: 'Next: choose and connect an NTRIP stream',
                detail: 'Load the caster streams, choose a nearby RTCM3 mountpoint, then select Connect NTRIP to aircraft.',
            };
        }
        if (!aircraftReady(route)) {
            return {
                tone: 'waiting',
                title: 'NTRIP is ready — connect the aircraft',
                detail: 'Corrections remain on standby until Flight Commander Firmware provides an aircraft injection route.',
            };
        }
        return {
            tone: 'ready',
            title: 'Direct NTRIP corrections are live',
            detail: 'Confirm the valid and forwarded frame counters continue increasing.',
        };
    }

    if (!state.connected) {
        return {
            tone: 'next',
            title: 'Next: connect the USB base receiver',
            detail: 'Select the u-blox F9 serial device and choose Connect USB base. The aircraft can remain powered off.',
        };
    }
    if (!['survey-in', 'fixed', 'ntrip-positioning'].includes(configurationMode)) {
        return {
            tone: 'next',
            title: 'Next: start survey-in',
            detail: 'Keep the base antenna motionless and select Apply survey-in configuration.',
        };
    }
    if (survey?.active && !survey?.valid) {
        return {
            tone: 'waiting',
            title: 'Survey-in is running',
            detail: 'Do not move the antenna. Continue when the receiver reports “Complete and valid.”',
        };
    }
    if (!survey?.valid && configurationMode !== 'fixed') {
        return {
            tone: 'waiting',
            title: 'Waiting for a valid survey',
            detail: 'The configured duration and accuracy must both be satisfied before corrections are trusted.',
        };
    }

    if (workflow === RTK_WORKFLOWS.REFINED_BASE) {
        if (refinementPhase === 'collecting' || refinementPhase === 'ntrip-connecting') {
            return {
                tone: 'waiting',
                title: 'NTRIP refinement is collecting RTK Fixed samples',
                detail: 'Keep the USB base antenna motionless until the fixed-sample counter is complete.',
            };
        }
        if (refinementPhase === 'refined-ready') {
            return {
                tone: 'next',
                title: 'Next: finalize the refined fixed base',
                detail: 'Select Finalize refined fixed base to store the averaged coordinate and resume local RTCM output.',
            };
        }
        if (refinementPhase !== 'base-ready' && configurationMode !== 'fixed') {
            return {
                tone: 'next',
                title: 'Next: start NTRIP refinement',
                detail: 'Choose a nearby RTCM3 stream, then select Start NTRIP refinement. The aircraft may stay off.',
            };
        }
    }

    if (!aircraftReady(route)) {
        return {
            tone: 'waiting',
            title: 'Local base is ready — connect the aircraft',
            detail: 'The surveyed base keeps running and corrections forward automatically when the aircraft link appears.',
        };
    }
    return {
        tone: 'ready',
        title: 'Local-base corrections are live',
        detail: 'Confirm the valid and forwarded frame counters continue increasing.',
    };
}
