// Catalogue queries, ported from openPER's Release84Repository.
import { all, get, dsc } from './db.js';
import { evaluateForVehicle, FALSE, MAYBE, TRUE } from './filter/pattern.js';
import { evaluateModifications } from './filter/modif.js';

// Availability bits (0x800 orderable, 0x2000 replaced, 0x4000 exhausted) reflect 2014 and are
// deliberately not reported.
const PART_FLAGS = [
  [0x100, 'refurbished'],
  [0x400, 'accessory'],
];

export function partFlags(mask) {
  const flags = PART_FLAGS.filter(([bit]) => (mask & bit) !== 0).map(([, name]) => name);
  return flags.length ? flags : undefined;
}

export const MAKES = [
  { make: 'F', sub_make: 'F', name: 'FIAT' },
  { make: 'F', sub_make: 'T', name: 'FIAT COMMERCIAL' },
  { make: 'L', sub_make: 'L', name: 'LANCIA' },
  { make: 'R', sub_make: 'R', name: 'ALFA ROMEO' },
  { make: 'F', sub_make: 'C', name: 'ABARTH' },
];

export function listCatalogues({ make, query } = {}) {
  const where = [];
  if (make) where.push('C.MK2_COD = :make');
  if (query) where.push('(C.CAT_DSC LIKE :q OR G.CMG_DSC LIKE :q OR C.CAT_COD = :exact)');
  return all(
    `SELECT C.CAT_COD AS catalogue, C.CAT_DSC AS description, C.MK_COD AS make, C.MK2_COD AS sub_make,
            C.CMG_COD AS model_group, G.CMG_DSC AS model_group_description
     FROM CATALOGUES C
     LEFT JOIN COMM_MODGRP G ON G.MK2_COD = C.MK2_COD AND G.CMG_COD = C.CMG_COD
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY C.MK2_COD, G.CMG_SORT_KEY, C.CAT_SORT_KEY`,
    { make, q: `%${query}%`, exact: query?.toUpperCase() },
  );
}

export function getCatalogue(cat) {
  return get(`SELECT CAT_COD, CAT_DSC FROM CATALOGUES WHERE CAT_COD = :cat`, { cat });
}

export function listGroups(cat, lang) {
  return all(
    `SELECT DISTINCT D.GRP_COD AS group_code,
            ${dsc('GROUPS_DSC', 'GRP_DSC', 'GRP_COD = D.GRP_COD')} AS description
     FROM DRAWINGS D WHERE D.CAT_COD = :cat ORDER BY D.GRP_COD`,
    { cat },
    lang,
  );
}

export function listSubgroups(cat, grp, lang) {
  return all(
    `SELECT DISTINCT D.SGRP_COD AS subgroup_code,
            ${dsc('SUBGROUPS_DSC', 'SGRP_DSC', 'GRP_COD = D.GRP_COD AND SGRP_COD = D.SGRP_COD')} AS description
     FROM DRAWINGS D WHERE D.CAT_COD = :cat AND D.GRP_COD = :grp ORDER BY D.SGRP_COD`,
    { cat, grp },
    lang,
  );
}

function applicability(cat, pattern, modif, vehicle, lang) {
  const mods = evaluateModifications(cat, modif, vehicle, lang);
  const out = {
    pattern: pattern || null,
    modifications: mods.modifications.map((m) => ({
      type: m.type,
      code: m.code,
      meaning: m.meaning,
      description: m.description,
      cut_over: m.activations.map((a) => `${a.label} ${a.spec}${a.pattern ? ` (when ${a.pattern})` : ''}`),
    })),
  };
  if (vehicle) {
    const p = evaluateForVehicle(pattern, vehicle);
    const reasons = [];
    if (p === FALSE) reasons.push(`pattern ${pattern} does not match the vehicle`);
    if (p === MAYBE) reasons.push(`pattern ${pattern} depends on options not known for this vehicle`);
    reasons.push(...mods.reasons);
    out.fits = p === FALSE || mods.excluded ? FALSE : p === MAYBE ? MAYBE : TRUE;
    if (reasons.length) out.reasons = reasons;
  }
  return out;
}

