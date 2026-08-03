/**
 * OACP SDK — Trust Model
 *
 * Provides action specs (bounded capability declarations) and trust policies
 * (sender allowlists) for secure agent-to-agent communication.
 *
 * Key principle: agents declare what they DO, not what they block.
 * An agent with action_spec "summarize-text" will ONLY summarize text,
 * regardless of what a task_request payload contains.
 */

// ============================================================
// Action Spec — what an agent can do
// ============================================================

/**
 * JSON Schema subset for lightweight payload validation.
 * Supports: type, properties, required, enum, minLength, maxLength, minimum, maximum.
 * Not a full JSON Schema validator — just enough for action spec boundaries.
 */
export interface SimpleSchema {
  type?: 'object' | 'string' | 'number' | 'boolean' | 'array';
  properties?: Record<string, SimpleSchema>;
  required?: string[];
  enum?: unknown[];
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  items?: SimpleSchema;
  description?: string;
}

/**
 * An ActionSpec declares a specific operation an agent can perform.
 *
 * Think of it like a function signature: name + description + typed input.
 * The agent will ONLY execute this operation when invoked via OACP,
 * regardless of what the task payload contains.
 *
 * @example
 * const summarize: ActionSpec = {
 *   name: 'summarize-text',
 *   description: 'Summarize a topic or text passage in under N words',
 *   inputSchema: {
 *     type: 'object',
 *     properties: {
 *       task: { type: 'string', description: 'Topic or text to summarize' },
 *       max_words: { type: 'number', minimum: 10, maximum: 1000 },
 *     },
 *     required: ['task'],
 *   },
 * };
 */
export interface ActionSpec {
  /** Unique name for this action (e.g., 'summarize-text', 'extract-entities') */
  name: string;

  /** Human-readable description of what this action does */
  description: string;

  /** JSON Schema for the expected task payload */
  inputSchema: SimpleSchema;

  /** Optional JSON Schema for the result payload */
  outputSchema?: SimpleSchema;

  /** Token price for this action (0 = free, default: 0) */
  price?: number;
}

// ============================================================
// Trust Policy — who can invoke an agent
// ============================================================

export interface TrustPolicy {
  /**
   * Who can send tasks to this agent:
   * - 'open': any registered agent (default for prototype)
   * - 'none': reject all incoming tasks
   * - string[]: array of allowed agent_ids
   */
  allowedSenders: 'open' | 'none' | string[];

  /** Require valid Ed25519 signature on all messages (default: true) */
  requireSignature?: boolean;
}

/** Default trust policy: open to all, require signatures */
export const DEFAULT_TRUST_POLICY: TrustPolicy = {
  allowedSenders: 'open',
  requireSignature: true,
};

// ============================================================
// Validation
// ============================================================

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate a payload against a SimpleSchema.
 * Returns { valid: true } or { valid: false, errors: [...] }.
 */
export function validatePayload(
  payload: unknown,
  schema: SimpleSchema,
  path = 'payload',
): ValidationResult {
  const errors: string[] = [];

  if (schema.type) {
    const actualType = Array.isArray(payload) ? 'array' : typeof payload;
    if (actualType !== schema.type) {
      // Allow null/undefined to pass through for optional fields
      if (payload !== null && payload !== undefined) {
        errors.push(`${path}: expected ${schema.type}, got ${actualType}`);
        return { valid: false, errors };
      }
    }
  }

  if (schema.type === 'object' && typeof payload === 'object' && payload !== null && !Array.isArray(payload)) {
    const obj = payload as Record<string, unknown>;

    // Check required fields
    if (schema.required) {
      for (const field of schema.required) {
        if (obj[field] === undefined || obj[field] === null) {
          errors.push(`${path}.${field}: required field missing`);
        }
      }
    }

    // Validate properties
    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (obj[key] !== undefined) {
          const propResult = validatePayload(obj[key], propSchema, `${path}.${key}`);
          errors.push(...propResult.errors);
        }
      }
    }
  }

  if (schema.type === 'string' && typeof payload === 'string') {
    if (schema.minLength !== undefined && payload.length < schema.minLength) {
      errors.push(`${path}: string too short (min: ${schema.minLength})`);
    }
    if (schema.maxLength !== undefined && payload.length > schema.maxLength) {
      errors.push(`${path}: string too long (max: ${schema.maxLength})`);
    }
    if (schema.enum && !schema.enum.includes(payload)) {
      errors.push(`${path}: value must be one of: ${schema.enum.join(', ')}`);
    }
  }

  if (schema.type === 'number' && typeof payload === 'number') {
    if (schema.minimum !== undefined && payload < schema.minimum) {
      errors.push(`${path}: number too small (min: ${schema.minimum})`);
    }
    if (schema.maximum !== undefined && payload > schema.maximum) {
      errors.push(`${path}: number too large (max: ${schema.maximum})`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Check if a sender is allowed by the trust policy.
 */
export function isSenderAllowed(
  senderAgentId: string,
  policy: TrustPolicy,
): { allowed: boolean; reason: string } {
  if (policy.allowedSenders === 'none') {
    return { allowed: false, reason: 'Agent is not accepting tasks (policy: none)' };
  }

  if (policy.allowedSenders === 'open') {
    return { allowed: true, reason: 'Open trust policy' };
  }

  if (Array.isArray(policy.allowedSenders)) {
    if (policy.allowedSenders.includes(senderAgentId)) {
      return { allowed: true, reason: 'Sender in allowlist' };
    }
    return { allowed: false, reason: `Sender ${senderAgentId.substring(0, 8)}... not in allowlist` };
  }

  return { allowed: false, reason: 'Invalid trust policy' };
}

/**
 * Find the matching action spec for a task payload.
 * Matches on payload.action field, or falls back to first action if only one exists.
 */
export function matchAction(
  payload: Record<string, unknown>,
  actionSpecs: ActionSpec[],
): { matched: ActionSpec | null; reason: string } {
  if (actionSpecs.length === 0) {
    return { matched: null, reason: 'Agent has no declared actions' };
  }

  // If payload specifies an action, match by name
  const requestedAction = payload.action as string | undefined;
  if (requestedAction) {
    const spec = actionSpecs.find((s) => s.name === requestedAction);
    if (spec) {
      return { matched: spec, reason: `Matched action: ${spec.name}` };
    }
    const available = actionSpecs.map((s) => s.name).join(', ');
    return {
      matched: null,
      reason: `Unknown action "${requestedAction}". Available: ${available}`,
    };
  }

  // If only one action, use it as default
  if (actionSpecs.length === 1) {
    return { matched: actionSpecs[0], reason: `Default action: ${actionSpecs[0].name}` };
  }

  // Multiple actions and no action specified
  const available = actionSpecs.map((s) => s.name).join(', ');
  return {
    matched: null,
    reason: `Specify "action" field in payload. Available: ${available}`,
  };
}
