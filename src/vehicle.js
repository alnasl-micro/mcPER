// VIN decoding and the vehicle context used for applicability filtering.
import { config } from './config.js';
import { all, dsc } from './db.js';
import { KtdFile } from './ktd/ktdReader.js';
import { consolidate, parseVehiclePattern } from './filter/pattern.js';

let chassisFile, buildDataFile;
function files() {
  chassisFile ??= new KtdFile(config.chassisPath, 1);
  buildDataFile ??= new KtdFile(config.buildDataPath, 2);
  return { chassisFile, buildDataFile };
}

const trimAll = (r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.trim()]));
const num = (s) => (/^\d+$/.test(s ?? '') ? Number(s) : null);

export function findChassis(model, chassis) {
  const { chassisFile, buildDataFile } = files();
  const chassis8 = chassis.padStart(8, '0').slice(-8);
  const [ch] = chassisFile.find(model + chassis8, (r) => r.MVS.slice(0, 3) === model && r.CHASSY === chassis8);
  if (!ch) return null;
  const key = model + chassis8.slice(-7);
  const [rt] = buildDataFile.find(key, (r) => r.MOD_TEL === key);
  return { chassis: trimAll(ch), build: rt ? trimAll(rt) : null };
}

function mvsRows(mod, version, serie) {
  return all(
    `SELECT M.CAT_COD, C.CAT_DSC, C.MK_COD, C.MK2_COD, C.CMG_COD, G.CMG_DSC, M.MVS_DSC, M.SINCOM,
            M.MVS_ENGINE_TYPE, M.MVS_DOORS_NUM, M.PATTERN
     FROM MVS M
     JOIN CATALOGUES C ON C.CAT_COD = M.CAT_COD
     LEFT JOIN COMM_MODGRP G ON G.MK2_COD = C.MK2_COD AND G.CMG_COD = C.CMG_COD
     WHERE M.MOD_COD = :mod AND M.MVS_VERSION = :version AND M.MVS_SERIE = :serie`,
    { mod, version, serie },
  );
}

// "M1+V1+CC|2.0+!ABS" -> [{ symbol: 'CC2.0', type: 'CC', code: '2.0', value: true }, ...]
function splitOptions(text) {
  return (text ?? '')
    .replace(/[\r\n\s]/g, '')
    .split('+')
    .filter(Boolean)
    .map((raw) => {
      const value = !raw.startsWith('!');
      const s = value ? raw : raw.slice(1);
      const [type, code] = s.includes('|') ? s.split('|') : [s, ''];
      return { symbol: type + code, type, code, value };
    });
}

function describeOptions(cat, text, lang) {
  const options = splitOptions(text);
  if (!options.length) return [];
  const rows = all(
    `SELECT V.VMK_TYPE || IFNULL(V.VMK_COD, '') AS symbol, V.VMK_DSC AS description,
            ${dsc('CARAT_DSC', 'VMK_DSC', 'CAT_COD = V.CAT_COD AND VMK_TYPE = V.VMK_TYPE')} AS type_description
     FROM VMK_DSC V WHERE V.CAT_COD = :cat AND V.LNG_COD = :lang`,
    { cat },
    lang,
  );
  const bySymbol = new Map(rows.map((r) => [r.symbol, r]));
  return options.map((o) => {
    const d = bySymbol.get(o.symbol) ?? (/^\d{3}$/.test(o.symbol) ? rows.find((r) => r.symbol.endsWith(o.symbol)) : null);
    return {
      symbol: o.symbol,
      present: o.value,
      type_description: d?.type_description ?? null,
      description: d?.description ?? null,
    };
  });
}

const multiValueCache = new Map();
function multiValueSymbols(cat) {
  if (!multiValueCache.has(cat)) {
    const rows = all(
      `SELECT DISTINCT VMK_TYPE || VMK_COD AS s FROM VMK_DSC WHERE CAT_COD = :cat AND IFNULL(VMK_COD, '') <> ''`,
      { cat },
    );
    multiValueCache.set(cat, new Set(rows.map((r) => r.s)));
  }
  return multiValueCache.get(cat);
}

function colour(table, codeCol, dscCol, cat, code, lang) {
  if (!code) return null;
  const [r] = all(`SELECT ${dsc(table, dscCol, `CAT_COD = :cat AND ${codeCol} = :code`)} AS d`, { cat, code }, lang);
  return r?.d ?? null;
}

/**
 * Builds the filter context for one catalogue.
 * Without a VIN (mvs only) the match is imprecise: unknown options stay unknown.
 */
export function vehicleContext(cat, { caratt = '', sincomPattern = '', cutoffs = null, drive = null } = {}) {
  return {
    cat,
    drive,
    values: caratt ? consolidate(caratt, sincomPattern) : parseVehiclePattern(sincomPattern),
    precise: Boolean(caratt),
    multiValueSymbols: multiValueSymbols(cat),
    cutoffs,
  };
}

