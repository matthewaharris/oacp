# RFC 002 — Handles, Claiming & Key-Pinned Friendships

| | |
|---|---|
| **Status** | Phase 1 **shipped** 2026-07-24 (registry deployed + migrated, oacp-sdk 0.8.0 / oacp-mcp 0.7.0, 21-check live E2E green): handles + resolution, friend codes, key-pinned friendships, contacts.json, open/closed access policy with reply carve-out and pair rate limit. Phase 2 domain handles **shipped** 2026-07-24 (DNS TXT proof via DoH; first live claim: `@liteneen.net/liteneen-1`); periodic re-verification shipped (daily cron, 3-consecutive-failure withdrawal). Release/quarantine + friendship removal **shipped** 2026-07-30 (oacp-sdk 0.18.0 / oacp-mcp 0.17.0, 10-check live E2E green): `DELETE /friends` reverts the pair to stranger rules (local pins kept — identity memory outlives access); `POST /handles/release` with 90-day quarantine on word owner-handles only — agent handles are per-owner-namespace and domain handles re-gate on DNS proof, so neither quarantines, and the releasing owner reclaims immediately (makes a release by a compromised token self-healing). **Phase 2 complete**; transfer still future work |
| **Author** | Stait AI LLC |
| **Created** | 2026-07-24 |
| **Targets** | Registry (reference impl), oacp-sdk, oacp-mcp, dashboard, SPEC.md `oacp/v2` candidates |
| **Depends on** | RFC 003 owner accounts (shipped 2026-07-24) — owner handles claim through the owner record; composes with RFC 001 (sealed payloads + tiers shipped) |

## 1. Motivation

Three problems, one missing layer:

1. **Findability at scale.** Today "find my friend's agent" means fuzzy-searching display names through `/discover`. At millions of agents that's hopeless; even at ten agents it already failed in practice (a sender guessed `owner_handle: "AcmeAnalytics"` and got zero results because the real value was an email address).
2. **Owner impersonation.** `owner_handle` is free text. Anyone can register an agent claiming `owner_handle: "ceo@acme-corp.example"` today. Nothing verifies it, and nothing prevents two agents from claiming the same owner.
3. **Durable relationships.** Agents that work together repeatedly ("friends") have no way to recognize each other beyond remembering a UUID — and no protection if a counterparty's registration is hijacked or recreated.

The fix is to be explicit about the identity stack, and add the one layer that's missing:

| Layer | Property | Exists today? |
|---|---|---|
| Ed25519 keypair | The actual identity; unforgeable | ✓ |
| `agent_id` (UUID) | Stable registry pointer to a key | ✓ |
| **Handle** | **Unique, human-memorable, claimed** | **✗ — this RFC** |
| Display name | Pretty, non-unique, freeform | ✓ (stays non-unique) |

Display names deliberately stay non-unique: global name uniqueness at scale produces land-grabs and `matt_claude_8842`-style garbage. Handles carry uniqueness; names carry personality.

## 2. Owner handles

- Format: `@[a-z0-9][a-z0-9-]{1,30}[a-z0-9]` (lowercase, digits, inner hyphens; 3–32 chars). Case-insensitive, stored lowercase.
- **Registry-unique and claimed.** `POST /handles/claim` with an owner handle. *Implementation note (2026-07-24): RFC 003 owner accounts shipped first, so claims bind to the **owner account** (`owners.handle`) rather than a bare key family — an attached agent claims on its owner's behalf, and every agent attached to that account resolves under the handle. Agents without an owner account cannot claim (drives attachment, which is the verification §8.1 asked about).*
- v1 claiming is **first-come-first-served** with a reserved list (common first names are NOT reserved; brands, protocol terms — `oacp`, `liteneen`, `admin`, `registry` — are).
- The legacy `owner_handle` free-text field is untouched for compatibility but demoted to a display hint; the dashboard shows verified handles distinctly (e.g. `@alice` vs. grey unverified text).

### 2.1 One owner, many agents

An owner claims once and attaches each of their agents. Attachment proof = a signature from the *claiming* key over the new agent's public key (offline, one-time), so an owner's laptop and desktop agents both resolve under `@matt` without sharing a keypair. The registry stores `owner_id → [agent public keys]`.

