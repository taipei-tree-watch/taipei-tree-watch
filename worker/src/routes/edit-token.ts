/**
 * Edit tokens: the secret half of an edit link.
 *
 * A token is 32 random bytes, handed to the reporter once in the 201 response
 * and never stored. D1 keeps only its SHA-256, so a leaked database export or
 * backup cannot be turned into edit links. The token is unrelated to the
 * report id, which is why a permalink says nothing about how to edit it.
 */
import { EDIT_TOKEN_BYTES, isEditToken } from '../../../shared/validation.ts';

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function newEditToken(): string {
  const bytes = new Uint8Array(EDIT_TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

/** sha256(token) as lowercase hex, the form stored in `edit_token_hash`. */
export async function hashEditToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * The token from `Authorization: Bearer <token>`, or null when the header is
 * absent or does not carry something shaped like a token.
 *
 * A header rather than a query parameter, so the secret stays out of access
 * logs and out of any cache key.
 */
export function readBearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (header === null) {
    return null;
  }
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  if (match === null) {
    return null;
  }
  const token = match[1] ?? '';
  return isEditToken(token) ? token : null;
}
