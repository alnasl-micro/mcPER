// Modification (MODIF) filtering.
// A MODIF string is a comma-separated list like "D1604,C2105":
//   D = fitted from this modification onwards, C = fitted until this modification.
// Each modification has activations (MDF_ACT) giving the cut-over point by
//   DAT (build date), TEL (chassis), MOT (engine), VET (organization number).
import { all, dsc } from '../db.js';
import { evaluateForVehicle, FALSE } from './pattern.js';

export const ACTIVATION_LABELS = {
  DAT: 'build date',
  TEL: 'chassis number',
  MOT: 'engine number',
  VET: 'organization number',
  CAM: 'gearbox number',
};

export function parseModif(text) {
  if (!text) return [];
  return text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => ({ type: s[0], code: Number(s.slice(1)) }));
}

const cache = new Map();

export function getModification(cat, code, lang) {
  const key = `${cat}|${code}|${lang}`;
  if (cache.has(key)) return cache.get(key);
  const [row] = all(
    `SELECT ${dsc('MODIF_DSC', 'MDF_DSC', 'CAT_COD = :cat AND MDF_COD = :code')} AS description`,
    { cat, code },
    lang,
  );
  const activations = all(
    `SELECT ACT_COD, MDFACT_SPEC, PATTERN FROM MDF_ACT WHERE CAT_COD = :cat AND MDF_COD = :code ORDER BY MDFACT_PROG`,
    { cat, code },
  ).map((a) => ({
    type: a.ACT_COD,
    label: ACTIVATION_LABELS[a.ACT_COD] ?? a.ACT_COD,
    spec: a.MDFACT_SPEC,
    value: normalizeSpec(a.ACT_COD, a.MDFACT_SPEC),
    pattern: a.PATTERN || null,
  }));
  const mod = { code, description: row?.description ?? null, activations };
  cache.set(key, mod);
  return mod;
}

// DAT specs are dd/mm/yyyy; compare as yyyymmdd. Others are numbers.
function normalizeSpec(type, spec) {
  if (!spec) return null;
  if (type === 'DAT') {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(spec);
    return m ? Number(m[3] + m[2] + m[1]) : null;
  }
  return /^\d+$/.test(spec) ? Number(spec) : null;
}

/**
 * Describes and (with a vehicle) evaluates the modifications on a part or drawing.
 * vehicle.cutoffs: { DAT, TEL, MOT, VET } as numbers, when known.
 * Returns { modifications, excluded, reasons }.
 */
export function evaluateModifications(cat, modifText, vehicle, lang) {
  const modifications = parseModif(modifText).map(({ type, code }) => ({
    type,
    meaning: type === 'D' ? 'from this modification' : type === 'C' ? 'until this modification' : type,
    ...getModification(cat, code, lang),
  }));
  const reasons = [];
  let excluded = false;
  if (vehicle?.cutoffs) {
    for (const mod of modifications) {
      for (const act of mod.activations) {
        const vehicleValue = vehicle.cutoffs[act.type];
        if (act.value === null || vehicleValue == null) continue;
        if (act.pattern && evaluateForVehicle(act.pattern, vehicle) === FALSE) continue;
        const hide = mod.type === 'C' ? act.value <= vehicleValue : mod.type === 'D' ? act.value > vehicleValue : false;
        if (hide) {
          excluded = true;
          reasons.push(
            `${mod.type}${mod.code} (${mod.meaning}): ${act.label} cut-over ${act.spec}, vehicle ${vehicleValue}`,
          );
        }
      }
    }
  }
  return { modifications, excluded, reasons };
}