export function listTables(cat, grp, sgrp, vehicle, lang) {
  const rows = all(
    `SELECT D.SGS_COD, D.DRW_NUM, D.VARIANTE, D.REVISIONE, D.TABLE_COD, D.PATTERN, D.MODIF, D.IMG_PATH,
            ${dsc('TABLES_DSC', 'DSC', 'COD = D.TABLE_DSC_COD')} AS description
     FROM DRAWINGS D
     WHERE D.CAT_COD = :cat AND D.GRP_COD = :grp AND D.SGRP_COD = :sgrp
     ORDER BY D.SGS_COD, D.DRW_NUM`,
    { cat, grp, sgrp },
    lang,
  );
  return rows.map((r) => ({
    sgs_code: r.SGS_COD,
    variante: r.VARIANTE,
    revisione: r.REVISIONE,
    table_code: r.TABLE_COD,
    description: r.description,
    ...applicability(cat, r.PATTERN, r.MODIF, vehicle, lang),
  }));
}

function getDrawings(cat, grp, sgrp, sgs, variante, lang) {
  return all(
    `SELECT D.VARIANTE, D.REVISIONE, D.TABLE_COD, D.PATTERN, D.MODIF,
            ${dsc('TABLES_DSC', 'DSC', 'COD = D.TABLE_DSC_COD')} AS description
     FROM DRAWINGS D
     WHERE D.CAT_COD = :cat AND D.GRP_COD = :grp AND D.SGRP_COD = :sgrp AND D.SGS_COD = :sgs
       ${variante != null ? 'AND D.VARIANTE = :variante' : ''}
     ORDER BY D.DRW_NUM`,
    { cat, grp, sgrp, sgs, variante },
    lang,
  );
}

const PART_ROW_SQL = `
  SELECT T.TBD_RIF, T.TBD_SEQ, T.PRT_COD, T.TBD_QTY, T.TBD_VAL_FORMULA, T.MODIF, T.COL_COD,
         T.PRT_MASK_MAK, T.CDS_COD,
         EXISTS (SELECT 1 FROM CPXDATA X WHERE X.CPLX_PRT_COD = T.PRT_COD) AS has_components,
         ${dsc('CODES_DSC', 'CDS_DSC', 'CDS_COD = T.CDS_COD')} AS description,
         ${dsc('DESC_AGG_DSC', 'DSC', 'COD = T.TBD_AGG_DSC')} AS extra_description,
         ${dsc('NOTES_DSC', 'NTS_DSC', 'NTS_COD = T.NTS_COD')} AS note
  FROM TBDATA T`;

function formatPart(cat, r, vehicle, lang) {
  return {
    ref: r.TBD_RIF,
    seq: r.TBD_SEQ,
    part_number: r.PRT_COD,
    quantity: r.TBD_QTY,
    description: r.description,
    extra_description: r.extra_description || undefined,
    note: r.note || undefined,
    colour_codes: r.COL_COD || undefined,
    flags: partFlags(r.PRT_MASK_MAK ?? 0),
    // Assembly with its own breakdown (get_part lists the components)
    has_components: r.has_components ? true : undefined,
    ...applicability(cat, r.TBD_VAL_FORMULA, r.MODIF, vehicle, lang),
  };
}

export function getTableParts(cat, grp, sgrp, sgs, { variante, vehicle, includeExcluded = true } = {}, lang) {
  const drawings = getDrawings(cat, grp, sgrp, sgs, variante, lang);
  return drawings.map((d) => {
    const drawing = applicability(cat, d.PATTERN, d.MODIF, vehicle, lang);
    let parts = all(
      `${PART_ROW_SQL}
       WHERE T.CAT_COD = :cat AND T.GRP_COD = :grp AND T.SGRP_COD = :sgrp AND T.SGS_COD = :sgs
         AND T.VARIANTE = :variante AND T.REVISIONE = :revisione
       ORDER BY T.TBD_RIF, T.TBD_SEQ`,
      { cat, grp, sgrp, sgs, variante: d.VARIANTE, revisione: d.REVISIONE },
      lang,
    ).map((r) => formatPart(cat, r, vehicle, lang));
    if (vehicle && !includeExcluded) parts = parts.filter((p) => p.fits !== FALSE);
    return {
      catalogue: cat,
      group: grp,
      subgroup: sgrp,
      sgs_code: sgs,
      variante: d.VARIANTE,
      revisione: d.REVISIONE,
      table_code: d.TABLE_COD,
      description: d.description,
      ...drawing,
      parts,
    };
  });
}

