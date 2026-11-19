// Registry entries: `plugins/<id>.toml` with `repo` and `description`. Pure.

import { parse as parseToml } from "smol-toml";
import { z } from "zod";
import { CheckError } from "./errors.ts";
import { BUNDLED_IDS, ID_PATTERN } from "./manifest.ts";

const RawEntry = z.strictObject({
  repo: z.string().regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/, 'must be "owner/name" of a GitHub repository'),
  description: z
    .string()
    .trim()
    .min(1, "must not be empty")
    .max(140, "must be at most 140 characters")
    .refine((s) => !/[\r\n]/.test(s), "must be one line"),
});

export type Entry = { id: string; repo: string; description: string };

/** One entry file. `fileName` is the name inside plugins/, e.g. `pixelate.toml`. */
export function parseEntry(fileName: string, text: string): Entry {
  const id = entryId(fileName);
  let value: unknown;
  try {
    value = parseToml(text);
  } catch (e) {
    throw new CheckError(`plugins/${fileName}: invalid TOML: ${e instanceof Error ? e.message : String(e)}`);
  }
  const parsed = RawEntry.safeParse(value);
  if (!parsed.success) throw new CheckError(`plugins/${fileName}:\n${z.prettifyError(parsed.error)}`);
  return { id, repo: parsed.data.repo, description: parsed.data.description };
}

/** The id an entry file names; throws for anything that is not `<id>.toml`. */
export function entryId(fileName: string): string {
  const match = /^(.*)\.toml$/.exec(fileName);
  const id = match?.[1];
  if (id === undefined) throw new CheckError(`plugins/${fileName}: plugins/ holds only <id>.toml files`);
  if (!ID_PATTERN.test(id)) throw new CheckError(`plugins/${fileName}: the id ${JSON.stringify(id)} may contain only a-z, 0-9 and -`);
  if (BUNDLED_IDS.has(id)) throw new CheckError(`plugins/${fileName}: the id ${JSON.stringify(id)} is reserved for a plugin bundled with clik`);
  return id;
}

/** Cross-entry rules. Returns one message per problem. */
export function registryErrors(entries: Entry[]): string[] {
  const errors: string[] = [];
  const byRepo = new Map<string, string>();
  for (const e of entries) {
    const key = e.repo.toLowerCase(); // GitHub names are case-insensitive
    const other = byRepo.get(key);
    if (other !== undefined) errors.push(`plugins/${e.id}.toml: repo ${e.repo} is already listed by plugins/${other}.toml`);
    else byRepo.set(key, e.id);
  }
  return errors;
}
