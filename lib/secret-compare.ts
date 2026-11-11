import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time comparison of a presented secret with the expected one. Hashing first makes the
 * buffers the same length (timingSafeEqual requires that) without leaking the real length.
 * An unset expected secret never matches anything.
 */
export function secretMatches(presented: string | null | undefined, expected: string | undefined): boolean {
  if (!expected || !presented) return false;
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
