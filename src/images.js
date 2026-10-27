// Drawing images from images\*.res (copied from ePER's data\images by build-data.js).
// Each .res is a plain ZIP archive; IMG_PATH "6F/6F90...E781.png" is entry "6F90...E781.png" in 6F.res.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { PNG } from 'pngjs';
import { config } from './config.js';

const archives = new Map();

function readAt(fd, pos, length) {
  const b = Buffer.alloc(length);
  const n = fs.readSync(fd, b, 0, length, pos);
  return b.subarray(0, n);
}

function openArchive(name, dir = config.imagesDir) {
  const file = path.join(dir, `${name}.res`);
  if (archives.has(file)) return archives.get(file);
  if (!fs.existsSync(file)) {
    archives.set(file, null);
    return null;
  }
  const fd = fs.openSync(file, 'r');
  const size = fs.fstatSync(fd).size;
  // End of central directory record is in the last 64KB + 22 bytes.
  const tailLength = Math.min(size, 65557);
  const tail = readAt(fd, size - tailLength, tailLength);
  const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error(`${file}: not a ZIP archive`);
  const count = tail.readUInt16LE(eocd + 10);
  const cdSize = tail.readUInt32LE(eocd + 12);
  const cdOffset = tail.readUInt32LE(eocd + 16);
  const cd = readAt(fd, cdOffset, cdSize);
  const entries = new Map();
  let p = 0;
  for (let i = 0; i < count && cd.readUInt32LE(p) === 0x02014b50; i++) {
    const method = cd.readUInt16LE(p + 10);
    const compressedSize = cd.readUInt32LE(p + 20);
    const nameLength = cd.readUInt16LE(p + 28);
    const extraLength = cd.readUInt16LE(p + 30);
    const commentLength = cd.readUInt16LE(p + 32);
    const localOffset = cd.readUInt32LE(p + 42);
    const entryName = cd.toString('latin1', p + 46, p + 46 + nameLength);
    entries.set(entryName.toUpperCase(), { name: entryName, method, compressedSize, localOffset, central: [p, 46 + nameLength + extraLength + commentLength] });
    p += 46 + nameLength + extraLength + commentLength;
  }
  const archive = { file, fd, entries, centralDirectory: cd };
  archives.set(file, archive);
  return archive;
}

/**
 * Writes a copy of archive `name` (e.g. "6F") in sourceDir holding only the entries accepted by
 * keep(entryName), byte-for-byte (no recompression). Returns the number of entries written.
 */
export function copyArchive(sourceDir, name, target, keep) {
  const archive = openArchive(name, sourceDir);
  if (!archive) return 0;
  const out = fs.openSync(target, 'w');
  const central = [];
  let offset = 0;
  try {
    for (const entry of archive.entries.values()) {
      if (!keep(entry.name)) continue;
      const header = readAt(archive.fd, entry.localOffset, 30);
      const length = 30 + header.readUInt16LE(26) + header.readUInt16LE(28) + entry.compressedSize;
      fs.writeSync(out, readAt(archive.fd, entry.localOffset, length));
      const [p, size] = entry.central;
      const record = Buffer.from(archive.centralDirectory.subarray(p, p + size));
      record.writeUInt32LE(offset, 42);
      central.push(record);
      offset += length;
    }
    const cd = Buffer.concat(central);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(central.length, 8);
    eocd.writeUInt16LE(central.length, 10);
    eocd.writeUInt32LE(cd.length, 12);
    eocd.writeUInt32LE(offset, 16);
    fs.writeSync(out, cd);
    fs.writeSync(out, eocd);
  } finally {
    fs.closeSync(out);
  }
  return central.length;
}

// imgPath: "6F/6F9024C5FF65E4532B110A46F915E781.png" (or "L_EPERFIG/xxx.png")
export function readImage(imgPath) {
  if (!imgPath) return null;
  const [dir, file] = imgPath.includes('/') ? imgPath.split('/') : [imgPath.slice(0, 2), imgPath];
  const archive = openArchive(dir);
  const entry = archive?.entries.get(file.toUpperCase());
  if (!entry) return null;
  const header = readAt(archive.fd, entry.localOffset, 30);
  const dataStart = entry.localOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
  const data = readAt(archive.fd, dataStart, entry.compressedSize);
  if (entry.method === 0) return data;
  if (entry.method === 8) return zlib.inflateRawSync(data);
  throw new Error(`Unsupported ZIP compression method ${entry.method}`);
}

// "x1,y1,x2,y2;x1,y1,x2,y2" -> [[x1, y1, x2, y2], ...]
export function parseHotspots(text) {
  return (text ?? '')
    .replace(/^L->/, '')
    .split(';')
    .map((s) => s.split(',').map(Number))
    .filter((r) => r.length >= 4 && r.slice(0, 4).every(Number.isFinite))
    .map((r) => r.slice(0, 4));
}

/**
 * Draws red frames around the given rectangles (reference-number labels).
 * Returns a new RGBA PNG buffer.
 */
export function highlight(png, rects, { margin = 12, thickness = 8 } = {}) {
  const image = PNG.sync.read(png);
  const { width, height, data } = image;
  const paint = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = (y * width + x) * 4;
    data[i] = 230; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 255;
  };
  for (const [x1, y1, x2, y2] of rects) {
    const l = Math.min(x1, x2) - margin, r = Math.max(x1, x2) + margin;
    const t = Math.min(y1, y2) - margin, b = Math.max(y1, y2) + margin;
    for (let k = 0; k < thickness; k++) {
      for (let x = l - k; x <= r + k; x++) { paint(x, t - k); paint(x, b + k); }
      for (let y = t - k; y <= b + k; y++) { paint(l - k, y); paint(r + k, y); }
    }
  }
  return PNG.sync.write(image, { colorType: 6 });
}

export function mimeType(imgPath) {
  const ext = path.extname(imgPath ?? '').toLowerCase();
  return ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.gif' ? 'image/gif' : 'image/png';
}
