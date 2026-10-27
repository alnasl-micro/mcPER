import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Data folder built by scripts/build-data.js; ePER itself is not needed at runtime.
const dataDir = process.env.MCPER_DATA_DIR ?? path.join(root, 'data', 'pack');

export const config = {
  dataDir,
  dbPath: path.join(dataDir, 'eper84.sqlite'),
  chassisPath: path.join(dataDir, 'vin', 'SP.CH.FCTLR'),
  buildDataPath: path.join(dataDir, 'vin', 'SP.RT.FCTLR'),
  imagesDir: path.join(dataDir, 'images'),
  defaultLanguage: process.env.MCPER_LANG ?? 'J',
  fallbackLanguage: '3',
};

// The ePER installation, read only by scripts/build-data.js.
const eperDir = process.env.EPER_DIR ?? 'C:\\Program Files (x86)\\Fiat\\ePER';
const release = process.env.EPER_DATA_RELEASE ?? '04210';
const eperData = path.join(eperDir, 'data');

export const eperSource = {
  eperDir,
  release,
  spDbPath: path.join(eperData, `SP.DB.${release}.FCTLR`),
  chassisPath: path.join(eperData, `SP.CH.${release}.FCTLR`),
  buildDataPath: path.join(eperData, `SP.RT.${release}.FCTLR`),
  imagesDir: path.join(eperData, 'images'),
};
