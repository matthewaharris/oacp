/**
 * OACP SDK — Local contacts (RFC 002 §3)
 *
 * The address book pins counterparty public keys next to the agent's own
 * keypair. Keys are truth; handles and names are convenience. Local-first:
 * the registry's friendship edge is authority for *access* (who may message
 * a closed agent), this file is authority for *identity* (which key we
 * trust for a counterparty).
 */

import * as fs from 'fs';
import * as path from 'path';

export interface Contact {
  agent_id: string;
  /** Ed25519 public key pinned at friendship establishment (hex) */
  public_key: string;
  handle?: string | null;
  name?: string;
  note?: string;
  pinned_at: string;
  /** How the pin was established: 'code' (out-of-band, strongest) or 'tofu' */
  via: 'code' | 'tofu';
}

export function loadContacts(filePath: string): Record<string, Contact> {
  try {
    const raw = fs.readFileSync(path.resolve(filePath), 'utf-8');
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export function saveContact(filePath: string, contact: Contact): void {
  const resolved = path.resolve(filePath);
  const contacts = loadContacts(resolved);
  contacts[contact.agent_id] = contact;
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, JSON.stringify(contacts, null, 2), { mode: 0o600 });
}

/** Drop a pinned contact. Returns false if it wasn't pinned. */
export function deleteContact(filePath: string, agentId: string): boolean {
  const resolved = path.resolve(filePath);
  const contacts = loadContacts(resolved);
  if (!(agentId in contacts)) return false;
  delete contacts[agentId];
  fs.writeFileSync(resolved, JSON.stringify(contacts, null, 2), { mode: 0o600 });
  return true;
}

export function getContact(filePath: string, agentId: string): Contact | null {
  return loadContacts(filePath)[agentId] ?? null;
}

/**
 * Verify a counterparty's current key against the pinned one.
 * Returns null when there is no pin or the key matches; otherwise a
 * human-readable warning that MUST be surfaced before proceeding.
 */
export function checkPin(
  filePath: string,
  agentId: string,
  currentKey: string,
): string | null {
  const contact = getContact(filePath, agentId);
  if (!contact || contact.public_key === currentKey) return null;
  return (
    `KEY CHANGE for ${contact.handle || contact.name || agentId}: pinned ` +
    `${contact.public_key.substring(0, 16)}… but the registry now reports ` +
    `${currentKey.substring(0, 16)}…. This can mean a legitimate re-install — or a hijacked ` +
    `registration. Verify with the human out of band before trusting; re-pin by re-adding the friend.`
  );
}
