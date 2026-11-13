import { createReadStream, createWriteStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';

const BLOCK = 512;
const DEFAULT_EXCLUDES = ['.git', '.git/**', 'node_modules', 'node_modules/**', '.DS_Store', '*.log', '*.tmp'];

function escapeRegex(text) {
  return text.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

/** Translate one glob-lite pattern into a path regex. */
export function globToRegExp(pattern) {
  const normalized = String(pattern).replace(/^\.\//, '').replace(/\\/g, '/');
  let source = '';
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    if (char === '*') {
      if (normalized[index + 1] === '*') {
        source += '.*';
        index += 1;
        if (normalized[index + 1] === '/') index += 1;
      } else {
        source += '[^/]*';
      }
    } else if (char === '?') {
      source += '[^/]';
    } else if (char === '/') {
      source += '/';
    } else {
      source += escapeRegex(char);
    }
  }
  return new RegExp(`^${source}$`);
}

/** Is a relative POSIX path excluded by the configured patterns? */
export function isExcluded(relativePath, patterns = DEFAULT_EXCLUDES) {
  const path = String(relativePath).replace(/^\.\//, '');
  const base = path.split('/').pop() ?? path;
  return patterns.some(pattern => {
    const candidate = String(pattern);
    // A bare name matches that name at any depth (`node_modules`, `*.log`).
    if (!candidate.includes('/')) {
      const regex = globToRegExp(candidate);
      if (regex.test(base)) return true;
      const segments = path.split('/');
      return segments.some(segment => regex.test(segment));
    }
    return globToRegExp(candidate).test(path);
  });
}

/**
 * Windows reports synthetic modes (0666 for every file). Normalize there so an
 * archive built on Windows is identical to one built on Linux; POSIX keeps its
 * real permission bits, including the executable bit.
 */
function portableMode(info, directory) {
  if (process.platform === 'win32') return directory ? 0o755 : 0o644;
  return info.mode & 0o777;
}

function writeString(buffer, offset, length, value) {
  const text = String(value);
  const bytes = Buffer.from(text, 'utf8');
  bytes.copy(buffer, offset, 0, Math.min(bytes.length, length));
}

function writeOctal(buffer, offset, length, value) {
  const text = Math.max(0, Math.floor(Number(value) || 0)).toString(8);
  const padded = text.padStart(length - 1, '0').slice(-(length - 1));
  buffer.write(padded, offset, length - 1, 'ascii');
  buffer[offset + length - 1] = 0;
}

function splitName(name) {
  if (Buffer.byteLength(name) <= 100) return { name, prefix: '' };
  // ustar splits long paths at a slash: prefix <= 155 bytes, name <= 100 bytes.
  for (let index = name.length - 1; index > 0; index -= 1) {
    if (name[index] !== '/') continue;
    const prefix = name.slice(0, index);
    const suffix = name.slice(index + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(suffix) <= 100) {
      return { name: suffix, prefix };
    }
  }
  throw new Error(`path is too long for a ustar archive: ${name}`);
}

/**
 * Build one ustar header block.
 * @param {{ name: string, size?: number, mode?: number, mtime?: number, type?: 'file'|'dir' }} entry
 * @returns {Buffer} 512-byte header.
 */
export function buildTarHeader(entry) {
  const header = Buffer.alloc(BLOCK, 0);
  const name = String(entry.name).replace(/^\/+/, '');
  const { name: shortName, prefix } = splitName(name);
  writeString(header, 0, 100, shortName);
  writeOctal(header, 100, 8, entry.mode ?? (entry.type === 'dir' ? 0o755 : 0o644));
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, entry.type === 'dir' ? 0 : entry.size ?? 0);
  writeOctal(header, 136, 12, entry.mtime ?? Math.floor(Date.now() / 1000));
  // Checksum is computed with the field filled by spaces.
  header.fill(0x20, 148, 156);
  header[156] = entry.type === 'dir' ? 0x35 : 0x30;
  writeString(header, 257, 6, 'ustar\0');
  writeString(header, 263, 2, '00');
  writeString(header, 265, 32, 'root');
  writeString(header, 297, 32, 'root');
  writeOctal(header, 329, 8, 0);
  writeOctal(header, 337, 8, 0);
  writeString(header, 345, 155, prefix);

  let sum = 0;
  for (const byte of header) sum += byte;
  const checksum = sum.toString(8).padStart(6, '0');
  header.write(checksum, 148, 6, 'ascii');
  header[154] = 0;
  header[155] = 0x20;
  return header;
}

function writeChunk(stream, chunk) {
  return new Promise((resolve, reject) => {
    const onError = error => {
      stream.removeListener('drain', onDrain);
      reject(error);
    };
    const onDrain = () => {
      stream.removeListener('error', onError);
      resolve();
    };
    if (stream.write(chunk)) {
      resolve();
      return;
    }
    stream.once('drain', onDrain);
    stream.once('error', onError);
  });
}

async function collect(directory, base, entries, skipped, options) {
  const children = await readdir(directory, { withFileTypes: true });
  children.sort((a, b) => a.name.localeCompare(b.name));
  for (const child of children) {
    if (options.signal?.aborted) throw new Error('cancelled');
    const full = join(directory, child.name);
    const rel = relative(base, full).split(sep).join('/');
    if (isExcluded(rel, options.exclude)) {
      skipped.push({ path: rel, reason: 'excluded' });
      continue;
    }
    if (child.isSymbolicLink()) {
      skipped.push({ path: rel, reason: 'symbolic link (not packed)' });
      continue;
    }
    if (child.isDirectory()) {
      const info = await stat(full);
      entries.push({ rel, full, type: 'dir', mode: portableMode(info, true), mtime: Math.floor(info.mtimeMs / 1000) });
      if (entries.length > options.maxEntries) throw new Error(`more than ${options.maxEntries} entries`);
      await collect(full, base, entries, skipped, options);
      continue;
    }
    if (child.isFile()) {
      const info = await stat(full);
      if (info.size > options.maxFileBytes) {
        skipped.push({ path: rel, reason: `larger than ${options.maxFileBytes} bytes` });
        continue;
      }
      entries.push({
        rel,
        full,
        type: 'file',
        size: info.size,
        mode: portableMode(info, false),
        mtime: Math.floor(info.mtimeMs / 1000),
      });
      if (entries.length > options.maxEntries) throw new Error(`more than ${options.maxEntries} entries`);
      continue;
    }
    skipped.push({ path: rel, reason: 'not a regular file or directory' });
  }
}

/**
 * Pack a directory into a gzipped ustar archive, streaming file contents so a
 * large project never has to fit in memory.
 *
 * @param {{
 *   root: string,
 *   outFile: string,
 *   exclude?: string[],
 *   maxFileBytes?: number,
 *   maxTotalBytes?: number,
 *   maxEntries?: number,
 *   signal?: AbortSignal,
 * }} options
 * @returns {Promise<{ outFile: string, files: number, directories: number, bytes: number, skipped: Array<{path: string, reason: string}> }>}
 */
export async function createTarball(options) {
  const {
    root,
    outFile,
    exclude = DEFAULT_EXCLUDES,
    maxFileBytes = 256 * 1024 * 1024,
    maxTotalBytes = 2 * 1024 * 1024 * 1024,
    maxEntries = 50_000,
    signal,
  } = options;

  const info = await stat(root).catch(() => null);
  if (!info || !info.isDirectory()) throw new Error(`localPath is not a directory: ${root}`);

  const entries = [];
  const skipped = [];
  await collect(root, root, entries, skipped, { exclude, signal, maxFileBytes, maxEntries });

  const gzip = createGzip({ level: 9 });
  const output = createWriteStream(outFile);
  const done = pipeline(gzip, output);

  let totalBytes = 0;
  let fileCount = 0;
  let directoryCount = 0;

  for (const entry of entries) {
    if (signal?.aborted) throw new Error('cancelled');
    await writeChunk(gzip, buildTarHeader({
      name: entry.type === 'dir' ? `${entry.rel}/` : entry.rel,
      size: entry.size ?? 0,
      mode: entry.mode,
      mtime: entry.mtime,
      type: entry.type,
    }));
    if (entry.type === 'dir') {
      directoryCount += 1;
      continue;
    }
    fileCount += 1;
    totalBytes += entry.size ?? 0;
    if (totalBytes > maxTotalBytes) {
      gzip.destroy();
      throw new Error(`packed size exceeds maxTotalBytes (${maxTotalBytes})`);
    }
    for await (const chunk of createReadStream(entry.full)) {
      if (signal?.aborted) {
        gzip.destroy();
        throw new Error('cancelled');
      }
      await writeChunk(gzip, chunk);
    }
    const padding = (BLOCK - ((entry.size ?? 0) % BLOCK)) % BLOCK;
    if (padding > 0) await writeChunk(gzip, Buffer.alloc(padding, 0));
  }

  // Two empty blocks terminate the archive.
  await writeChunk(gzip, Buffer.alloc(BLOCK * 2, 0));
  gzip.end();
  await done;

  const archive = await stat(outFile);
  return { outFile, files: fileCount, directories: directoryCount, bytes: archive.size, contentBytes: totalBytes, skipped };
}
