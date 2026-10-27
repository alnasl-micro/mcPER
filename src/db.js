import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

let db;
const statements = new Map();

export function getDb() {
  if (!db) {
    if (!fs.existsSync(config.dbPath)) {
      throw new Error(`SQLite database not found at ${config.dbPath}. Run "npm run build-data" first (see README).`);
    }
    db = new DatabaseSync(config.dbPath, { readOnly: true });
  }
  return db;
}

function prepare(sql) {
  let s = statements.get(sql);
  if (!s) {
    s = getDb().prepare(sql);
    statements.set(sql, s);
  }
  return s;
}

// Named parameters (:name). :lang and :fb (fallback language) are always bound.
function bind(params, lang) {
  return { lang: lang ?? config.defaultLanguage, fb: config.fallbackLanguage, ...params };
}

function usedParams(sql, params) {
  const used = {};
  for (const [k, v] of Object.entries(params)) if (new RegExp(`:${k}\\b`).test(sql)) used[k] = v;
  return used;
}

export function all(sql, params = {}, lang) {
  return prepare(sql).all(usedParams(sql, bind(params, lang))).map(clean);
}

export function get(sql, params = {}, lang) {
  const row = prepare(sql).get(usedParams(sql, bind(params, lang)));
  return row ? clean(row) : undefined;
}

// SQL for a description in the requested language, falling back to English.
// e.g. dsc('CODES_DSC', 'CDS_DSC', 'CDS_COD = P.CDS_COD')
export function dsc(table, column, where) {
  return `COALESCE((SELECT ${column} FROM ${table} WHERE ${where} AND LNG_COD = :lang),
                   (SELECT ${column} FROM ${table} WHERE ${where} AND LNG_COD = :fb))`;
}

// Japanese descriptions are half-width katakana; NFKC makes them readable.
function clean(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = typeof v === 'string' ? v.normalize('NFKC').trim() : v;
  }
  return out;
}
