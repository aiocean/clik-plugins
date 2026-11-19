// GitHub I/O: the latest release of a repo and a capped asset download.

import { z } from "zod";
import { CheckError, TransientError } from "./errors.ts";

const Release = z.object({
  tag_name: z.string(),
  assets: z.array(z.object({ name: z.string(), browser_download_url: z.url(), size: z.number().int().nonnegative() })),
});
export type Release = z.infer<typeof Release>;
export type Asset = Release["assets"][number];

const TIMEOUT_MS = 60_000;

export async function latestRelease(repo: string, token: string | undefined): Promise<Release> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "clik-plugins-indexer",
  };
  if (token !== undefined && token !== "") headers.Authorization = `Bearer ${token}`;
  const res = await request(`https://api.github.com/repos/${repo}/releases/latest`, headers);
  if (res.status === 404) throw new CheckError(`${repo} has no published release (or the repository does not exist or is private)`);
  if (!res.ok) throw httpError(res, `GitHub API for ${repo}`);
  const parsed = Release.safeParse(await res.json());
  if (!parsed.success) throw new TransientError(`unexpected GitHub API response for ${repo}: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

/** Download `url`, aborting as soon as the body passes `maxBytes`. */
export async function download(url: string, maxBytes: number): Promise<Uint8Array> {
  const res = await request(url, { "User-Agent": "clik-plugins-indexer" });
  if (!res.ok) throw httpError(res, `download of ${url}`);
  const body = res.body;
  if (body === null) throw new TransientError(`download of ${url} returned no body`);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of body) {
    total += chunk.length;
    if (total > maxBytes) {
      await body.cancel();
      throw new CheckError(`${url} is over the ${maxBytes}-byte limit`);
    }
    chunks.push(chunk);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

async function request(url: string, headers: Record<string, string>): Promise<Response> {
  try {
    return await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    throw new TransientError(`request to ${url} failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** 5xx, 429 and rate-limit 403 are worth retrying; other statuses mean the release is broken. */
function httpError(res: Response, what: string): Error {
  const message = `${what} returned HTTP ${res.status}`;
  const rateLimited = res.status === 429 || (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0");
  return res.status >= 500 || rateLimited ? new TransientError(message) : new CheckError(message);
}
