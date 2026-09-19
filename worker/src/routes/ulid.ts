/**
 * ULID generator: a 26-character Crockford base32 identifier whose first 10
 * characters encode the millisecond timestamp, so ids sort chronologically as
 * plain text and the primary key stays monotonic without a sequence.
 *
 * Implemented here rather than pulled from a package: the whole algorithm is
 * one timestamp encode plus 16 random characters.
 */

/** Crockford base32: no I, L, O or U, so the alphabet has no lookalike pairs. */
const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TIME_LENGTH = 10;
const RANDOM_LENGTH = 16;

/** Largest timestamp representable in 10 base32 characters (about year 10889). */
const MAX_TIME = 32 ** TIME_LENGTH - 1;

function encodeTime(timestamp: number): string {
  if (!Number.isInteger(timestamp) || timestamp < 0 || timestamp > MAX_TIME) {
    throw new RangeError(`Timestamp ${timestamp} cannot be encoded as a ULID`);
  }
  let remaining = timestamp;
  let encoded = '';
  for (let index = 0; index < TIME_LENGTH; index += 1) {
    encoded = ENCODING.charAt(remaining % 32) + encoded;
    remaining = Math.floor(remaining / 32);
  }
  return encoded;
}

function encodeRandom(): string {
  // 256 is a multiple of 32, so taking a byte modulo 32 stays uniform.
  const bytes = crypto.getRandomValues(new Uint8Array(RANDOM_LENGTH));
  let encoded = '';
  for (const byte of bytes) {
    encoded += ENCODING.charAt(byte % 32);
  }
  return encoded;
}

export function ulid(timestamp: number = Date.now()): string {
  return encodeTime(timestamp) + encodeRandom();
}
