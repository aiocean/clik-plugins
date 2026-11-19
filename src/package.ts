// A `<id>-<version>.clikplugin.tar.gz` package: gunzip, untar, find the plugin files. Pure.

import { gunzipSync } from "node:zlib";
import { CheckError } from "./errors.ts";
import { readTar, type TarFile } from "./tar.ts";

/** Largest package the app accepts (compressed). */
export const MAX_PACKAGE_BYTES = 25 * 1024 * 1024;
/** Cap on the unpacked tar, so a gzip bomb cannot exhaust memory. */
export const MAX_UNPACKED_BYTES = 100 * 1024 * 1024;

export const PACKAGE_SUFFIX = ".clikplugin.tar.gz";

export type PluginPackage = { manifestToml: string; wasm: Uint8Array };

const WASM_MAGIC = [0x00, 0x61, 0x73, 0x6d];

export function readPackage(gz: Uint8Array): PluginPackage {
  if (gz.length > MAX_PACKAGE_BYTES) throw new CheckError(`package is ${gz.length} bytes, over the ${MAX_PACKAGE_BYTES}-byte limit`);
  const files = readTar(gunzip(gz));
  const appleDouble = files.find((f) => f.path.split("/").some((s) => s.startsWith("._")));
  if (appleDouble !== undefined) {
    throw new CheckError(`package holds macOS metadata file ${appleDouble.path}; build it with COPYFILE_DISABLE=1 tar ...`);
  }
  const root = pluginRoot(files);
  const manifest = files.find((f) => f.path === `${root}plugin.toml`);
  const wasm = files.find((f) => f.path === `${root}plugin.wasm`);
  if (manifest === undefined) throw new CheckError("package has no plugin.toml");
  if (wasm === undefined) throw new CheckError("package has no plugin.wasm");
  if (!WASM_MAGIC.every((b, i) => wasm.data[i] === b)) throw new CheckError("plugin.wasm is not a WebAssembly file");
  let manifestToml: string;
  try {
    manifestToml = new TextDecoder("utf-8", { fatal: true }).decode(manifest.data);
  } catch {
    throw new CheckError("plugin.toml is not valid UTF-8");
  }
  return { manifestToml, wasm: wasm.data };
}

function gunzip(gz: Uint8Array): Uint8Array {
  try {
    return gunzipSync(gz, { maxOutputLength: MAX_UNPACKED_BYTES });
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new CheckError(`package is not a valid gzip under ${MAX_UNPACKED_BYTES} unpacked bytes: ${reason}`);
  }
}

/** `""` when plugin.toml sits at the root, `"<dir>/"` when everything sits in one top-level folder. */
function pluginRoot(files: TarFile[]): string {
  if (files.some((f) => f.path === "plugin.toml")) return "";
  const tops = new Set(files.map((f) => f.path.split("/")[0]));
  const [only] = tops;
  if (tops.size === 1 && only !== undefined && files.some((f) => f.path === `${only}/plugin.toml`)) return `${only}/`;
  throw new CheckError("package must hold plugin.toml and plugin.wasm at its root or in one top-level folder");
}
