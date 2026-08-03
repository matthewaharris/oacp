/**
 * OACP SDK — Open Agent Communication Protocol
 *
 * TypeScript SDK for building agents that register, discover,
 * and communicate via the OACP protocol.
 *
 * @example
 * ```typescript
 * import { OACPAgent } from 'oacp-sdk';
 *
 * const agent = new OACPAgent({
 *   name: 'my-agent',
 *   capabilities: ['research-summarization'],
 *   supabaseUrl: process.env.SUPABASE_URL!,
 *   supabaseAnonKey: process.env.SUPABASE_ANON_KEY!,
 * });
 *
 * await agent.register();
 * agent.startHeartbeat();
 *
 * const results = await agent.discover({ capability: 'data-extraction' });
 * console.log('Found agents:', results.agents);
 * ```
 */

export const VERSION = '0.19.0';

// Main agent class
export { OACPAgent } from './agent.js';

// Configuration
export {
  type AgentConfig,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_KEYPAIR_PATH,
  OACP_PUBLIC_REGISTRY_URL,
  OACP_PUBLIC_REGISTRY_KEY,
} from './config.js';

// Cryptography
export {
  generateKeypair,
  signMessage,
  verifySignature,
  canonicalizeMessage,
  loadOrCreateKeypair,
  resolveKeypair,
  isValidKeypair,
  toHex,
  fromHex,
  type OACPKeypair,
} from './crypto.js';

// Types
export type {
  AgentCard,
  AgentMetadata,
  ModelInfo,
  AgentStatus,
  RegisterRequest,
  RegisterResponse,
  ReregisterResponse,
  HeartbeatRequest,
  HeartbeatResponse,
  DiscoverQuery,
  DiscoverResponse,
  MessageType,
  ThreadVisibility,
  MessageEnvelope,
  CounterpartInfo,
  SenderDecision,
  SendReceipt,
  PayloadContentType,
  ContentPayload,
  ApiError,
} from './types.js';

// Sealed payloads (RFC 001 §4, oacp/v2-draft)
export {
  sealPayload,
  unsealPayload,
  isSealedPayload,
  SEAL_ALG,
  SEAL_VERSION,
  type SealedPayload,
  type SealReader,
} from './seal.js';

// Blinded mailboxes (RFC 001 §5.1, oacp/v2-draft)
export {
  mailboxKeyFor,
  mailboxEpoch,
  mailboxTag,
  signInner,
  verifyInner,
  encryptMailboxBlob,
  decryptMailboxBlob,
  MAILBOX_ALG,
  MAILBOX_VERSION,
  MAILBOX_EPOCH_SECONDS,
  type MailboxBlob,
  type BlindedInner,
  type BlindedMessage,
} from './mailbox.js';

// Per-thread ratcheting (RFC 001 §5.2)
export {
  generateThreadEphemeral,
  deriveThreadKey,
  seedChain,
  chainStep,
  encryptRatchetBlob,
  decryptRatchetHeader,
  decryptRatchetBody,
  MAILBOX_RATCHET_VERSION,
  RATCHET_SKIP_MAX,
  type RatchetBlob,
  type RatchetHeader,
  type RatchetState,
  type ChainState,
} from './mailbox.js';
export {
  ratchetThreadKey,
  loadRatchets,
  saveRatchet,
  deleteRatchet,
} from './ratchets.js';

// Assertions & disputes (RFC 007 §§2-3)
export {
  digestEvidence,
  claimDigest,
  validateAssertions,
  ASSERTION_STATUSES,
  type Assertion,
  type AssertionStatus,
  type AssertionDispute,
} from './assertions.js';

// Contacts & friendships (RFC 002 §3)
export {
  loadContacts,
  saveContact,
  getContact,
  deleteContact,
  checkPin,
  type Contact,
} from './contacts.js';

// Trust model
export {
  validatePayload,
  isSenderAllowed,
  matchAction,
  DEFAULT_TRUST_POLICY,
  type ActionSpec,
  type TrustPolicy,
  type SimpleSchema,
  type ValidationResult,
} from './trust.js';
