// One registry entry → one index.json record. `describePackage` is pure; `resolveEntry` adds the GitHub I/O.

import { z } from "zod";
import type { Entry } from "./entry.ts";
import { CheckError } from "./errors.ts";
import { type Asset, download, latestRelease, type Release } from "./github.ts";
import { checkManifestForEntry, parseManifest } from "./manifest.ts";
import { MAX_PACKAGE_BYTES, PACKAGE_SUFFIX, readPackage } from "./package.ts";

export const IndexPlugin = z.strictObject({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  repo: z.string(),
  version: z.string(),
  tag: z.string(),
  asset_url: z.url(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  size: z.number().int().nonnegative(),
  net: z.array(z.string()),
  steps: z.array(z.strictObject({ name: z.string(), label: z.string(), role: z.enum(["filter", "sink", "shape"]) })),
});
export type IndexPlugin = z.infer<typeof IndexPlugin>;

/** The single `*.clikplugin.tar.gz` asset of a release. */
export function pickAsset(release: Release): Asset {
  const matches = release.assets.filter((a) => a.name.endsWith(PACKAGE_SUFFIX));
  const [only] = matches;
  if (only === undefined) throw new CheckError(`release ${release.tag_name} has no *${PACKAGE_SUFFIX} asset`);
  if (matches.length > 1) {
    throw new CheckError(`release ${release.tag_name} has ${matches.length} *${PACKAGE_SUFFIX} assets; publish exactly one`);
  }
  return only;
}

/** Validate a downloaded package against its entry and build the index record. */
export function describePackage(entry: Entry, tag: string, asset: Asset, bytes: Uint8Array): IndexPlugin {
  const manifest = parseManifest(readPackage(bytes).manifestToml);
  checkManifestForEntry(manifest, entry.id);
  const expectedName = `${manifest.id}-${manifest.version}${PACKAGE_SUFFIX}`;
  if (asset.name !== expectedName) throw new CheckError(`asset is named ${asset.name}; plugin.toml says it should be ${expectedName}`);
  return {
    id: entry.id,
    name: manifest.name,
    description: entry.description,
    repo: entry.repo,
    version: manifest.version,
    tag,
    asset_url: asset.browser_download_url,
    sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
    size: bytes.length,
    net: manifest.net,
    steps: manifest.steps,
  };
}

export async function resolveEntry(entry: Entry, token: string | undefined): Promise<IndexPlugin> {
  const release = await latestRelease(entry.repo, token);
  const asset = pickAsset(release);
  if (asset.size > MAX_PACKAGE_BYTES) throw new CheckError(`${asset.name} is ${asset.size} bytes, over the ${MAX_PACKAGE_BYTES}-byte limit`);
  const bytes = await download(asset.browser_download_url, MAX_PACKAGE_BYTES);
  return describePackage(entry, release.tag_name, asset, bytes);
}
