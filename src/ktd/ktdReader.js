// Reader for ePER's KTD "F3" flat files (SP.CH, SP.RT, ...).
// Port of openPER's VinSearcher/KtdReader.
import fs from 'node:fs';
import Bunzip from 'seek-bzip';

const TYPE_REFERENCE = 0;
const TYPE_STRING = 1;

class Cursor {
  constructor(fd, pos = 0) { this.fd = fd; this.pos = pos; }
  bytes(n) {
    const b = Buffer.alloc(n);
    const read = fs.readSync(this.fd, b, 0, n, this.pos);
    if (read !== n) throw new Error(`Unexpected end of file at ${this.pos}`);
    this.pos += n;
    return b;
  }
  u8() { return this.bytes(1)[0]; }
  u16() { return this.bytes(2).readUInt16LE(0); }
  u32() { return this.bytes(4).readUInt32LE(0); }
}

function readItem(c) {
  const raw = c.bytes(20);
  const end = raw.indexOf(0);
  return {
    name: raw.toString('latin1', 0, end < 0 ? 20 : end),
    type: c.u8(),
    start: c.u8(),
    length: c.u8(),
  };
}

export class KtdFile {
  constructor(path, lengthPrefixBytes) {
    this.path = path;
    this.lengthPrefixBytes = lengthPrefixBytes;
    this.fd = fs.openSync(path, 'r');
    this.#readHeader();
    this.#readPrimaryIndex();
  }

  #readHeader() {
    const c = new Cursor(this.fd);
    const version = c.bytes(2).toString('latin1');
    if (version !== 'F3') throw new Error(`${this.path}: unsupported KTD version "${version}"`);
    c.u32(); c.u16();
    const refPositions = Array.from({ length: 5 }, () => c.u32());
    this.primaryIndexPos = c.u32();
    for (let i = 0; i < 3; i++) c.u32();
    const tableName = c.bytes(20);
    this.tableName = tableName.toString('latin1', 0, Math.max(0, tableName.indexOf(0)));

    const pk = Array.from({ length: c.u8() }, () => readItem(c));
    const nSec = c.u8();
    for (let j = 0; j < nSec; j++) {
      const n = c.u8();
      for (let i = 0; i < n; i++) readItem(c);
    }
    const nCols = c.u8();
    if (nCols > 30) throw new Error(`${this.path}: corrupted header`);
    this.columns = Array.from({ length: nCols }, () => readItem(c));
    this.primaryKeyLength = pk.reduce((s, x) => s + x.length, 0);

    let packed = 0, ref = 0;
    for (const col of this.columns) {
      col.packedPos = packed;
      if (col.type === TYPE_REFERENCE) { col.refIndex = ref++; packed += 2; }
      else if (col.type === TYPE_STRING) { col.refIndex = -1; packed += col.length; }
      else throw new Error(`Unknown column type ${col.type}`);
    }
    this.referenceAddition = this.columns
      .filter((x) => x.type === TYPE_REFERENCE)
      .reduce((s, x) => s + x.length - 2, 0);

    this.referenceTables = [];
    for (const pos of refPositions) {
      if (pos === 0) break;
      const rc = new Cursor(this.fd, pos);
      const count = rc.u32();
      const width = rc.u32();
      const all = rc.bytes(count * width);
      this.referenceTables.push(Array.from({ length: count }, (_, i) => all.subarray(i * width, (i + 1) * width)));
    }
    this.columnNames = this.columns.map((x) => x.name);
  }

  #readPrimaryIndex() {
    const c = new Cursor(this.fd, this.primaryIndexPos);
    const count = c.u32();
    const entry = this.primaryKeyLength + 8;
    const all = c.bytes(count * entry);
    this.index = new Array(count);
    for (let i = 0; i < count; i++) {
      const o = i * entry;
      this.index[i] = {
        key: all.toString('latin1', o, o + this.primaryKeyLength).toUpperCase(),
        start: all.readUInt32LE(o + this.primaryKeyLength),
        end: all.readUInt32LE(o + this.primaryKeyLength + 4),
      };
    }
  }

  // Index keys are sorted; the block holding searchKey is the first whose key >= searchKey.
  #findBlock(searchKey) {
    const key = searchKey.toUpperCase();
    let lo = 0, hi = this.index.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.index[mid].key < key) lo = mid + 1; else hi = mid;
    }
    return this.index[lo] ?? null;
  }

  #unpackRecord(line) {
    const result = Buffer.alloc(line.length + this.referenceAddition);
    for (const col of this.columns) {
      if (col.type === TYPE_REFERENCE) {
        const refValue = this.referenceTables[col.refIndex][line.readUInt16LE(col.packedPos)];
        refValue.copy(result, col.start, 0, col.length);
      } else {
        const len = col.length === 0 ? result.length - col.start : col.length;
        line.copy(result, col.start, col.packedPos, col.packedPos + len);
      }
    }
    const record = {};
    for (const col of this.columns) {
      const len = col.length === 0 ? result.length - col.start : col.length;
      record[col.name] = result.toString('latin1', col.start, col.start + len);
    }
    return record;
  }

  // Returns the records in the block that may contain searchKey, filtered by match(record).
  find(searchKey, match) {
    const block = this.#findBlock(searchKey);
    if (!block) return [];
    const c = new Cursor(this.fd, block.start);
    const data = Bunzip.decode(c.bytes(block.end - block.start));
    const out = [];
    let pos = 0;
    while (pos < data.length) {
      let len = data[pos];
      if (this.lengthPrefixBytes === 2) len += data[pos + 1] << 8;
      const record = this.#unpackRecord(data.subarray(pos + this.lengthPrefixBytes, pos + len));
      pos += len;
      if (match(record)) out.push(record);
    }
    return out;
  }
}