// Part descriptions containing every word of the query, in the requested language or English.
// Japanese is stored as halfwidth katakana with "･" separators, which are ignored.
export function findDescriptionCodes(query, lang) {
  const words = query
    .split(/\s+/)
    .map((w) => toHalfwidthKatakana(w.normalize('NFKC')).replace(/[･・]/g, '').toUpperCase())
    .filter(Boolean);
  if (!words.length) return [];
  const params = {};
  words.forEach((w, i) => (params[`w${i}`] = `%${w}%`));
  return all(
    `SELECT DISTINCT CDS_COD AS code, CDS_DSC AS description, LNG_COD AS lang FROM CODES_DSC
     WHERE (LNG_COD = :lang OR LNG_COD = :fb)
       AND ${words.map((_, i) => `UPPER(REPLACE(CDS_DSC, '･', '')) LIKE :w${i}`).join(' AND ')}
     LIMIT 200`,
    params,
    lang,
  );
}

// Merges another applicability result (drawing, assembly component) into a part's fitment.
function combineFits(target, other, prefix) {
  if (!other.fits || other.fits === TRUE) return;
  if (other.fits === FALSE || target.fits === TRUE) target.fits = other.fits;
  target.reasons = [...(target.reasons ?? []), ...(other.reasons ?? []).map((x) => prefix + x)];
}

const LOCATION_SQL = `
  T.GRP_COD, T.SGRP_COD, T.SGS_COD, T.VARIANTE, T.REVISIONE,
  D.PATTERN AS DRW_PATTERN, D.MODIF AS DRW_MODIF,
  ${dsc('TABLES_DSC', 'DSC', 'COD = D.TABLE_DSC_COD')} AS table_description,
  ${dsc('SUBGROUPS_DSC', 'SGRP_DSC', 'GRP_COD = T.GRP_COD AND SGRP_COD = T.SGRP_COD')} AS subgroup_description`;

const DRAWING_JOIN = `
  JOIN DRAWINGS D ON D.CAT_COD = T.CAT_COD AND D.GRP_COD = T.GRP_COD AND D.SGRP_COD = T.SGRP_COD
                 AND D.SGS_COD = T.SGS_COD AND D.VARIANTE = T.VARIANTE AND D.REVISIONE = T.REVISIONE`;

