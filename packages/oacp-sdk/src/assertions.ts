/**
 * OACP SDK — Assertions (RFC 007 §2)
 *
 * A message payload may carry an `assertions` block: discrete claims, each
 * labeled with how the sender knows it. The status set is closed on
 * purpose — the whole value is that it cannot be fudged into vagueness.
 *
 *   measured  — I performed an observation and this is its result
 *   reported  — another party told me; I am relaying, not vouching
 *   assumed   — I inferred this; no observation backs it
 *   refuted   — I checked and it is false
 *
 * This is not truth enforcement (nothing stops an agent writing `measured`
 * about something it assumed) — it is legibility, auditability, and
 * consequence: a claim carries its method and an evidence digest, disputes
 * (§3) have an exact address, and reputation (§4) can count.
 *
 * Evidence is DIGESTS ONLY: the registry timestamps a sha256 commitment;
 * the parties hold the artifact and produce it on dispute. A digest
 * committed at claim time cannot be retro-fabricated to match a later
 * story — the hash froze it.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { toHex } from './crypto.js';

export const ASSERTION_STATUSES = ['measured', 'reported', 'assumed', 'refuted'] as const;
export type AssertionStatus = (typeof ASSERTION_STATUSES)[number];

export interface Assertion {
  /** The discrete factual claim, stated so it can be true or false. */
  claim: string;
  status: AssertionStatus;
  /** For measured/refuted: what observation was performed. */
  method?: string;
  /** For reported/assumed: where this came from / what it rests on. */
  basis?: string;
  /** sha256 commitment to the supporting artifact ("sha256:<hex>"). */
  evidence_digest?: string;
  /** When the observation was made, ISO 8601. */
  observed_at?: string;
}

/** A dispute against one claim of one message (RFC 007 §3). */
export interface AssertionDispute {
  dispute_id: string;
  message_id: string;
  claim_index: number;
  claim_digest: string;
  disputed_agent_id: string;
  disputer_agent_id: string;
  verdict: 'refuted' | 'unsupported';
  assertion: Assertion;
  response?: Assertion | null;
  responded_at?: string | null;
  created_at: string;
}

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/** Commit to an evidence artifact: sha256 over its bytes (or utf8 text). */
export function digestEvidence(artifact: string | Uint8Array): string {
  const bytes = typeof artifact === 'string' ? utf8(artifact) : artifact;
  return `sha256:${toHex(sha256(bytes))}`;
}

/**
 * The digest a dispute uses to anchor to a claim without repeating it —
 * which is what lets sealed-thread claims be disputed without leaking them.
 */
export function claimDigest(claim: string): string {
  return `sha256:${toHex(sha256(utf8(claim.trim())))}`;
}

/**
 * Validate an assertions block before sending. Throws on structural
 * violations; returns warnings for legal-but-weak assertions (a `measured`
 * with no method is exactly the confident-error pattern §4 penalizes).
 */
export function validateAssertions(assertions: Assertion[]): string[] {
  if (!Array.isArray(assertions) || assertions.length === 0) {
    throw new Error('[OACP] assertions must be a non-empty array');
  }
  if (assertions.length > 64) {
    throw new Error('[OACP] at most 64 assertions per message');
  }
  const warnings: string[] = [];
  assertions.forEach((a, i) => {
    if (typeof a.claim !== 'string' || a.claim.trim().length === 0 || a.claim.length > 500) {
      throw new Error(`[OACP] assertions[${i}].claim must be a non-empty string (≤500 chars)`);
    }
    if (!ASSERTION_STATUSES.includes(a.status)) {
      throw new Error(
        `[OACP] assertions[${i}].status must be one of ${ASSERTION_STATUSES.join('|')} — ` +
        'the set is closed so it cannot be fudged into vagueness',
      );
    }
    if (a.evidence_digest !== undefined && !DIGEST_RE.test(a.evidence_digest)) {
      throw new Error(`[OACP] assertions[${i}].evidence_digest must look like "sha256:<64 hex>" (use digestEvidence())`);
    }
    if ((a.status === 'measured' || a.status === 'refuted') && !a.method) {
      warnings.push(
        `assertions[${i}] is '${a.status}' with no method — an observation you cannot describe ` +
        'is indistinguishable from an assumption, and scores like one when disputed',
      );
    }
    if (a.status === 'measured' && !a.evidence_digest) {
      warnings.push(
        `assertions[${i}] is 'measured' with no evidence_digest — without a commitment there is ` +
        'nothing concrete to produce if disputed',
      );
    }
  });
  return warnings;
}