export function decodeVin(vinInput, lang) {
  const vin = vinInput.trim().toUpperCase();
  if (vin.length !== 17) throw new Error('VIN must be 17 characters');
  const models = all(`SELECT MOD_COD FROM VIN WHERE VIN_COD = :code`, { code: vin.slice(3, 6) }).map((r) => r.MOD_COD);
  const candidates = models.length ? models : [vin.slice(3, 6)];
  const results = [];
  for (const model of candidates) {
    const found = findChassis(model, vin.slice(9, 17));
    if (!found) continue;
    const { chassis, build } = found;
    const mvs = chassis.MVS;
    const caratt = parseVehiclePattern(build?.CARATT);
    // Several SINCOM versions (market, drive side) share an MVS; prefer the ones agreeing with CARATT.
    const score = (pattern) => {
      const items = [...parseVehiclePattern(pattern)].filter(([k]) => caratt.has(k));
      const conflicts = items.filter(([k, v]) => caratt.get(k) !== v).length;
      return items.length - 2 * conflicts;
    };
    const catalogues = mvsRows(mvs.slice(0, 3), mvs.slice(3, 6), mvs.slice(6, 7))
      .map((c) => ({ ...c, score: score(c.PATTERN) }))
      .sort((a, b) => b.score - a.score);
    results.push({
      vin: chassis.VIN || build?.VIN || vin,
      model_code: model,
      mvs,
      chassis: chassis.CHASSY,
      organization_number: chassis.ORGANIZATION,
      engine_number: chassis.MOTOR,
      build_date: chassis.DATE,
      interior_colour_code: build?.COLINT || chassis.INT_COLOR || null,
      exterior_colour_code: build?.COLEST || null,
      market: build?.MERCDEST || null,
      drive_code: build?.GUIDA || null,
      option_codes: build?.CODOPT || null,
      caratt: build?.CARATT || null,
      catalogues: catalogues.map((c) => ({
        best_match: c.score === catalogues[0].score,
        catalogue: c.CAT_COD,
        catalogue_description: c.CAT_DSC,
        make: c.MK_COD,
        sub_make: c.MK2_COD,
        model_group: c.CMG_COD,
        model_group_description: c.CMG_DSC,
        version_description: c.MVS_DSC,
        sincom: c.SINCOM,
        engine_type: c.MVS_ENGINE_TYPE,
        doors: c.MVS_DOORS_NUM,
        sincom_pattern: c.PATTERN,
        interior_colour: colour('INTERNAL_COLOURS_DSC', 'COD_COLORE_INT_VET', 'DSC_COLORE_INT_VET', c.CAT_COD, build?.COLINT || chassis.INT_COLOR, lang),
        exterior_colour: colour('EXTERNAL_COLOURS_DSC', 'COD_COLORE_EXT_VET', 'DSC_COLORE_EXT_VET', c.CAT_COD, build?.COLEST, lang),
      })),
      _cutoffs: { DAT: num(chassis.DATE), TEL: num(chassis.CHASSY), MOT: num(chassis.MOTOR), VET: num(chassis.ORGANIZATION) },
    });
  }
  return results;
}

export function describeVehicleOptions(cat, decoded, lang) {
  const sincom = decoded.catalogues.find((c) => c.catalogue === cat)?.sincom_pattern ?? '';
  return {
    vin_options: describeOptions(cat, decoded.caratt, lang),
    version_options: describeOptions(cat, sincom, lang),
  };
}

// Resolves a VIN (or a SINCOM/MVS code like "183.829.0.0") to a filter context for a catalogue.
export function resolveVehicle({ vin, mvs, cat, drive }, lang) {
  drive = drive ? drive.toUpperCase() : null;
  if (vin) {
    const [decoded] = decodeVin(vin, lang);
    if (!decoded) throw new Error(`VIN ${vin} not found in ePER chassis data`);
    const catalogue = cat ? decoded.catalogues.find((c) => c.catalogue === cat) : decoded.catalogues[0];
    if (!catalogue) {
      throw new Error(
        `VIN ${vin} belongs to catalogue(s) ${decoded.catalogues.map((c) => c.catalogue).join(', ') || '(none)'}, not ${cat}`,
      );
    }
    return {
      decoded,
      context: vehicleContext(catalogue.catalogue, {
        caratt: decoded.caratt,
        sincomPattern: catalogue.sincom_pattern,
        cutoffs: decoded._cutoffs,
        drive,
      }),
    };
  }
  if (mvs) {
    const [row] = all(`SELECT CAT_COD, PATTERN FROM MVS WHERE SINCOM = :mvs${cat ? ' AND CAT_COD = :cat' : ''}`, { mvs, cat });
    if (!row) throw new Error(`MVS/SINCOM ${mvs} not found${cat ? ` in catalogue ${cat}` : ''}`);
    return { decoded: null, context: vehicleContext(row.CAT_COD, { sincomPattern: row.PATTERN, drive }) };
  }
  return { decoded: null, context: null };
}
