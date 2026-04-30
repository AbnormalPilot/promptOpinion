# Engineering Challenges

> The honest log of what fought back during the build. Every challenge below is reproducible from the git history with the cited commit hashes.

---

## TL;DR

| # | Challenge | Where it bit | Fix landed in |
|---|---|---|---|
| 1 | A2A SDK churn — `runAsync` API, ADK State `.get/.set`, SSE parsing, session lifecycle | `a2a-agent/src/app-factory.ts`, `mcp-bridge.ts` | `4f13cd5` |
| 2 | FHIR null-safety — public sandbox fields are sparse and inconsistent | All `src/tools/*Fetch*.ts` and `*Draft*.ts` | `a7c6501`, `4215494`, `8a458db`, `473ea0b`, `fb1e84c`, `fef1a57`, `f5ec9bd` |
| 3 | OCR no-attachment double-push bug | `src/tools/processClinicalDocument.ts` | `f5ec9bd` |
| 4 | RAG embeddings cost / API-key fragility | `rag-service/src/embeddings.ts` | `bc3e0e3` |
| 5 | RAG vector-store stale index on rebuild | `rag-service/src/vector-store.ts` | `612704b` |
| 6 | CMS NCD ingestion — bad URLs, HTML entities | `rag-service/src/cms-loader.ts` | `f10aa6e` |
| 7 | Embeddings model download failure on cold container | `rag-service/src/embeddings.ts` | `95236df` |
| 8 | A2A v1 agent card format change | `a2a-agent/src/app-factory.ts` | `14b6cac` |
| 9 | MCP capabilities — FHIR scope declaration shape | `src/index.ts` | `99b55d9` |
| 10 | Drift between analyzer and drafter — duplicated LLM calls | `src/tools/draftPriorAuthRequest.ts` | `349ac1d` |
| 11 | Server crash on un-handled tool exceptions | `src/index.ts` | `67c626f` |
| 12 | Hidden axios transitive dependency surfaced in prod | `rag-service/package.json` | `147f2d5` |
| 13 | Demo timing — 90-second wall-clock target | architectural pass | parallel-fetch in tools |

---

## 1. A2A SDK churn — silent agent responses

**Symptom:** First end-to-end runs returned an empty `text` field in the agent message. The MCP tool calls succeeded server-side, but nothing came back to the client. No exception. Just empty.

**Root cause:** Three layered API mismatches in `@google/adk` and `@a2a-js/sdk`:

1. The orchestrator was calling `runner.run()` instead of `runner.runAsync()`. The newer SDK only emits events via the async-iterator method.
2. ADK `context.state` is a `State` object with `.get()` / `.set()` methods, **not** a plain dict. Using bracket indexing silently returned `undefined`, which made the `fhir-hook` no-op and the bridge skip the SHARP headers.
3. The MCP server now returns Server-Sent Events (`data: <json>\n`) by default. The bridge was treating the body as raw JSON, so `JSON.parse` choked on the `data:` prefix and the catch path returned a placeholder.

**Fix:** Commit `4f13cd5`. Switch to `runner.runAsync({...stateDelta})` for both initial and follow-up turns; replace `state[key]` with `state.get(key)` (and `set` for writes); rewrite the bridge to (a) accept SSE by splitting on lines, filtering `data: ` prefixes, and taking the **last** non-empty line, and (b) fall back to plain JSON when no SSE markers are present.

**Lesson:** When two SDKs intersect, the integration layer is where the bugs live. Defensive parsing on both sides of the boundary is cheap insurance.

---

## 2. FHIR null-safety — the sandbox lies softly

**Symptom:** Tools crashed on real HAPI patients with `Cannot read property 'coding' of undefined` and similar — 7 different shapes, all variants of "this resource lacks the field your code assumed was there."

**Root cause:** The HAPI public R4 sandbox has **incomplete records**. Different patients have:
- `Condition.code.coding` present, `Condition.code.text` absent (or vice versa)
- `MedicationRequest.medicationCodeableConcept` populated; `medicationReference` populated; or only the deprecated `medication` field
- `Observation.valueQuantity` for one obs, `valueString` for the next, neither for a third
- `onsetDateTime` here, `onsetPeriod.start` there, `onsetAge` for one outlier

**Fix:** Seven defensive commits over a single afternoon (`a7c6501`, `4215494`, `8a458db`, `473ea0b`, `fb1e84c`, `fef1a57`, `f5ec9bd`). Every FHIR field access is now `?.`/`??` chained. Every tool wraps the full handler body in a try/catch that returns a graceful `Error: <reason>` text response rather than throwing.

