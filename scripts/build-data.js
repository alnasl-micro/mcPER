// Builds mcPER's data folder from an ePER installation. The result runs anywhere (e.g. a Mac)
// without ePER:
//   eper84.sqlite   catalogue (SP.DB, Jet4 MDB) converted to SQLite, selected languages only
//   vin/            VIN data SP.CH / SP.RT, copied as-is (already bzip2-compressed)
//   images/*.res    drawing images referenced by the catalogue
//   manifest.json
// Usage: node scripts/build-data.js [out-dir] [--langs J,3] [--skip-images]
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import MDBReader from 'mdb-reader';
import { config, eperSource } from '../src/config.js';
import { copyArchive } from '../src/images.js';
import { createIndexes } from './schema.js';

const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const outDir = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--langs') ?? config.dataDir;
const languages = (option('--langs') ?? 'J,3').split(',').map((s) => s.trim()).filter(Boolean);
const skipImages = args.includes('--skip-images');
const CHUNK = 50000;

function sqlType(t) {
  if (['integer', 'long', 'byte', 'boolean', 'bigint'].includes(t)) return 'INTEGER';
  if (['float', 'double', 'currency', 'numeric'].includes(t)) return 'REAL';
  if (t === 'binary' || t === 'ole') return 'BLOB';
  return 'TEXT';
}

function toSql(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString();
  return v;
}

fs.mkdirSync(path.join(outDir, 'vin'), { recursive: true });
const sizes = {};
const record = (rel) => (sizes[rel] = fs.statSync(path.join(outDir, rel)).size);

// 1. Catalogue: MDB -> SQLite, keeping only the selected languages
console.log(`Reading ${eperSource.spDbPath}`);
const reader = new MDBReader(fs.readFileSync(eperSource.spDbPath));
const dbFile = path.join(outDir, 'eper84.sqlite');
const tmp = dbFile + '.tmp';
fs.rmSync(tmp, { force: true });
const db = new DatabaseSync(tmp);
db.exec('PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF; PRAGMA page_size = 8192;');
for (const name of reader.getTableNames()) {
  const table = reader.getTable(name);
  const cols = table.getColumns();
  const names = cols.map((c) => c.name);
  const langIndex = names.indexOf('LNG_COD');
  db.exec(`CREATE TABLE "${name}" (${cols.map((c) => `"${c.name}" ${sqlType(c.type)}`).join(', ')})`);
  const insert = db.prepare(`INSERT INTO "${name}" VALUES (${cols.map(() => '?').join(', ')})`);
  process.stdout.write(`${name} (${table.rowCount}) `);
  for (let offset = 0; offset < table.rowCount; offset += CHUNK) {
    const rows = table.getData({ rowOffset: offset, rowLimit: CHUNK });
    db.exec('BEGIN');
    for (const row of rows) {
      if (langIndex >= 0 && !languages.includes(row.LNG_COD)) continue;
      insert.run(...names.map((n) => toSql(row[n])));
    }
    db.exec('COMMIT');
    process.stdout.write('.');
  }
  process.stdout.write('\n');
}
createIndexes(db, console.log);
const referenced = db
  .prepare(`SELECT DISTINCT UPPER(IMG_PATH) AS p FROM DRAWINGS WHERE IMG_PATH IS NOT NULL
            UNION SELECT DISTINCT UPPER(IMG_PATH) FROM CLICHE WHERE IMG_PATH IS NOT NULL`)
  .all()
  .map((r) => r.p);
console.log('VACUUM');
db.exec('VACUUM');
db.close();
fs.renameSync(tmp, dbFile);
record('eper84.sqlite');

// 2. VIN data
for (const [src, name] of [[eperSource.chassisPath, 'SP.CH.FCTLR'], [eperSource.buildDataPath, 'SP.RT.FCTLR']]) {
  console.log(`copy ${src}`);
  fs.copyFileSync(src, path.join(outDir, 'vin', name));
  record(`vin/${name}`);
}

// 3. Drawing images actually referenced by the catalogue, copied without recompression
const images = { referenced: referenced.length, included: 0, bytes: 0 };
if (!skipImages) {
  fs.mkdirSync(path.join(outDir, 'images'), { recursive: true });
  const byArchive = new Map();
  for (const p of referenced) {
    const [dir, file] = p.split('/');
    if (!file) continue;
    if (!byArchive.has(dir)) byArchive.set(dir, new Set());
    byArchive.get(dir).add(file);
  }
  for (const [dir, names] of [...byArchive].sort()) {
    const target = path.join(outDir, 'images', `${dir}.res`);
    const n = copyArchive(eperSource.imagesDir, dir, target, (entry) => names.has(entry.toUpperCase()));
    if (!n) {
      fs.rmSync(target, { force: true });
      continue;
    }
    images.included += n;
    images.bytes += fs.statSync(target).size;
    process.stdout.write(`${dir} `);
  }
  process.stdout.write('\n');
}

const manifest = {
  format: 1,
  ePER_release: 84,
  data_release: eperSource.release,
  languages,
  created: new Date().toISOString(),
  images,
  files: sizes,
};
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(manifest);
