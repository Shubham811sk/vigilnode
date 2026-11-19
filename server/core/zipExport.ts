import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const EXCLUDED_DIRS = new Set([
  'node_modules',
  'dist',
  'data',
  '.data',
  '.git',
  '.vite',
  '.aistudio',
]);

const EXCLUDED_FILES = new Set([
  '.env',
  '.DS_Store',
]);

function toDosTimeDate(mtime: Date): { dosTime: number; dosDate: number } {
  const year = Math.max(1980, mtime.getUTCFullYear());
  const month = mtime.getUTCMonth() + 1;
  const day = mtime.getUTCDate();
  const hours = mtime.getUTCHours();
  const minutes = mtime.getUTCMinutes();
  const seconds = Math.floor(mtime.getUTCSeconds() / 2);
  const dosTime = (hours << 11) | (minutes << 5) | seconds;
  const dosDate = ((year - 1980) << 9) | (month << 5) | day;
  return { dosTime, dosDate };
}

export function collectProjectSourceFiles(rootDir: string): Array<{ relPath: string; absPath: string; mtime: Date }> {
  const results: Array<{ relPath: string; absPath: string; mtime: Date }> = [];

  const walk = (currentDir: string, relPrefix: string) => {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) continue;
        const nextRel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
        walk(path.join(currentDir, entry.name), nextRel);
      } else if (entry.isFile()) {
        if (EXCLUDED_FILES.has(entry.name)) continue;
        if (entry.name.endsWith('.db') || entry.name.endsWith('.db-wal') || entry.name.endsWith('.db-shm') || entry.name.endsWith('.zip')) {
          continue;
        }
        const absPath = path.join(currentDir, entry.name);
        const stat = fs.statSync(absPath);
        const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
        results.push({ relPath, absPath, mtime: stat.mtime });
      }
    }
  };

  walk(rootDir, '');
  return results;
}

export function createZipBuffer(entries: Array<{ name: string; data: Buffer; mtime?: Date }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const crc = zlib.crc32(entry.data) >>> 0;
    const compressed = zlib.deflateRawSync(entry.data, { level: 6 });
    const { dosTime, dosDate } = toDosTimeDate(entry.mtime || new Date());

    // Local file header (30 bytes + filename)
    const localHeader = Buffer.alloc(30 + nameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 flag
    localHeader.writeUInt16LE(8, 8); // deflate
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(entry.data.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    nameBuf.copy(localHeader, 30);

    localParts.push(localHeader, compressed);

    // Central directory header (46 bytes + filename)
    const centralHeader = Buffer.alloc(46 + nameBuf.length);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0x0800, 8); // UTF-8 flag
    centralHeader.writeUInt16LE(8, 10); // deflate
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(entry.data.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    nameBuf.copy(centralHeader, 46);

    centralParts.push(centralHeader);
    offset += localHeader.length + compressed.length;
  }

  const centralDirBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirBuf, eocd]);
}

export function buildProjectSourceZipBuffer(rootDir = process.cwd()): { buffer: Buffer; fileCount: number } {
  const files = collectProjectSourceFiles(rootDir);
  const entries = files.map((f) => ({
    name: `vigilnode/${f.relPath}`,
    data: fs.readFileSync(f.absPath),
    mtime: f.mtime,
  }));
  return {
    buffer: createZipBuffer(entries),
    fileCount: entries.length,
  };
}
