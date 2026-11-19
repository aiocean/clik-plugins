/** The entry or its release is broken; the author has to fix it. */
export class CheckError extends Error {
  override name = "CheckError";
}

/** GitHub or the network failed (5xx, rate limit, timeout); retrying later may succeed. */
export class TransientError extends Error {
  override name = "TransientError";
}