**Lesson:** Production FHIR servers are messier than the spec suggests. If your code does not assume a field is missing, it will be missing on the patient the judges pick. Null-safe parsing is not optional for FHIR work.

---

## 3. OCR error fallback — duplicate-push bug

**Symptom:** When a `DocumentReference` had no attachment binary, the OCR tool emitted **two** error entries for the same document into the `results` array, and the agent saw a misleading "two failed documents" message.

**Root cause:** The no-attachment branch was both pushing an error result *and* falling through to the OCR catch block, which pushed another error.

**Fix:** Commit `f5ec9bd`. Branch cleanly on the no-attachment path with a `continue` so each document produces exactly one result entry.

**Lesson:** Early-exit branches and try/catch cleanup paths can both append. Code review the `for`-loop body as a state machine, not just a happy-path narrative.

---

## 4. Local embeddings vs. cloud RAG

**Symptom:** Initial RAG implementation used OpenAI embeddings. During testing the rate limit hit twice during a single demo dry-run (we were sending duplicate queries because of an upstream caching bug). Worse, requiring an `OPENAI_API_KEY` made the deployment story messier.

**Root cause:** Cloud-only RAG is a fragile dependency for a hackathon demo where every minute counts.

**Fix:** Commit `bc3e0e3`. Replaced OpenAI embeddings with `@xenova/transformers` running `all-MiniLM-L6-v2` locally inside Node. Loads in ~3 seconds on first call; thereafter, queries are zero-latency, zero-cost, zero-key.

**Trade-off:** Model is small (22 MB, 384-dim), so retrieval quality is below `text-embedding-3-large`. For 244 chunks of CMS NCD policy, it is more than enough — top-3 results are consistently the policy text we expect.

**Lesson:** Local-first is a real architectural posture, not just a frugality move. It removes a runtime dependency, a key, a quota, and a network round-trip from your hot path.

---

## 5. RAG vector-store stale index on rebuild

**Symptom:** Calling the rebuild endpoint after a chunking-pipeline change returned the *old* index. New chunks weren't searchable until the process was restarted.

**Root cause:** `vectra` does not auto-invalidate the in-memory `LocalIndex` reference when the underlying file is replaced. A rebuild that wrote to disk left the existing reference pointing at the stale snapshot.

**Fix:** Commit `612704b`. Delete the index directory **before** recreate. Reassign the `idx` reference after rebuild (not just refresh in-place). Handle the case where a corrupted index file exists from a partial previous write.

**Lesson:** "In-process state + file persistence" is a known-bad combination. Either be fully stateless (re-read on every query) or fully in-memory (no file). The hybrid is a footgun.

---

## 6. CMS NCD ingestion — URLs and HTML entities

**Symptom:** Initial NCD scrape pulled back garbled text — `&quot;` and `&#39;` literals appearing in retrieved chunks, plus 404s on a third of the policies.

**Root cause:** Two issues compounded:

1. CMS migrated some policy URLs in a recent CMS.gov refresh; we had stale URLs hard-coded.
2. Standard `decodeHTMLEntities` only handled named entities (`&amp;`, `&lt;`); numeric entities (`&#39;`, `&#NNN;`) leaked through.

**Fix:** Commit `f10aa6e`. Updated the URL list, expanded HTML-entity decoding to handle numeric forms, and added a fallback bundle of 12 NCD policies bundled with the repo so the demo never depends on a live CMS.gov fetch.

**Lesson:** External content sources move. Bundle the data you actually depend on; treat fresh fetches as "would be nice" rather than "load-bearing." Especially during a hackathon recording session.

---

## 7. Embeddings model download on cold container

**Symptom:** First Docker run failed: the embeddings module attempted to download the model from the Hugging Face hub during boot, but the container's `/data` volume wasn't writable on a fresh start, and the model download path threw with no useful error.

**Root cause:** `@xenova/transformers` writes to `~/.cache/huggingface` by default. In Docker that resolves to `/root/.cache/huggingface`, which on some volume configurations is read-only or not pre-created.

**Fix:** Commit `95236df`. Wrap the model import in a try/catch that catches both ESM-load failures and runtime download failures. Surface the underlying error message via the RAG service's `/health` endpoint so a failed container is diagnosable from outside. Pre-create the cache dir in the Dockerfile (`20aaacb`).

**Lesson:** "Works on my Mac" is the canonical Docker bug. Fail loudly with a useful message, not silently with a 500.

---

## 8. A2A v1 agent card format

**Symptom:** Agent card was being served at `/.well-known/agent-card.json`, but Prompt Opinion's marketplace validator rejected it. Field names had drifted between A2A v0.x and v1.