// Finds parts in a catalogue's tables, and parts inside assemblies (e.g. brake pads inside a caliper).
export function searchParts({ query, cat, group, vehicle, limit = 50 }, lang) {
  const isPartNumber = /^\d{5,}$/.test(query.trim());
  const params = { cat, group, pn: `${query.trim()}%` };
  let matched;
  let codeList = '';
  if (!isPartNumber) {
    matched = findDescriptionCodes(query, lang);
    const codes = [...new Set(matched.map((c) => c.code))];
    if (!codes.length) {
      return { matched_descriptions: [], total: 0, results: [], hint: 'No description matched. Try a shorter word or English.' };
    }
    codes.forEach((c, i) => (params[`c${i}`] = c));
    codeList = codes.map((_, i) => `:c${i}`).join(', ');
  }
  const scope = `T.CAT_COD = :cat${group != null ? ' AND T.GRP_COD = :group' : ''}`;
  const direct = all(
    `SELECT ${LOCATION_SQL},
            T.TBD_RIF, T.TBD_SEQ, T.PRT_COD, T.TBD_QTY, T.TBD_VAL_FORMULA, T.MODIF, T.COL_COD, T.PRT_MASK_MAK, T.CDS_COD,
            EXISTS (SELECT 1 FROM CPXDATA X WHERE X.CPLX_PRT_COD = T.PRT_COD) AS has_components,
            ${dsc('CODES_DSC', 'CDS_DSC', 'CDS_COD = T.CDS_COD')} AS description,
            ${dsc('DESC_AGG_DSC', 'DSC', 'COD = T.TBD_AGG_DSC')} AS extra_description,
            ${dsc('NOTES_DSC', 'NTS_DSC', 'NTS_COD = T.NTS_COD')} AS note
     FROM TBDATA T ${DRAWING_JOIN}
     WHERE ${scope} AND ${isPartNumber ? 'T.PRT_COD LIKE :pn' : `T.CDS_COD IN (${codeList})`}
     ORDER BY T.GRP_COD, T.SGRP_COD, T.SGS_COD, T.VARIANTE, T.TBD_RIF, T.TBD_SEQ`,
    params,
    lang,
  );
  const inAssemblies = all(
    `SELECT ${LOCATION_SQL},
            T.TBD_RIF, T.PRT_COD AS ASSEMBLY, T.TBD_VAL_FORMULA AS ASSEMBLY_PATTERN, T.MODIF AS ASSEMBLY_MODIF,
            ${dsc('CODES_DSC', 'CDS_DSC', 'CDS_COD = T.CDS_COD')} AS assembly_description,
            X.CPD_RIF, X.PRT_COD, X.CPD_QTY, X.MODIF, X.PRT_MASK_MAK,
            ${dsc('CODES_DSC', 'CDS_DSC', 'CDS_COD = X.PRT_CDS_COD')} AS description,
            ${dsc('DESC_AGG_DSC', 'DSC', 'COD = X.CPD_AGG_DSC')} AS extra_description
     FROM CPXDATA X
     JOIN TBDATA T ON T.PRT_COD = X.CPLX_PRT_COD ${DRAWING_JOIN}
     WHERE ${scope} AND ${isPartNumber ? 'X.PRT_COD LIKE :pn' : `X.PRT_CDS_COD IN (${codeList})`}
     ORDER BY T.GRP_COD, T.SGRP_COD, T.SGS_COD, T.VARIANTE, T.TBD_RIF, T.TBD_SEQ, X.CPD_RIF`,
    params,
    lang,
  );

  const location = (r) => ({
    group: r.GRP_COD,
    subgroup: r.SGRP_COD,
    subgroup_description: r.subgroup_description,
    sgs_code: r.SGS_COD,
    variante: r.VARIANTE,
    revisione: r.REVISIONE,
    table_description: r.table_description,
  });
  const withDrawing = (part, r) => {
    if (vehicle) combineFits(part, applicability(cat, r.DRW_PATTERN, r.DRW_MODIF, vehicle, lang), 'drawing: ');
    return part;
  };

  const results = direct.map((r) => ({ location: location(r), ...withDrawing(formatPart(cat, r, vehicle, lang), r) }));
  const seen = new Set();
  for (const r of inAssemblies) {
    // The same assembly is often listed several times in one table; keep one entry per distinct condition.
    const key = [r.GRP_COD, r.SGRP_COD, r.SGS_COD, r.VARIANTE, r.ASSEMBLY, r.PRT_COD, r.ASSEMBLY_PATTERN, r.ASSEMBLY_MODIF].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    const part = {
      ref: r.CPD_RIF,
      part_number: r.PRT_COD,
      quantity: r.CPD_QTY,
      description: r.description,
      extra_description: r.extra_description || undefined,
      flags: partFlags(r.PRT_MASK_MAK ?? 0),
      inside_assembly: { part_number: r.ASSEMBLY, description: r.assembly_description, table_ref: r.TBD_RIF },
      ...applicability(cat, r.ASSEMBLY_PATTERN, r.ASSEMBLY_MODIF, vehicle, lang),
    };
    const own = evaluateModifications(cat, r.MODIF, vehicle, lang);
    if (own.modifications.length) {
      part.component_modifications = own.modifications.map((m) => `${m.type}${m.code} ${m.description ?? ''}`.trim());
    }
    if (vehicle && own.excluded) combineFits(part, { fits: FALSE, reasons: own.reasons }, 'component: ');
    results.push({ location: location(r), ...withDrawing(part, r) });
  }
  if (vehicle) {
    const order = { [TRUE]: 0, [MAYBE]: 1, [FALSE]: 2 };
    results.sort((a, b) => order[a.fits] - order[b.fits]);
  }
  return {
    matched_descriptions: matched && [...new Set(matched.map((m) => m.description))],
    total: results.length,
    truncated: results.length > limit,
    results: results.slice(0, limit),
  };
}

