/**
 * Shared-secret auth for the daemon's loopback control server.
 * Kept dependency-free so both controlServer.ts and controlClient.ts can import it.
 */
import { createHash, timingSafeEqual } from 'node:crypto';

export const DAEMON_CONTROL_TOKEN_HEADER = 'x-happy-daemon-token';

/** Constant-time comparison. Hashing first equalises length so timingSafeEqual never throws. */
export function daemonTokensEqual(provided: unknown, expected: string): boolean {
  if (typeof provided !== 'string' || provided.length === 0) return false;
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}