**Root cause:** Between the SDK we initially pinned and the v1 spec finalization:
- `interfaces` was renamed to `supportedInterfaces`
- Skill objects gained required `id` and `tags` fields
- The capabilities block changed shape

**Fix:** Commit `14b6cac`. Rewrote the agent card builder to v1 schema: `supportedInterfaces: [{protocol: "a2a", url}]`, every skill has `id`/`name`/`description`/`tags`, capabilities marks both `streaming: false` and `pushNotifications: false` honestly.

**Lesson:** Spec versions matter for marketplace publishing. Read the marketplace's own validator output, not just the SDK's typings.

---

## 9. MCP FHIR scope declaration shape

**Symptom:** MCP server's experimental FHIR-context capability was reported but the scopes list wasn't where the platform validator expected it.

**Root cause:** Initial implementation put scopes at the top level of capabilities. The actual contract: scopes live nested under the experimental extension key.

**Fix:** Commit `99b55d9`. Move the `scopes` array under `capabilities.experimental[FHIR_CONTEXT_EXTENSION]` so it's discoverable when the platform reads the capability. Listed all nine FHIR resources as `*.rs` (read + search) per SMART v2.

**Lesson:** Capability extensions need a stable URI to namespace them. Putting them at the top of `capabilities` collides with future spec additions.

---

## 10. Drift between analyzer and drafter — duplicate LLM calls

**Symptom:** A clean PA flow was making *three* LLM calls when the agent ran tools 9 (analyze) → 10 (draft). The analyzer ran once for 9; the drafter re-ran an analyzer-equivalent prompt internally for 10; and the agent's final response generation made a third aggregating pass.

**Root cause:** `draft_prior_auth_request` did its own implicit analysis instead of accepting the analyzer's output as input.

**Fix:** Commit `349ac1d`. The drafter accepts an optional `clinical_analysis` argument and an optional `policy_context` argument. The agent's orchestration prompt (after polish) now passes both, eliminating the redundant LLM round-trip. The drafter falls back to standalone analysis if either is missing — graceful degradation.

**Lesson:** Tool composition matters. If two tools both want the same upstream LLM analysis, one should consume the other's output rather than duplicate the work.

---

## 11. Server crash on un-handled tool exceptions

**Symptom:** A single throwing tool was killing the entire MCP server process, taking the other tools down with it.

**Root cause:** Express 5's async error propagation was returning a 500 to the client, but the underlying SDK's handler was rethrowing in a way that crashed the process if not caught at the top of the route.

**Fix:** Commit `67c626f`. Wrap the entire `/mcp` handler in an outer `try/catch`. On any unexpected error, return a 500 JSON response **and keep the server alive**. Log the error with stack but no PHI.

**Lesson:** A multi-tenant tool surface needs hermetic per-request error containment. One bad tool call must never take down the others.

---

## 12. Implicit transitive dependency

**Symptom:** RAG service worked in dev (where `axios` was installed transitively) but failed in a fresh CI install with `Cannot find module 'axios'`.

**Root cause:** A util used `axios` but the package wasn't declared in `rag-service/package.json`. It worked locally because npm hoisted it from the root MCP server's deps.

**Fix:** Commit `147f2d5`. Add `axios` as an explicit dependency.

**Lesson:** `npm install` in a fresh node_modules is the only honest test that your package.json is complete.

---

## 13. Demo-timing target — 90 seconds end-to-end

**Symptom:** Sequential tool runs were landing at ~110–130 seconds. Over-budget for the demo voiceover.

**Root cause:** Each FHIR-fetching tool was reading `Patient`, then `Condition`, then `MedicationRequest`, etc., in series. Six round-trips per tool, against a public sandbox with tail latency.

**Fix:** Architectural pass — every tool that needs more than one FHIR resource now uses `Promise.all` to fetch in parallel. Pre-warm the embeddings model on RAG service boot. Pre-cache the model file in the Docker image (`20aaacb`).

**Result:** Verified with `assets/verification.log` — 11 tools end-to-end now lands at **~43 seconds** wall-clock against HAPI public.

**Lesson:** Latency budgets are an architectural concern, not a "we'll optimize later." Plan parallelism into the data-fetching layer from day one.

---

## What didn't bite (but easily could have)

A few things we explicitly designed to avoid:

- **No state-store for sessions.** Stateless MCP server avoids an entire class of "leaky session" bugs.
- **No FHIR write operations.** Read-only by design — eliminates a long list of permission and idempotency concerns.
- **No real PHI in dev.** Public sandbox patients only. No `.env` files with sensitive identifiers.
- **No `console.log` of tokens or full bundles.** Audited via `grep` before each commit; no leaked credentials in logs.
- **No silent fabrication.** Prompts forbid invention; missing data is reported as missing, not invented. Verified end-to-end during the test client run — when test #4 was given a Humira-for-T2DM mismatch, the model surfaced "primary indication for Humira is not clearly documented" rather than playing along.

