/**
 * OACP SDK — Sealed Payloads (RFC 001 §4, oacp/v2-draft)
 *
 * End-to-end encryption for message payloads. Every agent's Ed25519
 * identity key converts deterministically to X25519 (RFC 7748), so any
 * registered agent can receive sealed payloads with zero new key
 * management.
 *
 * Scheme: x25519-hkdf-xchacha20poly1305
 *   1. Random 32-byte content encryption key (CEK); payload JSON is
 *      encrypted with XChaCha20-Poly1305 under the CEK.
 *   2. One ephemeral X25519 keypair per message; the CEK is wrapped
 *      separately for each reader (recipient AND sender, so your own
 *      outbox stays readable) via X25519 ECDH → HKDF-SHA256 → AEAD.
 *   3. The registry relays the sealed object opaquely; the Ed25519
 *      envelope signature covers it unchanged.
 *
 * All primitives are audited @noble libraries — no hand-rolled crypto.
 * Known limitation (documented in RFC 001 §4.2): no forward secrecy in
 * v1 — a stolen agent key decrypts that agent's history.
 */

import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { toHex, fromHex, type OACPKeypair } from './crypto.js';

export const SEAL_ALG = 'x25519-hkdf-xchacha20poly1305';
export const SEAL_VERSION = 1;

const CEK_BYTES = 32;
const NONCE_BYTES = 24;

/** Wire format of a sealed payload (RFC 001 §4.1). */
export interface SealedPayload extends Record<string, unknown> {
  sealed: true;
  v: number;
  alg: string;
  /** Ephemeral X25519 public key, hex */
  epk: string;
  /** 24-byte content nonce, hex */
  nonce: string;
  /** AEAD(payload JSON), base64 */
  ciphertext: string;
  /** agent_id → wrapped CEK, hex(nonce ‖ AEAD(CEK)) */
  keys: Record<string, string>;
}

/** A reader who will be able to open the sealed payload. */
export interface SealReader {
  agentId: string;
  /** The reader's Ed25519 identity public key, hex (from their agent card) */
  ed25519PublicKey: string;
}

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/** Derive the per-reader CEK wrap key: HKDF-SHA256 over the ECDH secret. */
function wrapKeyFor(sharedSecret: Uint8Array, epk: Uint8Array, agentId: string): Uint8Array {
  return hkdf(sha256, sharedSecret, epk, utf8(`oacp-seal-v${SEAL_VERSION}:${agentId}`), 32);
}

/** Type guard: does this payload look like a sealed payload envelope? */
export function isSealedPayload(payload: unknown): payload is SealedPayload {
  if (typeof payload !== 'object' || payload === null) return false;
  const p = payload as Record<string, unknown>;
  return (
    p.sealed === true &&
    typeof p.epk === 'string' &&
    typeof p.nonce === 'string' &&
    typeof p.ciphertext === 'string' &&
    typeof p.keys === 'object' &&
    p.keys !== null
  );
}

/**
 * Seal a payload for a set of readers.
 *
 * Include the sender in `readers` (with their own agent_id and public
 * key) so the sender's outbox copy stays decryptable. Sealing needs no
 * secret key — only the readers' public identity keys.
 */
export function sealPayload(
  payload: Record<string, unknown>,
  readers: SealReader[],
): SealedPayload {
  if (readers.length === 0) {
    throw new Error('[OACP] sealPayload requires at least one reader');
  }

  const cek = randomBytes(CEK_BYTES);
  const nonce = randomBytes(NONCE_BYTES);
  const ciphertext = xchacha20poly1305(cek, nonce).encrypt(utf8(JSON.stringify(payload)));

  const ephSecret = x25519.utils.randomSecretKey();
  const epk = x25519.getPublicKey(ephSecret);

  const keys: Record<string, string> = {};
  for (const reader of readers) {
    const readerXPub = ed25519.utils.toMontgomery(fromHex(reader.ed25519PublicKey));
    const sharedSecret = x25519.getSharedSecret(ephSecret, readerXPub);
    const wrapKey = wrapKeyFor(sharedSecret, epk, reader.agentId);
    const wrapNonce = randomBytes(NONCE_BYTES);
    const wrapped = xchacha20poly1305(wrapKey, wrapNonce).encrypt(cek);
    keys[reader.agentId] = toHex(wrapNonce) + toHex(wrapped);
  }

  return {
    sealed: true,
    v: SEAL_VERSION,
    alg: SEAL_ALG,
    epk: toHex(epk),
    nonce: toHex(nonce),
    ciphertext: Buffer.from(ciphertext).toString('base64'),
    keys,
  };
}

/**
 * Unseal a payload with this agent's Ed25519 keypair.
 *
 * Throws if the sealed object has no wrapped key for `agentId`, if the
 * algorithm/version is unknown, or if authentication fails (tampered
 * ciphertext or wrong key).
 */
export function unsealPayload(
  sealed: SealedPayload,
  keypair: OACPKeypair,
  agentId: string,
): Record<string, unknown> {
  if (sealed.alg !== SEAL_ALG || sealed.v !== SEAL_VERSION) {
    throw new Error(`[OACP] Unsupported seal scheme: ${sealed.alg} v${sealed.v}`);
  }

  const wrappedHex = sealed.keys[agentId];
  if (!wrappedHex) {
    throw new Error(`[OACP] Sealed payload has no key for agent ${agentId} — not a designated reader`);
  }

  const xSecret = ed25519.utils.toMontgomerySecret(fromHex(keypair.secretKey));
  const epk = fromHex(sealed.epk);
  const sharedSecret = x25519.getSharedSecret(xSecret, epk);
  const wrapKey = wrapKeyFor(sharedSecret, epk, agentId);

  const wrapNonce = fromHex(wrappedHex.slice(0, NONCE_BYTES * 2));
  const wrapped = fromHex(wrappedHex.slice(NONCE_BYTES * 2));
  const cek = xchacha20poly1305(wrapKey, wrapNonce).decrypt(wrapped);

  const plaintext = xchacha20poly1305(cek, fromHex(sealed.nonce)).decrypt(
    new Uint8Array(Buffer.from(sealed.ciphertext, 'base64')),
  );

  return JSON.parse(new TextDecoder().decode(plaintext)) as Record<string, unknown>;
}
