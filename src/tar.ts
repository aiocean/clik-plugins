// Minimal tar reader for plugin packages. Pure: bytes in, files out.
// Accepts regular files and directories only; rejects links, devices and unsafe paths.

import { CheckError } from "./errors.ts";

export type TarFile = { path: string; data: Uint8Array };

const BLOCK = 512;
const decoder = new TextDecoder("utf-8", { fatal: true });

/** Every regular file in the archive, paths normalised (no `./`, no trailing `/`). */
export function readTar(tar: Uint8Array): TarFile[] {
  const files: TarFile[] = [];
  const seen = new Set<string>();
  let nextPath: string | undefined; // from a pax `x` header or a GNU `L` record
  let offset = 0;

  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK);
    if (header.every((b) => b === 0)) break; // end-of-archive marker
    verifyChecksum(header, offset);

    const size = readOctal(header.subarray(124, 136), "size");
    const type = String.fromCharCode(header[156] ?? 0);
    const dataStart = offset + BLOCK;
    const dataEnd = dataStart + size;
    if (dataEnd > tar.length) throw new CheckError(`tar entry at byte ${offset} runs past the end of the archive`);
    const data = tar.subarray(dataStart, dataEnd);
    offset = dataStart + Math.ceil(size / BLOCK) * BLOCK;

    switch (type) {
      case "x":
        nextPath = paxPath(data) ?? nextPath;
        continue;
      case "g":
        continue; // global pax attributes carry nothing clik uses
      case "L":
        nextPath = decode(data).replace(/\0+$/, "");
        continue;
      case "0":
      case "\0":
      case "7":
      case "5": {
        const raw = nextPath ?? headerPath(header);
        nextPath = undefined;
        if (type === "5") {
          if (raw.replace(/^(\.\/)+/, "") !== "" && raw !== ".") safePath(raw); // `./` itself is the archive root
          continue;
        }
        const path = safePath(raw);
        if (seen.has(path)) throw new CheckError(`tar holds ${path} twice`);
        seen.add(path);
        files.push({ path, data });
        continue;
      }
      default:
        throw new CheckError(`tar entry ${headerPath(header)} is not a regular file (type ${JSON.stringify(type)})`);
    }
  }
  return files;
}

/** `a/b.svg` from `./a/b.svg` or `a/`; rejects absolute paths, `..`, backslashes and NUL. */
export function safePath(raw: string): string {
  const trimmed = raw.replace(/^(\.\/)+/, "").replace(/\/+$/, "");
  if (trimmed === "" || trimmed === ".") throw new CheckError(`tar entry has an empty path`);
  if (trimmed.startsWith("/")) throw new CheckError(`tar entry ${raw} has an absolute path`);
  if (/[\\\0]/.test(trimmed)) throw new CheckError(`tar entry ${JSON.stringify(raw)} has a backslash or NUL in its path`);
  const segments = trimmed.split("/");
  if (segments.some((s) => s === ".." || s === "." || s === "")) {
    throw new CheckError(`tar entry ${raw} has an unsafe path`);
  }
  return trimmed;
}

function headerPath(header: Uint8Array): string {
  const name = cString(header.subarray(0, 100));
  const isUstar = cString(header.subarray(257, 262)) === "ustar";
  const prefix = isUstar ? cString(header.subarray(345, 500)) : "";
  return prefix === "" ? name : `${prefix}/${name}`;
}

/** The `path` record of a pax extended header (`"<len> path=<value>\n"` records). */
function paxPath(data: Uint8Array): string | undefined {
  let path: string | undefined;
  let i = 0;
  while (i < data.length) {
    const space = data.indexOf(0x20, i);
    if (space < 0) break;
    const len = Number.parseInt(decode(data.subarray(i, space)), 10);
    if (!Number.isInteger(len) || len <= 0 || i + len > data.length) throw new CheckError("tar has a malformed pax header");
    // Values such as SCHILY.xattr.* are raw bytes, so decode only the `path` value.
    const record = data.subarray(space + 1, i + len - 1); // drop the trailing newline
    const eq = record.indexOf(0x3d);
    if (eq > 0 && decode(record.subarray(0, eq)) === "path") path = decode(record.subarray(eq + 1));
    i += len;
  }
  return path;
}

function verifyChecksum(header: Uint8Array, offset: number): void {
  const stored = readOctal(header.subarray(148, 156), "checksum");
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : (header[i] ?? 0);
  if (sum !== stored) throw new CheckError(`tar header at byte ${offset} has a bad checksum (not a tar file?)`);
}

function readOctal(field: Uint8Array, what: string): number {
  if (((field[0] ?? 0) & 0x80) !== 0) throw new CheckError(`tar ${what} uses base-256, too large for a plugin`);
  const text = cString(field).trim();
  if (text === "") return 0;
  if (!/^[0-7]+$/.test(text)) throw new CheckError(`tar ${what} field is not octal: ${JSON.stringify(text)}`);
  return Number.parseInt(text, 8);
}

function cString(field: Uint8Array): string {
  const nul = field.indexOf(0);
  return decode(nul < 0 ? field : field.subarray(0, nul));
}

function decode(bytes: Uint8Array): string {
  try {
    return decoder.decode(bytes);
  } catch {
    throw new CheckError("tar holds a path that is not valid UTF-8");
  }
}
