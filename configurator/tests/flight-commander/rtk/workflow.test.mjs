import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RTK_WORKFLOWS,
  normalizeRtkWorkflow,
  rtkWorkflowGuidance,
  settingsForRtkWorkflow,
} from '../../../js/rtk/rtkWorkflow.js';

test('RTK workflow selection applies safe route recommendations', () => {
  const initial = {
    forwarding: false,
    correctionSource: 'usb-base',
    profile: 'raw-rtcm',
    mode: 'fixed',
    ntrip: { destination: 'aircraft', ggaSource: 'none' },
  };

  const direct = settingsForRtkWorkflow(initial, RTK_WORKFLOWS.DIRECT_NTRIP);
  assert.equal(direct.forwarding, true);
  assert.equal(direct.correctionSource, 'ntrip');
  assert.equal(direct.ntrip.destination, 'aircraft');
  assert.equal(direct.ntrip.ggaSource, 'none');

  const survey = settingsForRtkWorkflow(initial, RTK_WORKFLOWS.SURVEY_BASE);
  assert.equal(survey.profile, 'ublox-f9');
  assert.equal(survey.mode, 'survey-in');
  assert.equal(survey.correctionSource, 'usb-base');

  const refined = settingsForRtkWorkflow(initial, RTK_WORKFLOWS.REFINED_BASE);
  assert.equal(refined.profile, 'ublox-f9');
  assert.equal(refined.mode, 'survey-in');
  assert.equal(refined.correctionSource, 'usb-base');
  assert.equal(refined.ntrip.destination, 'usb-base');
  assert.equal(refined.ntrip.ggaSource, 'usb-base');
  assert.equal(normalizeRtkWorkflow('unknown'), RTK_WORKFLOWS.DIRECT_NTRIP);
});

test('direct NTRIP guidance advances from caster to aircraft to live route', () => {
  const waitingForCaster = rtkWorkflowGuidance(
    RTK_WORKFLOWS.DIRECT_NTRIP,
    { stats: { enabled: true }, ntrip: { connected: false } },
    { available: false },
  );
  assert.match(waitingForCaster.title, /connect an NTRIP stream/i);

  const waitingForAircraft = rtkWorkflowGuidance(
    RTK_WORKFLOWS.DIRECT_NTRIP,
    { stats: { enabled: true }, ntrip: { connected: true } },
    { available: false },
  );
  assert.match(waitingForAircraft.title, /connect the aircraft/i);

  const live = rtkWorkflowGuidance(
    RTK_WORKFLOWS.DIRECT_NTRIP,
    { stats: { enabled: true }, ntrip: { connected: true } },
    { available: true },
  );
  assert.equal(live.tone, 'ready');
});

test('refined-base guidance requires survey, refinement, finalization, and aircraft in order', () => {
  const connect = rtkWorkflowGuidance(
    RTK_WORKFLOWS.REFINED_BASE,
    { stats: { enabled: true }, connected: false, ntrip: {}, refinement: {} },
  );
  assert.match(connect.title, /connect the USB base/i);

  const refine = rtkWorkflowGuidance(
    RTK_WORKFLOWS.REFINED_BASE,
    {
      stats: { enabled: true },
      connected: true,
      surveyIn: { valid: true },
      lastConfiguration: { mode: 'survey-in' },
      ntrip: {},
      refinement: { phase: 'survey-ready' },
    },
  );
  assert.match(refine.title, /start NTRIP refinement/i);

  const finalize = rtkWorkflowGuidance(
    RTK_WORKFLOWS.REFINED_BASE,
    {
      stats: { enabled: true },
      connected: true,
      surveyIn: { valid: true },
      lastConfiguration: { mode: 'ntrip-positioning' },
      ntrip: { connected: true },
      refinement: { phase: 'refined-ready' },
    },
  );
  assert.match(finalize.title, /finalize/i);
});
