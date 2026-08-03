/**
 * OACP SDK — Ratchet state store (RFC 001 §5.2)
 *
 * Per-thread forward-secrecy state, next to the keypair like contacts.json.
 * This file IS the forward-secrecy boundary: deleting a thread's entry is
 * what makes its captured ciphertext permanently undecryptable, so the
 * store deletes aggressively (ephemeral secrets the moment the thread key
 * exists, message keys after one use) and never logs key material.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { RatchetState } from './mailbox.js';

export function ratchetThreadKey(peerId: string, correlationId: string): string {
  return `${peerId}:${correlationId}`;
}

export function loadRatchets(filePath: string): Record<string, RatchetState> {
  try {
    const raw = fs.readFileSync(path.resolve(filePath), 'utf-8');
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export function saveRatchet(filePath: string, key: string, state: RatchetState): void {
  const resolved = path.resolve(filePath);
  const all = loadRatchets(resolved);
  all[key] = { ...state, updated_at: new Date().toISOString() };
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, JSON.stringify(all, null, 2), { mode: 0o600 });
}

/** Forward secrecy lever: after this, the thread's ciphertext is gone for good. */
export function deleteRatchet(filePath: string, key: string): boolean {
  const resolved = path.resolve(filePath);
  const all = loadRatchets(resolved);
  if (!(key in all)) return false;
  delete all[key];
  fs.writeFileSync(resolved, JSON.stringify(all, null, 2), { mode: 0o600 });
  return true;
}