export function getPart(partNumber, lang) {
  const p = get(
    `SELECT P.PRT_COD, P.CDS_COD, P.PRT_FAM_COD, P.UM_COD, P.PRT_WEIGHT, P.PRT_MASK_MAK, P.PRT_MIN_QTY,
            ${dsc('CODES_DSC', 'CDS_DSC', 'CDS_COD = P.CDS_COD')} AS description,
            ${dsc('FAM_DSC', 'FAM_DSC', 'FAM_COD = P.PRT_FAM_COD')} AS family_description,
            U.UM_DSC
     FROM PARTS P LEFT JOIN UN_OF_MEAS U ON U.UM_COD = P.UM_COD
     WHERE P.PRT_COD = :pn`,
    { pn: partNumber },
    lang,
  );
  if (!p) return null;
  const counts = get(
    `SELECT (SELECT COUNT(*) FROM RPLNT WHERE PRT_COD = :pn) AS replaced_by,
            (SELECT COUNT(*) FROM RPLNT WHERE RPL_COD = :pn) AS replaces,
            (SELECT COUNT(DISTINCT CAT_COD) FROM TBDATA WHERE PRT_COD = :pn) AS catalogues`,
    { pn: partNumber },
  );
  const recond = get(`SELECT RCP_RECOND, RCP_WRECK FROM REC_PARTS WHERE RCP_COD = :pn`, { pn: partNumber });
  return {
    part_number: p.PRT_COD,
    description: p.description,
    family: p.PRT_FAM_COD,
    family_description: p.family_description,
    unit: p.UM_DSC ?? p.UM_COD,
    weight: p.PRT_WEIGHT,
    minimum_quantity: p.PRT_MIN_QTY,
    flags: partFlags(p.PRT_MASK_MAK ?? 0),
    reconditioned_part: recond?.RCP_RECOND || undefined,
    wreck_part: recond?.RCP_WRECK || undefined,
    replaced_by_count: counts.replaced_by,
    replaces_count: counts.replaces,
    used_in_catalogues: counts.catalogues,
  };
}

function replacementLinks(partNumber, direction, lang) {
  const [self, other] = direction === 'newer' ? ['R.PRT_COD', 'R.RPL_COD'] : ['R.RPL_COD', 'R.PRT_COD'];
  return all(
    `SELECT ${other} AS part_number, R.RPL_DATE, R.RPL_MOLT, R.RPL_DIV, R.RPL_MINQTY, R.RPL_FLAGBK, R.RPL_GRPNUM,
            ${dsc('CODES_DSC', 'CDS_DSC', 'CDS_COD = P.CDS_COD')} AS description,
            ${dsc('RPLNT_GRP', 'RPL_GRPDSC', 'PRT_COD = R.PRT_COD AND RPL_GRPNUM = R.RPL_GRPNUM')} AS group_description,
            P.PRT_MASK_MAK
     FROM RPLNT R LEFT JOIN PARTS P ON P.PRT_COD = ${other}
     WHERE ${self} = :pn ORDER BY R.RPL_GRPNUM, ${other}`,
    { pn: partNumber },
    lang,
  ).map((r) => ({
    part_number: r.part_number,
    description: r.description,
    date: r.RPL_DATE,
    // RPL_MOLT/RPL_DIV: quantity ratio new:old
    ratio: r.RPL_MOLT && r.RPL_DIV && (r.RPL_MOLT !== 1 || r.RPL_DIV !== 1) ? `${r.RPL_MOLT}/${r.RPL_DIV}` : undefined,
    group: r.RPL_GRPNUM,
    group_description: r.group_description || undefined,
    interchangeable: r.RPL_FLAGBK === 'Y' ? true : r.RPL_FLAGBK === 'N' ? false : undefined,
    flags: partFlags(r.PRT_MASK_MAK ?? 0),
  }));
}

