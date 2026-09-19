import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time string comparison for secrets (internal-route bearer
 * tokens, webhook signatures, etc.). A plain `===`/`!==` comparison leaks
 * timing information proportional to how many leading characters match,
 * which a network attacker can in principle exploit to guess a secret
 * byte-by-byte. `crypto.timingSafeEqual` requires equal-length buffers, so
 * a length mismatch is checked — and rejected — before it, without ever
 * comparing the buffers' contents.
 */
export function secretEquals(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);

  if (bufferA.length !== bufferB.length) {
    return false;
  }

  return timingSafeEqual(bufferA, bufferB);
}
