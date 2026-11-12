/**
 * Trace context (RFC 008).
 *
 * A trace ID names one originating request and travels with every message
 * that request causes, across agents and owners. It answers "what did this
 * request cause, everywhere?", which neither a run ID (one agent's work) nor
 * a correlation_id (one thread between two agents) can.
 *
 * The values are labels, not credentials: who sent a message is proven by its
 * signature, never by its trace ID. They are still signed (see
 * canonicalizeMessage) so that nobody between sender and recipient can move a
 * message into a different trace.
 */
import { randomBytes } from 'crypto';

export interface TraceContext {
  /** 32 lowercase hex characters, not all zeros (the W3C Trace Context trace-id format). */
  traceId: string;
  /**
   * The sender's own unit of work that caused this message, such as its run
   * ID. Lets a reader rebuild who-called-whom. 1 to 64 of A-Z a-z 0-9 _ -.
   */
  parentId?: string;
}

/** Trace context as read from a received message. */
export interface ReceivedTrace extends TraceContext {
  /** True when the trace travelled inside the sealed payload, not the cleartext envelope. */
  sealed: boolean;
}

/** Key under which a sealed trace is carried inside the payload. */
export const SEALED_TRACE_KEY = 'oacp_trace';

const TRACE_ID = /^[0-9a-f]{32}$/;
const TRACE_PARENT_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidTraceId(value: unknown): value is string {
  return typeof value === 'string' && TRACE_ID.test(value) && !/^0+$/.test(value);
}

export function isValidTraceParentId(value: unknown): value is string {
  return typeof value === 'string' && TRACE_PARENT_ID.test(value);
}

export function newTraceId(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Read the trace context of a received message: the envelope fields, or the
 * sealed copy inside an opened payload. Returns null when there is none or it
 * is malformed. A malformed trace is ignored, never an error: it must not be
 * able to stop a message being handled.
 */
export function traceOf(message: {
  trace_id?: unknown;
  trace_parent_id?: unknown;
  payload?: unknown;
}): ReceivedTrace | null {
  if (isValidTraceId(message.trace_id)) {
    return {
      traceId: message.trace_id,
      ...(isValidTraceParentId(message.trace_parent_id) ? { parentId: message.trace_parent_id } : {}),
      sealed: false,
    };
  }
  const inner =
    message.payload && typeof message.payload === 'object'
      ? (message.payload as Record<string, unknown>)[SEALED_TRACE_KEY]
      : undefined;
  if (inner && typeof inner === 'object') {
    const t = inner as Record<string, unknown>;
    if (isValidTraceId(t.trace_id)) {
      return {
        traceId: t.trace_id,
        ...(isValidTraceParentId(t.parent_id) ? { parentId: t.parent_id } : {}),
        sealed: true,
      };
    }
  }
  return null;
}

/**
 * The trace a receiving agent should work under: the sender's trace when the
 * message carried a valid one (RFC 008 §4, "adopt"), otherwise a new one.
 * `callerId` is the sender's unit of work, to record as this work's parent.
 */
export function continueTrace(message: Parameters<typeof traceOf>[0]): {
  traceId: string;
  callerId?: string;
  sealed: boolean;
  adopted: boolean;
} {
  const received = traceOf(message);
  if (!received) return { traceId: newTraceId(), sealed: false, adopted: false };
  return {
    traceId: received.traceId,
    ...(received.parentId ? { callerId: received.parentId } : {}),
    sealed: received.sealed,
    adopted: true,
  };
}
