// Builds dist/easymarker-<version>.zip, the file uploaded to the Chrome Web Store.
// Usage: npm run package
//
// Dependency-free and cross-platform (Windows, macOS, Linux). Entries get a fixed
// timestamp so the same sources always produce the same archive.

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve(import.meta.dirname, '..');
const SOURCE = path.join(ROOT, 'extension');
const DIST = path.join(ROOT, 'dist');

const manifest = JSON.parse(await readFile(path.join(SOURCE, 'manifest.json'), 'utf8'));
if (!/^\d+(\.\d+){0,3}$/.test(manifest.version)) {
  throw new Error(`manifest.json: "${manifest.version}" is not a valid Chrome extension version`);
}

const files = (await readdir(SOURCE, { recursive: true, withFileTypes: true }))
  .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
  .map((entry) => path.relative(SOURCE, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
  .sort();

const zip = await buildZip(files.map((name) => ({ name, read: () => readFile(path.join(SOURCE, name)) })));
const output = path.join(DIST, `easymarker-${manifest.version}.zip`);
await mkdir(DIST, { recursive: true });
await writeFile(output, zip);
console.log(`${path.relative(ROOT, output)}  (${files.length} files, ${(zip.length / 1024).toFixed(1)} KB)`);

/**
 * Minimal ZIP writer (deflate, UTF-8 names, no ZIP64: fine for an extension).
 * @param {{ name: string, read: () => Promise<Buffer> }[]} entries
 */
async function buildZip(entries) {
  const DOS_TIME = 0;
  const DOS_DATE = (1 << 5) | 1; // 1980-01-01
  const UTF8_FLAG = 0x0800;
  const DEFLATE = 8;

  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const data = await entry.read();
    const compressed = zlib.deflateRawSync(data, { level: 9 });
    const name = Buffer.from(entry.name, 'utf8');
    const crc = zlib.crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed to extract
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(DEFLATE, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra field length

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed to extract
    central.writeUInt16LE(UTF8_FLAG, 8);
    central.writeUInt16LE(DEFLATE, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    // extra length, comment length, disk number, internal and external attributes: 0
    central.writeUInt32LE(offset, 42);

    localParts.push(local, name, compressed);
    centralParts.push(central, name);
    offset += local.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...localParts, centralDirectory, end]);
}
