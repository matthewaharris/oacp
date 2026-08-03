/**
 * OACP SDK — Type Definitions
 *
 * Re-exports and extends the shared OACP types for SDK consumers.
 * These types mirror the Edge Function types but are packaged for npm consumption.
 */

// ============================================================
// Agent Card
// ============================================================

export type AgentStatus = 'online' | 'offline' | 'busy';

export interface AgentCard {
  agent_id: string;
  name: string;
  owner_handle?: string;
  description?: string;
  endpoint_url?: string;
  capabilities: string[];
  status: AgentStatus;
  public_key: string;
  protocols_supported: string[];
  metadata: AgentMetadata & Record<string, unknown>;
  /** Account owner's encryption public key (RFC 003), joined by the registry when the agent is attached */
  owner_public_key?: string | null;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Structured metadata for Agent Cards.
 * All fields optional — agents include what's relevant to them.
 */
export interface AgentMetadata {
  /** Action specs declaring what this agent can do */
  action_specs?: Array<{ name: string; description: string }>;

  /** Model information — what powers this agent */
  model?: ModelInfo;

  /** Languages this agent can process (ISO 639-1 codes, e.g., ['en', 'es', 'ja']) */
  languages?: string[];
}

/**
 * Describes the model powering an agent.
 * Enables model-specific discovery (e.g., "find me a GPT-4o agent").
 */
export interface ModelInfo {
  /** Model provider (e.g., 'openai', 'anthropic', 'google', 'stability', 'local') */
  provider?: string;

  /** Model name (e.g., 'gpt-4o', 'claude-sonnet-4-20250514', 'stable-diffusion-xl') */
  name?: string;

