// Needs the ePER installation (chassis files) and the imported SQLite DB.
import test from 'node:test';
import assert from 'node:assert/strict';
import { findChassis, decodeVin } from '../src/vehicle.js';

// Same data as openPER VinSearcherTests
test('chassis lookup', () => {
  assert.equal(findChassis('223', '05050806').chassis.MOTOR, '2608455');
  assert.equal(findChassis('198', '04275255').chassis.MOTOR, '6416415');
  assert.equal(findChassis('1XX', '04275255'), null);
});

test('decodeVin', () => {
  const [r] = decodeVin('ZFA19800004275255', '3');
  assert.equal(r.mvs, '19859N1');
  assert.equal(r.build_date, '20100310');
  assert.equal(r.exterior_colour_code, '899');
  assert.equal(r.catalogues[0].catalogue, '3Y');
  // SINCOM version agreeing with the VIN's market (AM87) and drive (GDX) comes first
  assert.equal(r.catalogues[0].sincom, '19859N151870');
});