// Follows the replacement graph (RPLNT: PRT_COD old -> RPL_COD new) in both directions.
export function getPartHistory(partNumber, maxDepth = 10, lang) {
  const walk = (direction) => {
    const nodes = [];
    const seen = new Set([partNumber]);
    let frontier = [{ part: partNumber, depth: 0 }];
    while (frontier.length) {
      const next = [];
      for (const { part, depth } of frontier) {
        if (depth >= maxDepth) continue;
        for (const link of replacementLinks(part, direction, lang)) {
          nodes.push({ from: part, step: depth + 1, ...link });
          if (!seen.has(link.part_number)) {
            seen.add(link.part_number);
            next.push({ part: link.part_number, depth: depth + 1 });
          }
        }
      }
      frontier = next;
    }
    return nodes;
  };
  const newer = walk('newer');
  const older = walk('older');
  const latest = new Set(newer.map((n) => n.part_number).filter((pn) => !newer.some((n) => n.from === pn)));
  return {
    part: getPart(partNumber, lang),
    replaced_by: newer,
    replaces: older,
    current_parts: newer.length ? [...latest] : [partNumber],
  };
}

export function whereUsed(partNumber, { cat, limit = 100 } = {}, lang) {
  const rows = all(
    `SELECT T.CAT_COD, C.CAT_DSC, T.GRP_COD, T.SGRP_COD, T.SGS_COD, T.VARIANTE, T.REVISIONE, T.TBD_RIF,
            T.TBD_QTY, T.TBD_VAL_FORMULA, T.MODIF,
            ${dsc('SUBGROUPS_DSC', 'SGRP_DSC', 'GRP_COD = T.GRP_COD AND SGRP_COD = T.SGRP_COD')} AS subgroup_description
     FROM TBDATA T JOIN CATALOGUES C ON C.CAT_COD = T.CAT_COD
     WHERE T.PRT_COD = :pn ${cat ? 'AND T.CAT_COD = :cat' : ''}
     ORDER BY T.CAT_COD, T.GRP_COD, T.SGRP_COD, T.SGS_COD`,
    { pn: partNumber, cat },
    lang,
  ).map((r) => ({
    catalogue: r.CAT_COD,
    catalogue_description: r.CAT_DSC,
    group: r.GRP_COD,
    subgroup: r.SGRP_COD,
    subgroup_description: r.subgroup_description,
    sgs_code: r.SGS_COD,
    variante: r.VARIANTE,
    revisione: r.REVISIONE,
    ref: r.TBD_RIF,
    quantity: r.TBD_QTY,
    pattern: r.TBD_VAL_FORMULA || undefined,
    modif: r.MODIF || undefined,
  }));
  const assemblies = all(
    `SELECT DISTINCT X.CPLX_PRT_COD AS assembly, X.CPD_QTY AS quantity,
            ${dsc('CODES_DSC', 'CDS_DSC', 'CDS_COD = P.CDS_COD')} AS description
     FROM CPXDATA X LEFT JOIN PARTS P ON P.PRT_COD = X.CPLX_PRT_COD
     WHERE X.PRT_COD = :pn`,
    { pn: partNumber },
    lang,
  );
  const kits = all(`SELECT DISTINCT CPLX_PRT_COD AS kit, CAT_COD AS catalogue FROM KIT WHERE PRT_COD = :pn`, {
    pn: partNumber,
  });
  return {
    total: rows.length,
    truncated: rows.length > limit,
    tables: rows.slice(0, limit),
    component_of_assemblies: assemblies,
    component_of_kits: kits,
  };
}