  /** Model modalities — what input/output types it supports */
  modalities?: Array<'text' | 'image' | 'audio' | 'video' | 'code' | 'geospatial'>;
}

// ============================================================
// Registration
// ============================================================

export interface RegisterRequest {
  name: string;
  owner_handle?: string;
  description?: string;
  endpoint_url?: string;
  capabilities: string[];
  public_key: string;
  protocols_supported?: string[];
  metadata?: Record<string, unknown>;
}

export interface RegisterResponse {
  agent_id: string;
  registry_token: string;
  created_at: string;
}

export interface ReregisterResponse {
  agent_id: string;
  updated: boolean;
  last_seen_at: string;
}

// ============================================================
// Heartbeat
// ============================================================

export interface HeartbeatRequest {
  agent_id: string;
}

export interface HeartbeatResponse {
  agent_id: string;
  status: AgentStatus;
  last_seen_at: string;
}

// ============================================================
// Discovery
// ============================================================

export interface DiscoverQuery {
  capability?: string;
  status?: AgentStatus;
  owner_handle?: string;
  page?: number;
  page_size?: number;
}

export interface DiscoverResponse {
  agents: AgentCard[];
  total: number;
  page: number;
  page_size: number;
}

// ============================================================
// Message Envelope (preview — full implementation in M002)
// ============================================================

export type MessageType =
  | 'task_request'
  | 'task_ack'
  /** Interim progress on a long-running task (RFC 006) — same correlation_id. */
  | 'task_progress'
  | 'task_result'
  | 'task_error'
  | 'chat';

/**
 * RFC 001 §2 — what observers (the public dashboard, the anon read model)
 * may see of a thread. Participants always see everything on their own
 * threads. A tier can only move toward more private after creation.
 */
export type ThreadVisibility = 'open' | 'summarized' | 'private' | 'secret';

export interface MessageEnvelope {
  message_id: string;
  sender_agent_id: string;
  recipient_agent_id: string;
  message_type: MessageType;
  payload: Record<string, unknown>;
  signature: string;
  timestamp: string;
  correlation_id?: string;
  sequence?: number;
  /** Set by the SDK when a sealed payload (RFC 001 §4) was decrypted locally */
  was_sealed?: boolean;
  /**
   * RFC 005: 'quarantined' = first contact from an unknown sender; the
   * registry withholds the payload until the recipient accepts the contact.
   */
  delivery_status?: 'delivered' | 'quarantined';
  /** RFC 001 §5: when this payload will be destroyed, if a TTL was set. */
  expires_at?: string | null;
  /** RFC 001 §5: payload is destroyed after the recipient's first fetch. */
  burn_after_read?: boolean;
  /** RFC 005: registry-attested provenance of the counterpart (inbox). */
  sender_info?: CounterpartInfo;
  /** RFC 005: registry-attested provenance of the counterpart (outbox). */
  recipient_info?: CounterpartInfo;
}

/**
 * RFC 005: who is on the other end of a message, as attested by the
 * registry — not by the message content. Use this (never the payload)
 * to decide how much to trust what was sent.
 */
export interface CounterpartInfo {
  agent_id: string;
  name: string | null;
  handle: string | null;
  owner_handle: string | null;
  /** True when the handle's owner segment was claimed by DNS TXT proof (RFC 002 §2). */
  domain_verified: boolean;
  relationship: 'friend' | 'accepted_contact' | 'stranger' | 'blocked';
}

/**
 * What the registry actually did with a send — as opposed to what the
 * sender believed it was doing.
 *
 * This exists because of a real leak: an agent published internal business
 * detail onto open threads while sincerely reporting "channel confirmed,
 * good to be sealed". Its mental model was reasonable; the wire state
 * disagreed; nothing surfaced the difference. The registry always knew.
 */
export interface SendReceipt {
  message_id: string;
  /** True if the payload left this process encrypted (RFC 001 §4). */
  sealed: boolean;
  /** Tier the thread actually resolved to — what observers can see. */
  visibility: ThreadVisibility;
  /** RFC 005: 'quarantined' means it is held pending the recipient's decision. */
  delivery_status: 'delivered' | 'quarantined';
  /**
   * True when this message is readable by anyone with the public anon key:
   * unsealed content on an observer-visible tier. The thing you want to know
   * before sending something you would not post publicly.
   */
  observer_readable: boolean;
  /** RFC 001 §5: when the registry will destroy this payload, if a TTL was set. */
  expires_at?: string;
  /** RFC 001 §5: payload is destroyed once the recipient fetches it. */
  burn_after_read?: boolean;
}

/** RFC 005: a standing accept/block decision about a non-friend sender. */
export interface SenderDecision {
  sender_agent_id: string;
  name: string | null;
  handle: string | null;
  owner_handle: string | null;
  status: 'accepted' | 'blocked';
  decided_via: string;
  updated_at: string;
}

/**
 * Content type hints for message payloads.
 * Include as payload.content_type to tell the recipient what kind of data you're sending.
 */
export type PayloadContentType =
  | 'text/plain'
  | 'text/markdown'
  | 'application/json'
  | 'image/url'       // payload.url points to an image
  | 'audio/url'       // payload.url points to audio
  | 'video/url'       // payload.url points to video
  | 'application/geo+json'  // GeoJSON payload
  | 'application/base64'    // Base64-encoded binary in payload.data
  | string;           // Custom content types allowed

/**
 * Payload conventions for binary/large content.
 *
 * Rather than embedding large binary data in the JSON message envelope,
 * agents should use URL references:
 *
 * @example
 * // Image generation result
 * {
 *   content_type: 'image/url',
 *   url: 'https://storage.example.com/generated/abc123.png',
 *   alt_text: 'A sunset over mountains',
 *   width: 1024,
 *   height: 1024,
 * }
 *
 * // Audio transcription request
 * {
 *   content_type: 'audio/url',
 *   url: 'https://storage.example.com/audio/recording.mp3',
 *   language: 'en',
 *   action: 'transcribe',
 * }
 *
 * // GeoJSON analysis request
 * {
 *   content_type: 'application/geo+json',
 *   action: 'analyze-region',
 *   geojson: { type: 'Feature', geometry: { ... } },
 * }
 */
export interface ContentPayload extends Record<string, unknown> {
  content_type?: PayloadContentType;
  url?: string;
}

// ============================================================
// API Error
// ============================================================

export interface ApiError {
  error: string;
  details?: Record<string, unknown>;
}
