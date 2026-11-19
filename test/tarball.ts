// Builds tar.gz fixtures in memory for the tests.

export type TarEntry = { path: string; data?: string | Uint8Array; type?: string; linkname?: string };

const enc = new TextEncoder();

export function tar(entries: TarEntry[]): Uint8Array<ArrayBuffer> {
  const blocks: Uint8Array[] = [];
  for (const e of entries) {
    const data = typeof e.data === "string" ? enc.encode(e.data) : (e.data ?? new Uint8Array());
    const header = new Uint8Array(512);
    header.set(enc.encode(e.path).subarray(0, 100), 0);
    header.set(enc.encode("0000644\0"), 100);
    header.set(enc.encode("0000000\0"), 108);
    header.set(enc.encode("0000000\0"), 116);
    header.set(enc.encode(`${data.length.toString(8).padStart(11, "0")}\0`), 124);
    header.set(enc.encode("00000000000\0"), 136);
    header.set(enc.encode(e.type ?? "0"), 156);
    header.set(enc.encode(e.linkname ?? ""), 157);
    header.set(enc.encode("ustar\x0000"), 257);
    header.fill(0x20, 148, 156);
    const sum = header.reduce((a, b) => a + b, 0);
    header.set(enc.encode(`${sum.toString(8).padStart(6, "0")}\0 `), 148);
    blocks.push(header, data, new Uint8Array((512 - (data.length % 512)) % 512));
  }
  blocks.push(new Uint8Array(1024));
  const out = new Uint8Array(blocks.reduce((n, b) => n + b.length, 0));
  let at = 0;
  for (const b of blocks) {
    out.set(b, at);
    at += b.length;
  }
  return out;
}

export function tarGz(entries: TarEntry[]): Uint8Array {
  return Bun.gzipSync(tar(entries));
}

/** A pax `x` header that renames the next entry. */
export function paxPath(path: string): TarEntry {
  const body = ` path=${path}\n`;
  let len = body.length;
  len += String(len + String(len).length).length;
  return { path: "PaxHeader", type: "x", data: `${len}${body}` };
}

export const WASM = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x0d, 0x00, 0x01, 0x00]);

export const MANIFEST = `id = "pixel"
name = "Pixel"
version = "1.2.0"
api = 1
net = ["api.example.com"]

[[steps]]
name = "pixelate"
label = "Pixelate"
role = "filter"

[[steps]]
name = "badge"
role = "shape"

[[steps.props]]
key = "fill"
label = "Fill"
kind = "color"
default = 0xFF3B30FF
`;