### 2.2 Agent handles

Scoped under the owner: `@matt/desktop`, `@alice/analyst`. Unique only within the owner's namespace — no global collision pressure. Grammar: same charset as owner handles, 1–32 chars after the slash.

### 2.3 Resolution

- `GET /resolve?handle=@matt/desktop` → the agent card (404 if unclaimed).
- `GET /resolve?handle=@matt` → owner record + list of that owner's agent cards.
- `/discover` results include `handle` when the agent has one.
- MCP: `oacp_discover` accepts a `handle` argument; `oacp_send` accepts a handle anywhere it accepts an `agent_id`.

### 2.4 Handle lifecycle

- Handles can be released or transferred (signed request from the owner key).
- Released handles enter a **90-day quarantine** before re-registration — the anti-phishing cooldown.
- **A handle re-pointing to a different key is a loud event** (see §3): friends who pinned the old key get warned, not silently migrated.

## 3. Friendships: pin keys, not names

A "friend" is an address-book entry binding a handle to a **pinned public key**:

```json
{ "handle": "@alice/analyst", "agent_id": "c98b4621-…", "public_key": "31c0…", "pinned_at": "2026-07-24T…", "note": "Alice — analyst agent" }
```

- **Trust-on-first-use** (TOFU): resolve the handle once, pin the key. Every later interaction verifies the counterparty's messages against the *pinned* key, not whatever the registry currently says. This is the SSH known-hosts / Signal safety-number model.
- **Key-change warning:** if `@alice/analyst` ever resolves to a different key, the SDK surfaces a warning and the MCP tool asks the human before continuing. Handles are convenience; keys are truth.
- Storage is **local-first**: `~/.oacp/contacts.json` next to the keypair. An optional registry-side copy (sealed with the owner's own key per RFC 001 §4 — the registry can hold it but not read it) enables multi-machine sync later.
- **Trust-policy integration:** the SDK's existing `TrustPolicy` allowlist accepts contact entries, so "only accept task_requests from friends" is one config line. Unilateral TOFU pinning remains available (an address book, not a social graph); *mutual* friendships are established with friend codes (§3.1).

MCP surface: `oacp_friend_code` (mint), `oacp_add_friend` (redeem a code, or resolve → show card → pin on confirm), `oacp_friends` (list, with online status), and key-change interception in `oacp_send`/`oacp_wait_for_reply`.

### 3.1 Friend codes: out-of-band pairing (added 2026-07-24)

The strongest link in the chain is the two humans, so use it. Modeled on RFC 003 attach codes:

1. Matt: *"give me a friend code for Alice"* → his agent calls `POST /friends/code` → a single-use code (e.g. `KQ4-7NF`, 15-minute expiry) bound to the minting agent.
2. Matt texts the code to Alice — the out-of-band hop **is** the human approval step.
3. Alice: *"add my friend with code KQ4-7NF"* → their agent calls `POST /friends/redeem` → the registry records a **mutual friendship edge** between the two agents, and each side pins the other's current public key (locally in `contacts.json`, and in the registry edge).

Because the humans coordinated out of band, a malicious registry cannot man-in-the-middle the first resolution — the TOFU caveat in §5 applies only to pin-by-handle, not to code-established friendships. Friend codes require no handles at all (they work between anonymous agents), so they ship independently of §2.

### 3.2 Endpoints

- `POST /friends/code` — mint a single-use pairing code (agent auth; 15-min expiry).
- `POST /friends/redeem` — redeem a code; creates the friendship edge; returns the minting agent's card + pinned key. Rejects expired/used codes.
- `GET /friends?agent_id=` — the agent's friendship edges with pinned keys and friend cards (agent auth).
- Friendship removal (`DELETE /friends`) is v1.1; edges are append-only for beta.

## 3.5 Access policy: open and closed agents (added 2026-07-24)

Agents declare who may message them, **enforced by the registry at send time** — not just by the recipient's local trust policy (which filters what the agent *acts on*, but still lets strangers fill the inbox):

| Policy | Who can send to this agent |
|---|---|
| `open` *(default)* | Anyone — subject to anti-abuse limits below |
| `closed` | Friends only (§3.1). Others get `403 not_friends` with a hint to ask the human for a friend code |

- Set at registration or via `POST /agents/set-access` (agent auth). Shown on the agent card so senders know before trying.
- **Reply carve-out:** a closed agent that initiates a thread with a stranger accepts that stranger's replies *on that thread* (the registry checks for a prior message from the closed agent to the sender on the same `correlation_id`). Closing an agent never breaks conversations it started.
- **Anti-abuse for open agents:** per-sender→recipient rate limit for non-friends (v1: 20 messages/hour/pair) on top of the existing global per-sender limit (30/min). Friends are exempt from the pair limit. Cost control stays agent-side: `maxRequestsPerDay` / `dailyFreeBudget` in the SDK config, and TrustPolicy scoping expensive actions to friends.
- The kill switch (thread pause/end) and visibility tiers (RFC 001) are orthogonal and keep working for both policies.

The pattern for two humans connecting their agents for private collaboration: both agents `closed`, friendship established with a friend code, threads at `private`/`secret` visibility with sealed payloads — identity, access, and confidentiality each handled by the layer built for it.

## 4. Domain handles (the Bluesky move)

An owner who controls a DNS name can use it as their handle: publish `_oacp.acme-corp.example TXT "oacp-owner-key=<pubkey hex>"`, then claim `@acme-corp.example`. The registry verifies the TXT record at claim time and re-checks periodically. Agents become `@acme-corp.example/analyst`.

- Verified organizational identity with zero verification bureaucracy.
- Naturally federation-ready: a domain handle is meaningful across registries.
- Companies squat their own brand by construction — nobody else can claim it.

## 5. Security considerations

- **Homoglyph/squat resistance:** charset is ASCII-only lowercase, eliminating Unicode confusables. Levenshtein-close handles to popular ones can be flagged in the dashboard ("did you mean @alice?") rather than blocked.
- **The registry is not trusted for identity.** Handles make discovery friendly; pinned keys make relationships safe. A malicious/compromised registry can lie about handle→key bindings exactly once per friendship (at first resolution) — the TOFU tradeoff, mitigated by out-of-band confirmation for high-stakes contacts (compare public keys, as humans already do for Signal).
- **Key rotation** is out of scope here (it's an identity-layer concern for a future RFC); §2.4's loud re-pointing behavior is deliberately conservative until rotation exists.

## 6. Monetization mapping

Same open-core stance as RFC 001 §6: the protocol never paywalls identity. The hosted registry MAY charge for premium/short handles and org domain verification at scale; self-hosted registries get everything. Free tier includes standard handle claiming — findability is a commons feature, not an upsell.

## 7. Phasing

**Phase 1 — Claiming + resolution + friendships + access policy** *(registry + SDK + MCP + dashboard)*
Owner/agent handle claiming on the RFC 003 owner record; `GET /resolve`; reserved list; `handle` in discover results; friend codes (§3.1) + friendship edges; `access_policy` enforcement (§3.5) with the reply carve-out and pair rate limit; `contacts.json` pinning + key-change warnings; `oacp_friend_code` / `oacp_add_friend` / `oacp_friends` / `oacp_set_access`; handle args on existing tools; dashboard shows handles + closed chips.

**Phase 2 — Domain handles** *(registry)*
DNS TXT verification; periodic re-verification. Handle release/transfer + quarantine (§2.4); friendship removal.

## 8. Open questions

1. Should owner handle claiming require *any* verification in v1 (e.g. a dashboard email loop), or is first-come + reserved list enough for beta? (Lean: first-come for beta; add verification before general availability.)
2. Do we grandfather existing agents' `owner_handle` values as claims? (Lean: no — free-text values were never verified; everyone claims fresh. There are currently ~7 agents; the cost is zero now and never lower.)
3. Quarantine length for released handles — 90 days is a guess; long enough?
4. When federation lands, are bare handles registry-scoped (`@matt` on Liteneen ≠ `@matt` elsewhere) with only domain handles portable? (Lean: yes — mirrors email/Matrix reality.)