// Image path and reference-number hotspots of a table drawing.
export function getDrawingImage(cat, grp, sgrp, sgs, variante) {
  const drawing = get(
    `SELECT IMG_PATH, VARIANTE, REVISIONE, TABLE_COD FROM DRAWINGS
     WHERE CAT_COD = :cat AND GRP_COD = :grp AND SGRP_COD = :sgrp AND SGS_COD = :sgs
       ${variante != null ? 'AND VARIANTE = :variante' : ''}
     ORDER BY DRW_NUM`,
    { cat, grp, sgrp, sgs, variante },
  );
  if (!drawing) return null;
  const refs = all(
    `SELECT DISTINCT TBD_RIF AS ref, PRT_COD AS part_number, HOTSPOTS AS hotspots FROM TBDATA
     WHERE CAT_COD = :cat AND GRP_COD = :grp AND SGRP_COD = :sgrp AND SGS_COD = :sgs
       AND VARIANTE = :variante AND REVISIONE = :revisione`,
    { cat, grp, sgrp, sgs, variante: drawing.VARIANTE, revisione: drawing.REVISIONE },
  );
  return {
    imgPath: drawing.IMG_PATH,
    title: `${cat} ${grp}/${sgrp}/${sgs} variante ${drawing.VARIANTE} (table ${drawing.TABLE_COD})`,
    refs,
  };
}

// Exploded views (cliché) of an assembly, with component hotspots.
export function getAssemblyImages(partNumber) {
  return all(
    `SELECT CPD_NUM, IMG_PATH FROM CLICHE WHERE CPLX_PRT_COD = :pn ORDER BY CPD_NUM`,
    { pn: partNumber },
  ).map((c) => ({
    imgPath: c.IMG_PATH,
    title: `assembly ${partNumber} view ${c.CPD_NUM}`,
    refs: all(
      `SELECT DISTINCT CPD_RIF AS ref, PRT_COD AS part_number, HOTSPOTS AS hotspots FROM CPXDATA
       WHERE CPLX_PRT_COD = :pn AND CPD_NUM = :num`,
      { pn: partNumber, num: c.CPD_NUM },
    ),
  }));
}

export function getAssembly(partNumber, lang) {
  return all(
    `SELECT X.CPD_RIF AS ref, X.CPD_RIF_SEQ AS seq, X.PRT_COD AS part_number, X.CPD_QTY AS quantity, X.MODIF AS modif,
            ${dsc('CODES_DSC', 'CDS_DSC', 'CDS_COD = X.PRT_CDS_COD')} AS description,
            ${dsc('DESC_AGG_DSC', 'DSC', 'COD = X.CPD_AGG_DSC')} AS extra_description
     FROM CPXDATA X WHERE X.CPLX_PRT_COD = :pn ORDER BY X.CPD_NUM, X.CPD_RIF, X.CPD_RIF_SEQ`,
    { pn: partNumber },
    lang,
  );
}

const HALF = 'ｦｧｨｩｪｫｬｭｮｯｰｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ';
const FULL = 'ヲァィゥェォャュョッーアイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン';
const DAKUTEN = { ガ: 'ｶﾞ', ギ: 'ｷﾞ', グ: 'ｸﾞ', ゲ: 'ｹﾞ', ゴ: 'ｺﾞ', ザ: 'ｻﾞ', ジ: 'ｼﾞ', ズ: 'ｽﾞ', ゼ: 'ｾﾞ', ゾ: 'ｿﾞ',
  ダ: 'ﾀﾞ', ヂ: 'ﾁﾞ', ヅ: 'ﾂﾞ', デ: 'ﾃﾞ', ド: 'ﾄﾞ', バ: 'ﾊﾞ', ビ: 'ﾋﾞ', ブ: 'ﾌﾞ', ベ: 'ﾍﾞ', ボ: 'ﾎﾞ',
  パ: 'ﾊﾟ', ピ: 'ﾋﾟ', プ: 'ﾌﾟ', ペ: 'ﾍﾟ', ポ: 'ﾎﾟ', ヴ: 'ｳﾞ', '・': '･' };

// The DB stores Japanese as halfwidth katakana (output is NFKC-normalised for readability).
export function toHalfwidthKatakana(s) {
  return [...s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))]
    .map((c) => DAKUTEN[c] ?? (FULL.includes(c) ? HALF[FULL.indexOf(c)] : c))
    .join('');
}