---

## How to verify the verification

The full 11-tool run is captured in `assets/verification.log`. To reproduce:

```bash
# Start RAG service (one-time, indexes on first boot)
cd rag-service && npm run start &

# Wait for "Index already exists with 244 chunks — ready"
# Run extended test client
cd .. && npx tsx test-client.ts 131926799 "Ozempic 0.5mg subcutaneous weekly"
```

Expected end-of-run line:

```
Result: 11 ok / 0 skipped / 0 error  (of 11 total)
All tools verified. Submission-ready.
```

---

## v2 addendum — closed-loop self-learning bugs we hit

After the v1 11-tool ship, the v2 upgrade added 7 tools, three persistent stores, PHI redaction, dose-safety pre-flight, and a Da Vinci PAS Bundle emitter. Bugs we caught and resolved (commit refs in parens):

### 14. metformin@eGFR<30 came out as "warning" not "block" (edf1c6a)
The dose-safety severity logic only escalated to block when eGFR was 10 below threshold. FDA boxed warning is absolute at 30. Added a `hardBlock: true` flag to the renal-adjusted-drugs map and propagated it through `severityOf`. Codeine, tramadol, doxycycline pediatric got the same treatment. Statins were removed from the pregnancy-category-X list per the 2021 FDA reclassification.

### 15. JSONL writers race under concurrent Express handlers (e9ee672)
Three append-only stores (audit, memory, calibration) used raw `appendFileSync` from inside async route handlers. Under concurrent traffic, payloads larger than `PIPE_BUF` (4 KiB Linux, 512 B macOS) could interleave and corrupt the stores that prove the learning loop works. Resolved with a tiny `src/util/jsonl.ts` per-file mutex (chained promises, in-memory). Calibration writes are well under PIPE_BUF and stay on the synchronous path with a comment explaining why.

### 16. PHI was crossing the LLM boundary unredacted (4eec149)
`scrubPHIObject` shipped in v2 but was never invoked in `draft_prior_auth_request` or `analyze_prior_auth_need`. Patient names, identifiers, and full DOBs were entering the Groq prompt verbatim — a BAA-violation in any production deployment. Wired the scrubber, with explicit redaction of `name`, `identifier`, and birthDate-beyond-year before any LLM call. The audit log records the redaction count + kinds per request.

### 17. hashEmbed dimensionality collapse (8505db6)
The fallback embedding (used when rag-service is unavailable) tiled a 32-byte SHA digest across 384 dimensions, so cosine similarity collapsed to ~1 for any pair of long inputs. Replaced with feature-hashing using a signed bucket trick: each token hashes to one bucket with ±1 sign, distinct tokens populate independent dimensions. Cosine now reflects token-set overlap as intended.

### 18. Calibration anti-correlation pulled probabilities the wrong way (66e8369)
`calibratedProbability` blended raw prediction with base rate via slope, but never guarded against a negative slope — a small calibration log with mostly-denials (slope < 0) would silently flip the calibration in the wrong direction. Added a hard guard: if slope < 0.3, return the base rate alone. Raised the activation threshold from N=5 to N=10 so noise-only slopes don't trigger.

### 19. SHARP token dropped when URL header omitted (9049de9)
`getFhirContext` returned null if `x-fhir-server-url` was absent, even when a bearer token was present. That made it impossible to test the auth path without also passing the URL. Adjusted: if either url or token is present, return a context with the env-default URL filled in.

### 20. Eval ran with all-fallback predictions when GROQ key was invalid
The submission shipped with a stale GROQ API key (locally only — never committed). The eval runner's first pass produced a flat 0.5 baseline because the LLM call kept hitting 401. Built `src/learning/heuristic-predictor.ts` (rule-based scoring + memory retrieval) so eval can run offline and produce defensible numbers. Cold Brier 0.047 → warm Brier 0.024 (49% calibration improvement) on the 20-scenario golden set. The heuristic also functions as the structural baseline an LLM predictor must beat.

### 21. predict_approval_probability skipped in test-client when GROQ not set
Test-client classified the new tool as `groq: true` and therefore skipped it without a key. The tool actually has a heuristic fallback. Reclassified as no-groq-required so the v2 chain runs end-to-end offline.

---

These were the 8 bugs caught between the v1 ship and the final v2 submission. None made it into a release artifact.
