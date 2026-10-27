// Compares applicability results with ePER output recorded in openPER's tests (commit 8194551).
// ePER's local runs used DRIVE=S (left-hand drive display), hence drive: 'L' where the car is RHD.
import { resolveVehicle } from '../src/vehicle.js';
import { getTableParts } from '../src/catalog.js';
const T = true, F = false;
const cases = [
  { name: 'BarchettaWiperNoVin', cat: 'PK', key: [555, 14, 0], exp: [["46724563", T], ["46443749", T], ["51742734", T], ["5911194", T], ["5911194", T], ["46735258", T], ["46449583", T], ["46735254", T], ["46449584", T], ["16285927", T], ["12647701", T], ["16100811", T], ["46735008", T], ["10718127", T], ["46734873", T], ["12366054", T], ["12374389", T], ["60805088", T], ["46401657", T], ["12642750", T]] },
  { name: 'BarchettaWiperVin', vin: 'ZFA18300000040583', cat: 'PK', key: [555, 14, 0], exp: [["46724563", F], ["46443749", F], ["51742734", T], ["5911194", T], ["5911194", T], ["46735258", F], ["46449583", T], ["46735254", F], ["46449584", T], ["16285927", T], ["12647701", T], ["16100811", T], ["46735008", T], ["10718127", T], ["46734873", T], ["12366054", T], ["12374389", T], ["60805088", F], ["46401657", T], ["12642750", T]] },
  { name: 'PandaFuelTankNoVin', cat: '33', key: [102, 0, 10], exp: [["51860540", T], ["51860543", T], ["51885814", T], ["51886360", T], ["51886364", T], ["51938320", T], ["51938321", T], ["51938322", T], ["51838394", T], ["51864288", T], ["51864288", T], ["7760269", T], ["811900002", T], ["11129885", T], ["11566224", T], ["15180311", T]] },
  { name: 'NuovoPandaWithVinFuelTank', vin: 'ZFA31200003229852', cat: '33', key: [102, 0, 10], exp: [["51860540", F], ["51860543", F], ["51885814", F], ["51886360", T], ["51886364", F], ["51938320", F], ["51938321", F], ["51938322", F], ["51838394", T], ["51864288", F], ["51864288", F], ["7760269", T], ["811900002", T], ["11129885", T], ["11566224", T], ["15180311", T]] },
  { name: 'NuovoPandaNoVinFuelTank', cat: '33', key: [102, 1, 20], exp: [["51886678", T], ["51886679", T], ["51932170", T], ["46751026", T], ["46804425", T], ["51944916", T], ["51979328", T], ["18750221", T], ["51886896", T]] },
  { name: 'NuovoPandaWithMVSFuelTank', mvs: '319130001000', cat: '33', key: [102, 0, 10], exp: [["51860540", F], ["51860543", F], ["51885814", F], ["51886360", T], ["51886364", F], ["51938320", F], ["51938321", T], ["51938322", F], ["51838394", T], ["51864288", F], ["51864288", F], ["7760269", T], ["811900002", T], ["11129885", T], ["11566224", T], ["15180311", T]] },
  { name: 'NuovoPandaWithVinFuelTank2', vin: 'ZFA31200003000439', cat: '33', key: [102, 0, 10], exp: [["51860540", F], ["51860543", F], ["51885814", F], ["51886360", F], ["51886364", T], ["51938320", F], ["51938321", F], ["51938322", F], ["51838394", T], ["51864288", F], ["51864288", F], ["7760269", T], ["811900002", T], ["11129885", F], ["11566224", T], ["15180311", T]] },
  { name: 'GrandPuntoWithVinIsolationsAndPaddings', drive: 'L', vin: 'ZFA19900000184331', cat: '2Y', key: [705, 22, 0], exp: [["51814148", T], ["51828458", F], ["51757232", F], ["51757232", F], ["51814149", F], ["51861111", F], ["51869555", T], ["7799951", T], ["46804433", T], ["51776319", T], ["51776387", T], ["51779613", T], ["51834786", F]] },
  { name: 'IdeaWithMvsFrontSeats', mvs: '235712301000', cat: '4D', key: [706, 1, 4], exp: [["51716895", T], ["46846136", T], ["46846137", T], ["46829749", T], ["184752680", T], ["184089780", T], ["15903407", T]] },
];
let failed = 0;
for (const c of cases) {
  let context = null;
  try { ({ context } = resolveVehicle({ vin: c.vin, mvs: c.mvs, cat: c.cat, drive: process.env.DRIVE ?? c.drive }, '3')); }
  catch (e) { console.log(c.name, 'ERROR', e.message); failed++; continue; }
  const tables = getTableParts(c.cat, ...c.key, { vehicle: context }, '3');
  const want = c.exp.map((x) => x[0]).join();
  const t = tables.find((t) => t.parts.map((p) => p.part_number).join() === want);
  if (!t) { console.log(c.name, 'no variante with matching part list', tables.map((t) => t.parts.length)); failed++; continue; }
  const bad = t.parts.filter((p, i) => (p.fits !== 'no') !== c.exp[i][1]);
  if (bad.length) failed++;
  console.log(`${bad.length ? 'FAIL' : 'ok  '} ${c.name} (variante ${t.variante}): ${t.parts.length - bad.length}/${t.parts.length}`);
  for (const p of bad) console.log('   ', p.part_number, p.fits, p.pattern, p.reasons);
}
process.exitCode = failed ? 1 : 0;
