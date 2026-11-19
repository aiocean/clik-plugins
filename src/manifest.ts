// plugin.toml, with the same rules as the app (clik/crates/plugin-host/src/manifest.rs). Pure.

import { parse as parseToml } from "smol-toml";
import { z } from "zod";
import { CheckError } from "./errors.ts";

export const API = 1;
/** Ids of plugins shipped inside clik.app; a registry plugin may not reuse them. */
export const BUNDLED_IDS: ReadonlySet<string> = new Set(["clik"]);

export const ID_PATTERN = /^[a-z0-9-]+$/;
// semver.org's reference pattern.
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

const Role = z.enum(["filter", "sink", "shape"]);

const PropKind = z.union([
  z.enum(["bool", "text", "color"]),
  z.strictObject({ number: z.strictObject({ min: z.number(), max: z.number() }) }),
  z.strictObject({ enum: z.array(z.string()) }),
]);

const RawManifest = z.strictObject({
  id: z.string(),
  name: z.string(),
  version: z.string().regex(SEMVER, "must be a semver version like 1.2.3"),
  api: z.number().int().nonnegative(),
  steps: z
    .array(
      z.strictObject({
        name: z.string(),
        label: z.string().optional(),
        role: Role,
        needs_render: z.boolean().optional(),
        icon: z.string().optional(),
        frame: z
          .strictObject({
            top: z.number().nonnegative().optional(),
            right: z.number().nonnegative().optional(),
            bottom: z.number().nonnegative().optional(),
            left: z.number().nonnegative().optional(),
            url: z.string().optional(),
          })
          .optional(),
        props: z
          .array(z.strictObject({ key: z.string(), label: z.string(), kind: PropKind, default: z.unknown() }))
          .default([]),
      }),
    )
    .default([]),
  net: z.array(z.string()).default([]),
  config: z.array(z.strictObject({ key: z.string(), label: z.string(), secret: z.boolean().optional() })).default([]),
});

export type Step = { name: string; label: string; role: z.infer<typeof Role> };
export type Manifest = { id: string; name: string; version: string; api: number; net: string[]; steps: Step[] };

/** Parse and validate plugin.toml exactly as clik does; throws CheckError with the reason. */
export function parseManifest(toml: string): Manifest {
  let value: unknown;
  try {
    value = parseToml(toml);
  } catch (e) {
    throw new CheckError(`invalid plugin.toml: ${e instanceof Error ? e.message : String(e)}`);
  }
  const parsed = RawManifest.safeParse(value);
  if (!parsed.success) throw new CheckError(`invalid plugin.toml:\n${z.prettifyError(parsed.error)}`);
  const raw = parsed.data;

  if (raw.api !== API) throw new CheckError(`unsupported api ${raw.api} (clik supports api ${API})`);
  if (raw.id === "") throw new CheckError("plugin id is empty");
  if (!ID_PATTERN.test(raw.id)) throw new CheckError(`plugin id ${JSON.stringify(raw.id)} may contain only a-z, 0-9 and -`);
  const seen = new Set<string>();
  for (const step of raw.steps) {
    if (seen.has(step.name)) throw new CheckError(`step ${JSON.stringify(step.name)} is declared twice`);
    seen.add(step.name);
  }
  const badHost = raw.net.find((h) => !isBareHostname(h));
  if (badHost !== undefined) throw new CheckError(`net entry ${JSON.stringify(badHost)} is not a bare hostname`);
  for (const step of raw.steps) {
    const urlProp = step.frame?.url;
    const urlOk = urlProp === undefined || step.props.some((p) => p.key === urlProp && p.kind === "text");
    if (step.frame !== undefined && (step.role !== "shape" || !urlOk)) {
      throw new CheckError(`step ${JSON.stringify(step.name)}: frame is only for shape steps, with insets of 0 or more and url naming a text prop`);
    }
    for (const prop of step.props) {
      const reason = propDefaultError(prop.kind, prop.default);
      if (reason !== undefined) {
        throw new CheckError(`prop ${JSON.stringify(prop.key)} of step ${JSON.stringify(step.name)}: default must be ${reason}`);
      }
    }
  }

  return {
    id: raw.id,
    name: raw.name,
    version: raw.version,
    api: raw.api,
    net: raw.net,
    steps: raw.steps.map((s) => ({ name: s.name, label: s.label ?? s.name, role: s.role })),
  };
}

/** Registry rules on top of the app's: the package belongs to this entry and does not shadow a bundled plugin. */
export function checkManifestForEntry(manifest: Manifest, entryId: string): void {
  if (manifest.id !== entryId) {
    throw new CheckError(`plugin.toml id is ${JSON.stringify(manifest.id)}, but the entry is plugins/${entryId}.toml`);
  }
  if (BUNDLED_IDS.has(manifest.id)) throw new CheckError(`id ${JSON.stringify(manifest.id)} is reserved for a plugin bundled with clik`);
}

/** `api.linear.app`: labels of `a-z 0-9 -`, no scheme, port, path or wildcard. */
function isBareHostname(host: string): boolean {
  return host !== "" && host.split(".").every((l) => l !== "" && !l.startsWith("-") && !l.endsWith("-") && /^[a-z0-9-]+$/.test(l));
}

function propDefaultError(kind: z.infer<typeof PropKind>, value: unknown): string | undefined {
  if (kind === "bool") return typeof value === "boolean" ? undefined : "a boolean";
  if (kind === "text") return typeof value === "string" ? undefined : "a string";
  if (kind === "color") {
    return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 0xffffffff ? undefined : "0xRRGGBBAA";
  }
  if ("number" in kind) {
    if (typeof value !== "number") return "a number";
    return kind.number.min <= value && value <= kind.number.max ? undefined : "within min..=max";
  }
  return typeof value === "string" && kind.enum.includes(value) ? undefined : "one of the enum options";
}
