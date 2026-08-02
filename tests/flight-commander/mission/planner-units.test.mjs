import assert from 'node:assert/strict';
import test from 'node:test';

import {
  distanceFromPlannerDisplay,
  distanceToPlannerDisplay,
  formatPlannerArea,
  formatPlannerDistance,
  plannerUnitLabels,
  resolvePlannerUnitSystem,
  speedFromPlannerDisplay,
  speedToPlannerDisplay,
} from '../../../js/mission/plannerUnits.js';

test('planner follows the Configurator imperial selection and OSD distance families', () => {
  assert.equal(resolvePlannerUnitSystem('imperial', 1), 'imperial');
  assert.equal(resolvePlannerUnitSystem('metric', 0), 'metric');
  assert.equal(resolvePlannerUnitSystem('OSD', 0), 'imperial');
  assert.equal(resolvePlannerUnitSystem('OSD', 3), 'imperial');
  assert.equal(resolvePlannerUnitSystem('OSD', 4), 'imperial');
  assert.equal(resolvePlannerUnitSystem('OSD', 1), 'metric');
  assert.equal(resolvePlannerUnitSystem('none', null), 'metric');
});

test('planner display conversions round-trip while mission values remain SI', () => {
  const feet = distanceToPlannerDisplay(60, 'imperial');
  assert.ok(Math.abs(feet - 196.8503937) < 1e-6);
  assert.ok(Math.abs(distanceFromPlannerDisplay(feet, 'imperial') - 60) < 1e-9);

  const milesPerHour = speedToPlannerDisplay(20, 'imperial');
  assert.ok(Math.abs(milesPerHour - 44.7387258) < 1e-6);
  assert.ok(Math.abs(speedFromPlannerDisplay(milesPerHour, 'imperial') - 20) < 1e-9);
  assert.deepEqual(plannerUnitLabels('imperial'), {
    distance: 'ft',
    speed: 'mph',
    area: 'ft²',
  });
});

test('mission summary uses miles/acres or kilometres/hectares at useful thresholds', () => {
  assert.equal(formatPlannerDistance(100, 'imperial'), '328 ft');
  assert.equal(formatPlannerDistance(1609.344, 'imperial'), '1.00 mi');
  assert.equal(formatPlannerArea(4046.8564224, 'imperial'), '1.00 ac');
  assert.equal(formatPlannerDistance(1500, 'metric'), '1.50 km');
  assert.equal(formatPlannerArea(20000, 'metric'), '2.00 ha');
});
