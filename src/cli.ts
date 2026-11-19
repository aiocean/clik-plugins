// Shell: read plugins/, talk to GitHub, write index.json.
//   bun run check [ids...]   validate entries and their latest releases; non-zero on any problem
//   bun run index            rebuild index.json; broken plugins are skipped and reported
//   bun src/cli.ts inspect <file.clikplugin.tar.gz>   run the package checks on a local file

import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { type Entry, entryId, parseEntry, registryErrors } from "./entry.ts";
import { CheckError } from "./errors.ts";
import { parseManifest } from "./manifest.ts";
import { readPackage } from "./package.ts";
import { describePackage, IndexPlugin, resolveEntry } from "./plugin.ts";

const ROOT = join(import.meta.dir, "..");
const PLUGINS_DIR = join(ROOT, "plugins");
const INDEX_PATH = join(ROOT, "index.json");

const Index = z.strictObject({ schema: z.literal(1), generated: z.iso.datetime(), plugins: z.array(IndexPlugin) });
type Index = z.infer<typeof Index>;

const token = process.env.GITHUB_TOKEN;

async function loadRegistry(): Promise<{ entries: Entry[]; errors: string[] }> {
  const names = (await readdir(PLUGINS_DIR)).filter((n) => n !== ".gitkeep").sort();
  const entries: Entry[] = [];
  const errors: string[] = [];
  for (const name of names) {
    try {
      entries.push(parseEntry(name, await Bun.file(join(PLUGINS_DIR, name)).text()));
    } catch (e) {
      errors.push(message(e));
    }
  }
  return { entries, errors: [...errors, ...registryErrors(entries)] };
}

async function check(ids: string[]): Promise<number> {
  const { entries, errors } = await loadRegistry();
  for (const id of ids) {
    try {
      entryId(`${id}.toml`);
      if (!entries.some((e) => e.id === id) && !errors.some((m) => m.startsWith(`plugins/${id}.toml`))) {
        errors.push(`plugins/${id}.toml does not exist`);
      }
    } catch (e) {
      errors.push(message(e));
    }
  }
  if (errors.length > 0) return fail(errors);

  const targets = ids.length === 0 ? entries : entries.filter((e) => ids.includes(e.id));
  if (targets.length === 0) console.log("no entries to check");
  let failed = 0;
  for (const entry of targets) {
    try {
      const p = await resolveEntry(entry, token);
      console.log(`ok   ${p.id} ${p.version} (${p.tag}, ${p.size} bytes, sha256 ${p.sha256})${netNote(p.net)}`);
    } catch (e) {
      failed++;
      console.error(`FAIL ${entry.id} (${entry.repo}): ${message(e)}`);
    }
  }
  return failed === 0 ? 0 : 1;
}

async function buildIndex(): Promise<number> {
  const { entries, errors } = await loadRegistry();
  if (errors.length > 0) return fail(errors);

  const previous = await readIndex();
  const previousById = new Map((previous?.plugins ?? []).map((p) => [p.id, p]));
  const plugins: IndexPlugin[] = [];
  for (const entry of entries) {
    try {
      plugins.push(await resolveEntry(entry, token));
      console.log(`ok   ${entry.id}`);
    } catch (e) {
      const kept = e instanceof CheckError ? undefined : previousById.get(entry.id);
      if (kept !== undefined) {
        plugins.push({ ...kept, description: entry.description, repo: entry.repo });
        console.error(`KEEP ${entry.id}: ${message(e)} (kept the previous record)`);
      } else {
        console.error(`SKIP ${entry.id} (${entry.repo}): ${message(e)}`);
      }
    }
  }
  plugins.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  if (previous !== undefined && JSON.stringify(previous.plugins) === JSON.stringify(plugins)) {
    console.log(`index.json unchanged (${plugins.length} plugins)`);
    return 0;
  }
  const index: Index = { schema: 1, generated: new Date().toISOString(), plugins };
  await Bun.write(INDEX_PATH, `${JSON.stringify(index, null, 2)}\n`);
  console.log(`wrote index.json (${plugins.length} plugins)`);
  return 0;
}

/** The current index.json, or undefined when it is missing or not a valid index. */
async function readIndex(): Promise<Index | undefined> {
  const file = Bun.file(INDEX_PATH);
  if (!(await file.exists())) return undefined;
  try {
    const parsed = Index.safeParse(await file.json());
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

async function inspect(path: string | undefined): Promise<number> {
  if (path === undefined) return fail(["usage: bun src/cli.ts inspect <file.clikplugin.tar.gz>"]);
  try {
    const bytes = await Bun.file(path).bytes();
    const id = parseManifest(readPackage(bytes).manifestToml).id;
    const entry: Entry = { id, repo: "local/local", description: "(local file)" };
    const asset = { name: basename(path), browser_download_url: pathToFileURL(path).href, size: bytes.length };
    console.log(JSON.stringify(describePackage(entry, "local", asset, bytes), null, 2));
    return 0;
  } catch (e) {
    return fail([message(e)]);
  }
}

function netNote(net: string[]): string {
  return net.length === 0 ? "" : `\n     net: ${net.join(", ")} (the PR must explain why)`;
}

function fail(errors: string[]): number {
  for (const e of errors) console.error(`error: ${e}`);
  return 1;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const [command, ...args] = process.argv.slice(2);
const code =
  command === "check" ? await check(args)
  : command === "index" ? await buildIndex()
  : command === "inspect" ? await inspect(args[0])
  : fail([`unknown command ${JSON.stringify(command)}; use check [ids...], index or inspect <file>`]);
process.exit(code);
