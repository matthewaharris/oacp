/**
 * OACP SDK — Agent Configuration
 */

import type { ActionSpec, TrustPolicy } from './trust.js';
import type { ModelInfo } from './types.js';

/**
 * Default OACP public registry — hosted on Supabase.
 * Agents connect here automatically unless overridden.
 */
export const OACP_PUBLIC_REGISTRY_URL = 'https://zhenbunwugeskqtghjyt.supabase.co';
export const OACP_PUBLIC_REGISTRY_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpoZW5idW53dWdlc2txdGdoanl0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5OTM3NDYsImV4cCI6MjA5MDU2OTc0Nn0.hU5C6yESrm0B8-hsXTY-XEYkgLegx-2SdpH8E3RMSGU';

export interface AgentConfig {
  /** Display name for the agent */
  name: string;

  /** Capability tags this agent advertises */
  capabilities: string[];

  /**
   * Supabase project URL.
   * Defaults to the OACP public registry — no setup needed.
   */
  supabaseUrl?: string;

  /**
   * Supabase anon key for client operations.
   * Defaults to the OACP public registry key — no setup needed.
   */
  supabaseAnonKey?: string;

  /** Optional owner handle */
  ownerHandle?: string;

  /** Optional description */
  description?: string;

  /** Optional public endpoint URL */
  endpointUrl?: string;

  /** Optional additional protocols supported */
  protocolsSupported?: string[];

  /** Optional metadata */
  metadata?: Record<string, unknown>;

  /** Path to keypair JSON file (default: ./oacp-keypair.json) */
  keypairPath?: string;

  /**
   * Path to the owner's encryption keypair (RFC 001 §3.1).
   * Default: "owner-keypair.json" in the same directory as keypairPath.
   * Auto-generated on first use.
   */
  ownerKeypairPath?: string;

  /**
   * Path to the local contacts file (RFC 002 §3): pinned counterparty keys.
   * Default: "contacts.json" in the same directory as keypairPath.
   */
  contactsPath?: string;

  /**
   * Path to the per-thread ratchet state file (RFC 001 §5.2). Deleting a
   * thread's entry is the forward-secrecy lever — its captured ciphertext
   * becomes permanently undecryptable. Default: "ratchets.json" in the same
   * directory as keypairPath.
   */
  ratchetsPath?: string;

  /**
   * Explicit Ed25519 keypair (hex strings). Takes precedence over
   * keypairPath and the OACP_SECRET_KEY / OACP_PUBLIC_KEY env vars.
   * Use this (or the env vars) to pin agent identity on hosts with
   * ephemeral disks (e.g. Render), where a file-based keypair would be
   * regenerated on every deploy.
   */
  keypair?: { secretKey: string; publicKey: string };

  /** Heartbeat interval in milliseconds (default: 30000) */
  heartbeatIntervalMs?: number;

  /** Action specs declaring what this agent can do */
  actionSpecs?: ActionSpec[];

  /** Trust policy controlling who can send tasks to this agent */
  trustPolicy?: TrustPolicy;

  /** Model powering this agent (published in Agent Card for discovery) */
  model?: ModelInfo;

  /** Languages this agent can process (ISO 639-1 codes) */
  languages?: string[];

  /** Max LLM tokens this agent will serve free per day (0 = unlimited, default: 0) */
  dailyFreeBudget?: number;

  /** Max requests this agent will handle per day (0 = unlimited, default: 0) */
  maxRequestsPerDay?: number;

  /**
   * Base URL for OACP API (default: {supabaseUrl}/functions/v1/oacp)
   * Override for custom deployments.
   */
  apiBaseUrl?: string;
}

export const DEFAULT_HEARTBEAT_INTERVAL_MS = 60_000;
export const DEFAULT_KEYPAIR_PATH = './oacp-keypair.json';
