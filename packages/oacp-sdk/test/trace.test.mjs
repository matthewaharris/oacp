// RFC 008 trace context: signing and reading. Run: npm test (builds first).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalizeMessage,
  generateKeypair,
  signMessage,
  verifySignature,
  newTraceId,
  isValidTraceId,
  isValidTraceParentId,
  traceOf,
  continueTrace,
} from '../dist/index.js';

const base = {
  sender_agent_id: '9c1d',
  recipient_agent_id: '3f2a',
  message_type: 'task_request',
  payload: { action: 'review-pr' },
  correlation_id: 'b7e2',
};
const TRACE = '0a719bdd32a9ea53de8bef0d5ccea968';
const RUN = '010b9671-3b5c-4fd2-a303-64a841ba93b3';

test('a message without a trace canonicalizes exactly as it did before RFC 008', () => {
  assert.equal(
    canonicalizeMessage(base),
    '{"correlation_id":"b7e2","message_type":"task_request","payload":{"action":"review-pr"},"recipient_agent_id":"3f2a","sender_agent_id":"9c1d"}',
  );
});

test('trace fields are signed, last, in lexicographic order', () => {
  assert.equal(
    canonicalizeMessage({ ...base, trace_parent_id: RUN, trace_id: TRACE, sequence: 2 }),
    `{"correlation_id":"b7e2","message_type":"task_request","payload":{"action":"review-pr"},"recipient_agent_id":"3f2a","sender_agent_id":"9c1d","sequence":2,"trace_id":"${TRACE}","trace_parent_id":"${RUN}"}`,
  );
});

test('changing or stripping the trace ID breaks the signature', () => {
  const keys = generateKeypair();
  const signature = signMessage(canonicalizeMessage({ ...base, trace_id: TRACE }), keys.secretKey);
  assert.equal(verifySignature(signature, canonicalizeMessage({ ...base, trace_id: TRACE }), keys.publicKey), true);
  const moved = canonicalizeMessage({ ...base, trace_id: 'f'.repeat(32) });
  assert.equal(verifySignature(signature, moved, keys.publicKey), false);
  assert.equal(verifySignature(signature, canonicalizeMessage(base), keys.publicKey), false);
});

test('an old verifier, which ignores trace fields, rejects a traced message', () => {
  // This is why the registry has to support RFC 008 before any sender uses it.
  const keys = generateKeypair();
  const signature = signMessage(canonicalizeMessage({ ...base, trace_id: TRACE }), keys.secretKey);
  const asAnOldRegistrySeesIt = canonicalizeMessage(base);
  assert.equal(verifySignature(signature, asAnOldRegistrySeesIt, keys.publicKey), false);
});

test('trace ID and parent ID formats', () => {
  assert.equal(isValidTraceId(newTraceId()), true);
  assert.equal(isValidTraceId(TRACE.toUpperCase()), false);
  assert.equal(isValidTraceId('0'.repeat(32)), false);
  assert.equal(isValidTraceId(TRACE.slice(1)), false);
  assert.equal(isValidTraceParentId(RUN), true);
  assert.equal(isValidTraceParentId('has space'), false);
  assert.equal(isValidTraceParentId('x'.repeat(65)), false);
});

test('traceOf reads the envelope, then the sealed copy, and ignores malformed values', () => {
  assert.deepEqual(traceOf({ trace_id: TRACE, trace_parent_id: RUN, payload: {} }), {
    traceId: TRACE,
    parentId: RUN,
    sealed: false,
  });
  assert.deepEqual(traceOf({ payload: { oacp_trace: { trace_id: TRACE, parent_id: RUN } } }), {
    traceId: TRACE,
    parentId: RUN,
    sealed: true,
  });
  assert.equal(traceOf({ trace_id: 'not-a-trace', payload: {} }), null);
  assert.equal(traceOf({ payload: { text: 'hello' } }), null);
  assert.deepEqual(traceOf({ trace_id: TRACE, trace_parent_id: 'bad id' }), { traceId: TRACE, sealed: false });
});

test('continueTrace adopts a valid incoming trace and starts a new one otherwise', () => {
  assert.deepEqual(continueTrace({ trace_id: TRACE, trace_parent_id: RUN }), {
    traceId: TRACE,
    callerId: RUN,
    sealed: false,
    adopted: true,
  });
  const fresh = continueTrace({ payload: {} });
  assert.equal(fresh.adopted, false);
  assert.equal(isValidTraceId(fresh.traceId), true);
});
