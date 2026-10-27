// Needs the ePER installation (data\images\*.res) and the imported SQLite DB.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { highlight, parseHotspots, readImage } from '../src/images.js';
import { getDrawingImage } from '../src/catalog.js';

test('parseHotspots', () => {
  assert.deepEqual(parseHotspots('1821,767,1845,791'), [[1821, 767, 1845, 791]]);
  assert.deepEqual(parseHotspots('L->1,2,3,4;5,6,7,8'), [[1, 2, 3, 4], [5, 6, 7, 8]]);
  assert.deepEqual(parseHotspots(null), []);
});

test('drawing image is read from .res and framed', () => {
  const view = getDrawingImage('PK', 443, 5, 0, 1);
  const png = readImage(view.imgPath);
  assert.equal(png.toString('latin1', 1, 4), 'PNG');
  const ref4 = view.refs.find((r) => r.ref === 4);
  assert.equal(ref4.part_number, '46406118');
  const [x1, y1] = parseHotspots(ref4.hotspots)[0];
  const out = PNG.sync.read(highlight(png, parseHotspots(ref4.hotspots), { margin: 2, thickness: 1 }));
  const i = ((y1 - 2) * out.width + (x1 - 2)) * 4;
  assert.deepEqual([...out.data.subarray(i, i + 3)], [230, 0, 0]);
});
