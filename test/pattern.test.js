import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, evaluateForVehicle, parseVehiclePattern, consolidate, tokenize } from '../src/filter/pattern.js';
import { parseModif } from '../src/filter/modif.js';

const v = (obj) => new Map(Object.entries(obj));

test('tokenize', () => {
  assert.deepEqual(tokenize('(TC2V,TCPAN)+NP4+!399'), ['(', 'TC2V', ',', 'TCPAN', ')', '+', 'NP4', '+', '!', '399']);
  assert.deepEqual(tokenize('A/T|TRB+CC|1.4'), ['A/TTRB', '+', 'CC1.4']);
});

// Cases from openPER ExpressionEvaluaterTests (commit 8194551)
test('AND with known values', () => {
  assert.equal(evaluate('A+B', v({ A: true, B: true })), 'yes');
  assert.equal(evaluate('A+B', v({ A: true, B: false })), 'no');
  assert.equal(evaluate('A+B', v({ A: false, B: false })), 'no');
  assert.equal(evaluate('A+B', v({ A: false, B: true })), 'no');
});

test('unknowns: shown when some assignment is true', () => {
  assert.equal(evaluate('A+B', v({ A: true, B: null })), 'maybe');
  assert.equal(evaluate('A+B', v({ A: false, B: null })), 'no');
  assert.equal(evaluate('A+B', v({ A: null, B: null })), 'maybe');
  assert.equal(evaluate('A,!A', v({ A: null })), 'yes');
  assert.equal(evaluate('A+!A', v({ A: null })), 'no');
});

test('precedence: ! > + > ,', () => {
  assert.equal(evaluate('A+B,C', v({ A: false, B: false, C: true })), 'yes');
  assert.equal(evaluate('A+(B,C)', v({ A: false, B: false, C: true })), 'no');
  assert.equal(evaluate('A+!(B,C)', v({ A: true, B: false, C: false })), 'yes');
  assert.equal(evaluate('(TC2V,TCPAN)+NP4+!399+!614+890', v({ TCPAN: true, NP4: true, 890: true })), 'yes');
  assert.equal(evaluate('(TC2V,TCPAN)+NP4+!399+!614+890', v({ TCPAN: true, NP4: true, 890: true, 614: true })), 'no');
});

test('missing symbols are false; empty pattern is true', () => {
  assert.equal(evaluate('X', v({})), 'no');
  assert.equal(evaluate('!X', v({})), 'yes');
  assert.equal(evaluate('', v({})), 'yes');
  assert.equal(evaluate(null, v({})), 'yes');
});

test('vehicle patterns', () => {
  assert.deepEqual([...parseVehiclePattern('M1+!V1+CC|2.0')], [['M1', true], ['V1', false], ['CC2.0', true]]);
  assert.deepEqual([...consolidate('A+!B', 'B+C')], [['A', true], ['B', false], ['C', true]]);
});

test('three-digit option codes match prefixed symbols', () => {
  const vehicle = { values: v({ '008': true }), precise: true, multiValueSymbols: new Set() };
  assert.equal(evaluateForVehicle('E008', vehicle), 'yes');
  assert.equal(evaluateForVehicle('E009', vehicle), 'no');
});

test('imprecise matching: unknown options are maybe, multi-value options false', () => {
  const vehicle = { values: v({ M1: true }), precise: false, multiValueSymbols: new Set(['LL2']) };
  assert.equal(evaluateForVehicle('M1+ABS', vehicle), 'maybe');
  assert.equal(evaluateForVehicle('M1+LL2', vehicle), 'no');
});

test('drive side', () => {
  const rhd = { values: v({ GDX: true }), precise: true };
  assert.equal(evaluateForVehicle('GSX', rhd), 'no');
  assert.equal(evaluateForVehicle('GS', rhd), 'no');
  assert.equal(evaluateForVehicle('GD', rhd), 'yes');
  const unknown = { values: v({}), precise: true };
  assert.equal(evaluateForVehicle('GS', unknown), 'yes');
  assert.equal(evaluateForVehicle('GSX', { ...rhd, drive: 'L' }), 'yes');
  assert.equal(evaluateForVehicle('GDX', { ...rhd, drive: 'L' }), 'no');
});

test('parseModif', () => {
  assert.deepEqual(parseModif('D1604,C2105'), [{ type: 'D', code: 1604 }, { type: 'C', code: 2105 }]);
  assert.deepEqual(parseModif(null), []);
});
