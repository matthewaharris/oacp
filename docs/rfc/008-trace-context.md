# RFC 008 — Trace Context

| | |
|---|---|
| **Status** | **Draft.** SDK support written (`oacp-sdk`, unreleased). Reference registry support written, not deployed. Nothing may send trace fields until the registry change is live (§6) |
| **Author** | Stait AI LLC |
| **Created** | 2026-11-12 |
| **Targets** | SPEC.md §5.1 and §5.2, reference registry, oacp-sdk, oacp-python, oacp-mcp |
| **Depends on** | RFC 001 (sealed payloads) |

## 1. Motivation

OACP has two identifiers for work, and neither spans a request that passes
through more than two agents.

| Identifier | Scope | Answers |
|---|---|---|
| An agent's own run ID | One agent's work | What did this agent do? |
| `correlation_id` | One thread between two agents | Which messages belong together? |
| *missing* | The whole request, across every agent | What did this request cause, everywhere? |

When agent A asks B for a review and B asks C for a security scan, B opens a
new thread with a new `correlation_id`. Nothing connects C's work to A's
request. If C spends two hundred thousand tokens, neither A's owner nor C's
owner can say which request caused it, and a failure in C cannot be followed
back to where it started.

Ordinary distributed systems solved this with a trace ID carried on every
call (W3C Trace Context's `traceparent` header). This RFC adds the same thing
to the OACP envelope. What is specific to OACP is that the hops are signed
messages between agents with different owners, relayed by a registry that
neither owner controls.

## 2. Envelope fields

Two optional fields are added to the message envelope (SPEC.md §5.1).

| Field | Format | Meaning |
|---|---|---|
| `trace_id` | 32 lowercase hex characters, not all zeros | The originating request. Identical on every message that request causes. Same format as the W3C `trace-id`, so it can be passed straight to OpenTelemetry tooling. |
| `trace_parent_id` | 1 to 64 characters of `A-Z a-z 0-9 _ -` | The sender's own unit of work that caused this message, typically its run ID. Opaque to everyone but the sender. Only valid alongside `trace_id`. |

`trace_id` says which requests belong together. `trace_parent_id` says who
called whom, which is what lets a reader rebuild the call tree rather than
just a flat set of runs.

A registry **MUST** reject a message whose `trace_id` or `trace_parent_id` is
present and malformed, or whose `trace_parent_id` is present without a
`trace_id` (`400`). It **MUST** store both fields and return them unchanged
when the message is fetched.

## 3. Signing

Both fields are part of the signed content. The canonical field list of
SPEC.md §5.2 becomes:

`correlation_id`, `message_type`, `payload`, `recipient_agent_id`,
`sender_agent_id`, `sequence`, `timestamp`, `trace_id`, `trace_parent_id`

Absent fields are omitted, as today. A message that carries no trace
therefore canonicalizes to exactly the bytes it did before this RFC, and
every existing signature still verifies.

**Why signed.** An unsigned trace ID could be changed or removed by anything
between sender and recipient, including the registry. A trace is only useful
for attributing cost and following failures if a message cannot be moved
into a different trace after it was sent.

**What the signature does not mean.** A trace ID is a label, not a
credential. The signature proves that this sender put this message in this
trace. It does not prove the sender was entitled to use that trace ID, and a
receiver **MUST NOT** grant anything on the strength of one.

## 4. Receiver behaviour

- **Adopt.** A receiver that does work because of a message carrying a valid
  `trace_id` **SHOULD** record that work under the same trace ID, and
  **SHOULD** record the message's `trace_parent_id` as the parent of its own
  unit of work.
- **Propagate.** Any message the receiver sends as a consequence, to the
  original sender or to a third agent, **SHOULD** carry the same `trace_id`,
  with `trace_parent_id` set to the receiver's own unit of work.
- **Replies stay in the trace.** A `task_ack`, `task_result`, `task_error` or
  `chat` reply **SHOULD** carry the `trace_id` of the message it answers.
- **Start.** A receiver handling a message with no trace **MAY** start a new
  one.
- **Malformed is ignored, not fatal.** A client that finds a malformed trace
  on a message it has already been given **MUST** handle the message as if it
  carried none. Trace context must never be a way to stop a message being
  handled.

Adopting a stranger's trace ID was weighed against starting a fresh one and
linking back to the sender's. Adopting won: the chain stays joined without an
extra lookup, and because the value carries no authority, the worst a hostile
sender can do is put their own messages into a trace of their choosing. The
signature already says who did that.

## 5. Sealing

By default the trace fields sit in the cleartext envelope, so the registry
can index them and both owners can follow a request without opening
payloads. That holds even when the payload is sealed (RFC 001 §4): the
content is hidden, the fact that two messages belong to one request is not.

Some senders will not want to disclose even that. A sender **MAY** instead
carry the trace inside a sealed payload, under the reserved key `oacp_trace`:

```json
{ "oacp_trace": { "trace_id": "0a71…", "parent_id": "010b…" }, "…": "…" }
```

- The envelope then carries no `trace_id` or `trace_parent_id`.
- This is only permitted on a sealed message. An SDK **MUST** refuse to send
  a sealed trace on an unsealed payload.
- A receiver that adopts a sealed trace **MUST NOT** repeat it in a cleartext
  envelope. If a consequent message cannot be sealed, the trace is dropped.

The sealed form is still covered by the signature, because the signature is
over the sealed payload.

## 6. Rollout order

Adding a signed field is a breaking change for any verifier that does not
know the field. A registry that predates this RFC rebuilds the canonical
content without the trace fields, so a traced message fails verification
there as `403 Invalid message signature`.

The order is therefore fixed:

1. The registry accepts, verifies, stores and returns the fields.
2. SDKs gain the ability to send them. Sending stays opt-in.
3. Agents begin to propagate.

Receiving needs no coordination: the SDK does not re-verify envelope
signatures on fetch, and an old client ignores fields it does not know.

## 7. What is implemented

- **oacp-sdk:** `send(…, { trace: { traceId, parentId, sealed } })`;
  `canonicalizeMessage` signs the two fields when present; `traceOf(message)`
  and `continueTrace(message)` read them from the envelope or the sealed copy;
  the built-in task handler keeps `task_result` and `task_error` replies in
  the request's trace. A `403` signature failure on a traced message names
  §6 as the likely cause.
- **Reference registry:** validation, verification, two indexed columns.
  Written, not deployed.

## 8. Open questions

- **Filtering.** Should `GET /messages` accept `trace_id` as a filter, the
  way it accepts `correlation_id`? Useful for an owner's dashboard; not
  needed for propagation.
- **Capability advertisement.** A sender cannot currently ask whether a
  registry supports this RFC before using it. A registry capabilities
  document would turn the `403` in §6 into a check made up front.
- **Sampling flags.** W3C carries a "sampled" bit so that every service in a
  trace makes the same keep-or-drop decision. Not needed until volumes
  require sampling.
- **Sealed trace and acknowledgements.** `acknowledgeTask` does not yet
  propagate the trace.
