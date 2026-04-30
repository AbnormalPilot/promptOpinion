# v2 Self-Learning Upgrade — Code Review

**Commit reviewed:** `7ef0981` vs parent `dc52b83`
**Reviewer:** Claude (gsd-code-reviewer)
**Scope:** New + modified files only — audit, memory, learning, clinical/dosing, provenance, 7 new tools, rewritten draft, eval harness.

Findings are ordered by severity. Each entry: file/lines → issue → why it matters → concrete fix.

---

## CRITICAL

### C1. Metformin @ eGFR < 30 emits `warning`, not `block` — FDA contraindication missed

**File:** `src/clinical/dosing.ts:48-54`

```ts
findings.push({
  level: input.egfr < v.thresholdEgfr - 10 ? "block" : "warning",
  ...
});
```

The threshold for metformin is 30 (table line 19). With `egfr === 25`, the code computes `25 < 30 - 10 → 25 < 20 → false`, so it emits `warning`. But the FDA label states metformin is **contraindicated when eGFR < 30** (boxed warning, lactic acidosis). At eGFR 29 the patient is in a hard-contraindication zone and `draftPriorAuthRequest` will happily generate the letter (severity = `warning`, not `block`).

Same logic flaw applies to every entry in `RENAL_ADJUSTED_DRUGS` — the "advice" string for metformin even says "Contraindicated when eGFR < 30," but the code never produces a block at that threshold.

**Why it matters (judging):** Clinical safety claim is the headline of this submission. A judge running the metformin/HbA1c demo with a Stage 4 CKD patient (eGFR 27) will see the system produce a PA letter for a contraindicated drug. That is a defensible reason to score the safety pillar to zero.

**Fix:** Per-drug severity policy, not a global -10 heuristic.

```ts
const RENAL_ADJUSTED_DRUGS: Record<string, {
  thresholdEgfr: number;
  blockEgfr?: number;       // hard contraindication
  advice: string;
}> = {
  metformin:   { thresholdEgfr: 45, blockEgfr: 30, advice: "..." },
  rivaroxaban: { thresholdEgfr: 50, blockEgfr: 30, advice: "..." },
  apixaban:    { thresholdEgfr: 25, advice: "..." },
  // ...
};

for (const [k, v] of Object.entries(RENAL_ADJUSTED_DRUGS)) {
  if (!drug.includes(k) || input.egfr == null) continue;
  if (v.blockEgfr != null && input.egfr < v.blockEgfr) {
    findings.push({ level: "block", message: `${k} contraindicated at eGFR ${input.egfr} (FDA threshold ${v.blockEgfr})`, recommendation: v.advice });
  } else if (input.egfr < v.thresholdEgfr) {
    findings.push({ level: "warning", message: `Renal dose adjustment required for ${k} at eGFR ${input.egfr}.`, recommendation: v.advice });
  }
}
```

---

### C2. Pediatric blackbox always `warning`, never `block` — codeine/tramadol under 12 are FDA-contraindicated

**File:** `src/clinical/dosing.ts:67-75`

`codeine` and `tramadol` carry FDA boxed warnings explicitly contraindicating use under age 12 (the table comment even says so). All pediatric findings hardcode `level: "warning"`, so the draft will not be blocked when a 9-year-old patient is being prescribed codeine.

**Fix:** Carry a `block: boolean` per entry.

```ts
const PEDIATRIC_BLACKBOX: Record<string, { minAge: number; reason: string; block?: boolean }> = {
  ciprofloxacin: { minAge: 18, reason: "...", block: false },
  codeine:       { minAge: 12, reason: "...", block: true },
  tramadol:      { minAge: 12, reason: "...", block: true },
  doxycycline:   { minAge: 8,  reason: "...", block: true },
  aspirin:       { minAge: 16, reason: "...", block: false },
};
// ...
findings.push({ level: v.block ? "block" : "warning", ... });
```

---

### C3. Statins listed as Pregnancy Category X — incorrect, severity overstated

**File:** `src/clinical/dosing.ts:29-33`

```ts
const PREGNANCY_CATEGORY_X: string[] = [
  "isotretinoin", "warfarin", "methotrexate", "thalidomide", "lenalidomide",
  "ribavirin", "finasteride", "leflunomide", "atorvastatin", "rosuvastatin",
  "simvastatin", "lovastatin", "fluvastatin", "pravastatin",
];
```

In 2021 the FDA **removed the contraindication for statins in pregnancy** (and the old A/B/C/D/X letter system was retired in 2015). Hard-blocking PA for any statin in any pregnant patient is clinically wrong now and will produce false-positive blocks. Warfarin, isotretinoin, methotrexate, thalidomide, lenalidomide, leflunomide, ribavirin, finasteride remain correct.

**Fix:** Remove all six statins from the list. Either drop the constant name's "X" reference (pregnancy categories are deprecated) or rename to `PREGNANCY_AVOID`.

```ts
const PREGNANCY_AVOID: string[] = [
  "isotretinoin", "warfarin", "methotrexate", "thalidomide",
  "lenalidomide", "ribavirin", "finasteride", "leflunomide",
];
```

---

### C4. `appendFileSync` JSONL writes are not concurrency-safe

**Files:**
- `src/audit/middleware.ts:29` (audit.jsonl — every request, very high write rate)
- `src/memory/store.ts:75` (memory.jsonl)
- `src/learning/calibration.ts:21` (calibration.jsonl)

`appendFileSync` is atomic only for writes ≤ `PIPE_BUF` (4 KB on Linux, 512 B on macOS). A serialized `MemoryRecord` includes a 384-element embedding (~5–8 KB) — already past `PIPE_BUF` on macOS and may be on Linux. Two concurrent MCP requests calling `record_pa_outcome` can interleave bytes mid-line, corrupting the JSONL. The audit log is the worst case: every request writes two events (`request_in`, `request_out`) plus one per tool call, all from the same Node process under concurrent load (MCP server is `app.use(express.json)` plus `app.post("/mcp")` — fully concurrent).

The in-memory `cache` in `store.ts` (line 28) compounds the issue: two concurrent `recordCase` calls each `cache.push(record)` and each `appendFileSync`, with no mutex — fine for the cache (Node is single-threaded for JS), but the disk write order is not guaranteed to match the in-memory order, so a crash mid-batch leaves disk and cache divergent.

**Why it matters:** Self-learning loop's audit trail is a key submission claim. Corrupted JSONL means `JSON.parse` throws on `load()` (store.ts:43), `cache = []` silently swallows the exception (line 45 — `console.error` only), and **all prior memory is lost** for the rest of the process. Calibration data degrades silently.

**Fix:** Serialize writes through a per-file queue.

```ts
// src/util/jsonl.ts (new)
const queues = new Map<string, Promise<void>>();
export async function appendJsonl(path: string, obj: unknown): Promise<void> {
  const line = JSON.stringify(obj) + "\n";
  const prev = queues.get(path) ?? Promise.resolve();
  const next = prev.then(() => fs.promises.appendFile(path, line));
  queues.set(path, next.catch(() => {}));
  return next;
}
```

Replace all three `appendFileSync` call sites with `await appendJsonl(...)`. Tighten the `load()` recovery path to skip individual malformed lines instead of zeroing the cache:

```ts
cache = lines.flatMap((l) => {
  try { return [JSON.parse(l) as MemoryRecord]; } catch { return []; }
});
```

---

### C5. PHI is sent unredacted to the LLM in `draftPriorAuthRequest`

**File:** `src/tools/draftPriorAuthRequest.ts:63-103, 119-123`

`patientData` is built directly from FHIR without going through `scrubPHIObject`, then JSON-stringified into the LLM prompt: `Patient data: ${JSON.stringify(patientData, null, 2)}`. That payload includes:
- Full `name` (line 66 → `formatName`),
- Raw `birthDate` (line 67),
- All `identifier[].value` including MRNs (line 70),
- `valueString` observation values which can contain free-text PHI (line 98).

The audit middleware hashes the patient ID for the request log, but the actual prompt going to Groq has the raw name, full DOB, and MRNs. The PHI redactor in `src/audit/redact.ts` is never invoked anywhere in the new code path (grep `scrubPHI` — zero call sites outside its own file).

**Why it matters:** "PHI scrubbing" is named in the upgrade description and judges will check it. Right now the scrubber exists but is dead code. Court-grade-provenance + PHI-leak-to-third-party is a contradictory pair.

**Fix:** Either (a) call `scrubPHIObject(patientData)` immediately before JSON.stringify into the prompt, or (b) explicitly construct an LLM-safe view that strips name, full DOB, identifiers, telecom, and address. Option (b) is preferable because the redactor's regex may miss embedded PHI in observation `valueString`s.

```ts
const llmSafe = {
  ...patientData,
  patient: {
    ...patientData.patient,
    name: "[REDACTED]",
    birthDate: patientData.patient.birthDate?.slice(0, 4) ?? null, // year only
    identifier: [],
  },
  observations: patientData.observations.map((o) => ({
    ...o,
    value: typeof o.value === "string" ? scrubPHIString(o.value).text : o.value,
  })),
};
userMessage += `\nPatient data: ${JSON.stringify(llmSafe, null, 2)}`;
```

The actual letter still needs the real name/DOB to be useful, so generate the letter referring to "the patient" and let a final post-processing step substitute real identifiers locally before clinician review. Add an audit event recording that scrubbing ran.

---

## HIGH

### H1. `hashEmbed` is not a valid embedding — cosine similarity is meaningless on it

**File:** `src/memory/embed.ts:24-36`

```ts
for (const tok of tokens) {
  const h = createHash("sha256").update(tok).digest();
  for (let i = 0; i < dim; i++) {
    vec[i] += (h[i % h.length] - 128) / 128;
  }
}
```

`h.length` is 32 (SHA-256 = 32 bytes). For `i in [0, 384)`, `h[i % 32]` cycles 12 times, so each token contributes the same 32 byte values to all 384 dimensions in 12 repeated tiles. After normalization the resulting vector is **dim-32, not dim-384** — different tokens still produce different vectors, but the effective similarity is computed in a 32-d space and dominated by which tokens are present, not by token semantics. Worse, `(h[i%32] - 128)/128` produces a roughly mean-zero distribution per token, so when many tokens are summed the central limit theorem pulls every long document toward the same vector, making cosine similarity trend toward 1 for any pair of long inputs. The 0.3 retrieval cutoff in `store.ts:97` will be passed by essentially every query, so memory retrieval surfaces irrelevant cases as "similar."

**Why it matters:** The fallback runs every time the rag-service is unreachable, including all of the offline `loop-smoke.ts` and any judge running with `RAG_SERVICE_URL` unset. The "memory retrieval works offline" claim is hollow.

**Fix:** Use a different hash byte per dimension via additional hashing (BLAKE2 / SHA-256 with a dimension salt), or use a feature-hashing trick that gives every dimension an independent token signature.

```ts
export function hashEmbed(text: string, dim = 384): number[] {
  const tokens = text.toLowerCase().match(/[a-z0-9]+/g) || [];
  const vec = new Array(dim).fill(0);
  for (const tok of tokens) {
    // Hash each token into a single bucket with a signed weight (feature hashing).
    const h = createHash("sha256").update(tok).digest();
    const bucket = h.readUInt32BE(0) % dim;
    const sign = (h[4] & 1) ? 1 : -1;
    vec[bucket] += sign;
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}
```

Also raise the similarity floor from 0.3 → ~0.5 once you switch to real embeddings; with the hash-fallback the threshold is roughly meaningless and should probably be skipped (return 0 priors when the rag-service is down rather than serving noise).

---

### H2. `calibratedProbability` slope formula breaks for small N and never widens uncertainty

**File:** `src/learning/calibration.ts:56-73`

Two issues:

1. With `n=5–10` points the regression slope is dominated by noise; the early-life calibrator can pull confident, correct predictions toward a wildly wrong base rate. The "5 points" trigger (line 58) is far too low — five denials in a row will set `meanA = 0` and pull every subsequent rawP toward zero.
2. The `blend` floor at 0.3 (line 71) is an arbitrary clamp that is applied even when slope is negative (model anti-correlated with reality — usually a sign of bug, not over-confidence). With `slope = -0.5`, code ends up with `blend = max(0.3, min(1, -0.5)) = 0.3` and silently mixes 30% rawP + 70% baseRate. That hides a real problem.

Also: the function computes `loadPoints()` on every prediction (line 57). For an audit-loaded calibration file this becomes a per-prediction O(N) disk read.

**Why it matters:** "Brier-score calibration with temperature scaling" is a flagship submission claim. Cherrypicked judge demos with <10 outcomes will produce nonsensical calibrated probabilities.

**Fix:**
- Bump the trigger threshold (`pts.length < 30` minimum, ideally bin by drug or by similarity bucket).
- Reject negative slopes — fall back to identity.
- Cache loaded points or accept points as parameter.

```ts
let cached: { mtime: number; pts: CalibrationPoint[] } | null = null;
function loadPointsCached() { /* re-read only when CALIB_PATH mtime changes */ }

export function calibratedProbability(rawP: number): number {
  const pts = loadPointsCached();
  if (pts.length < 30) return rawP;
  const slope = computeSlope(pts);
  if (slope <= 0 || (slope >= 0.9 && slope <= 1.1)) return rawP;
  const baseRate = pts.reduce((s, p) => s + p.actual, 0) / pts.length;
  const blend = Math.max(0.5, Math.min(1, slope)); // never less than 50% rawP
  return blend * rawP + (1 - blend) * baseRate;
}
```

---

### H3. SHARP token swallowed when only `x-patient-id` is set, no FHIR URL

**File:** `src/index.ts:37-43`

```ts
const ctx = getFhirContext(req);              // returns null if no x-fhir-server-url
const sharpPatientId = getPatientId(req);
const fhirConfig = ctx
  ? { ...ctx, patientId: sharpPatientId || undefined }
  : sharpPatientId
    ? { patientId: sharpPatientId }
    : undefined;
```

If a caller sends `x-fhir-access-token` and `x-patient-id` but omits `x-fhir-server-url` (e.g. they assume the server uses its env default), `ctx` is null and the token is silently dropped — `fhirConfig = { patientId: ... }` with no token. The FHIR client falls back to env vars and never attempts to use the supplied bearer token. That's an auth-context loss bug.

**Why it matters:** SHARP-on-MCP correctness is a graded feature. A perfectly valid SMART/SHARP caller can have its token dropped.

**Fix:** Always include the token if present, defaulting URL to env.

```ts
const fhirUrl = req.headers[SHARP_HEADERS.fhirServerUrl]?.toString() || process.env.FHIR_BASE_URL;
const fhirToken = req.headers[SHARP_HEADERS.fhirAccessToken]?.toString();
const sharpPatientId = getPatientId(req);
const fhirConfig = (fhirUrl || fhirToken || sharpPatientId)
  ? { url: fhirUrl, token: fhirToken, patientId: sharpPatientId || undefined }
  : undefined;
```

---

### H4. Audit log writes raw FHIR URL but no marker for whether token was redacted in body

**File:** `src/audit/middleware.ts:43-55`

`fhirUrl` is logged verbatim, which can include tenant tokens in the path (some EHRs put a session token in the URL). `tokenPresent` only signals header presence. The middleware logs the full request path (`req.path`) but never the body — fine — yet `req.body` contains tool args including patient-name lookups in custom tools. There is no audit marker for body-redaction status.

**Why it matters:** Court-grade audit trail is the headline. Inconsistent redaction = lawyer ammunition.

**Fix:** Strip token-like query params before logging URL; explicitly state in the schema that body is not logged.

```ts
const safeFhirUrl = fhirUrl ? new URL(fhirUrl).origin + new URL(fhirUrl).pathname : null;
```

---

### H5. `loadPatterns` / `savePatterns` race — last-writer-wins on `patterns.json`

**File:** `src/learning/patterns.ts:18-30, 54-72`

`recordFindings` does `loadPatterns → mutate → savePatterns(writeFileSync)`. Two concurrent adversarial reviews both load the same array, each mutates locally, both `writeFileSync` — second write clobbers first. Counts will under-report.

**Fix:** Same JSONL-queue trick, or read-modify-write under a per-file mutex. Simpler: append-only events log + reduce on read.

```ts
// keep events as JSONL; compute aggregates on read
appendJsonl("data/pattern-events.jsonl", { ts, drug, finding_id });
// topPatterns() folds the events on demand
```

---

### H6. `clearMemory` empties cache to `[]` but does not reset to `null` until `reloadMemory`

**File:** `src/memory/store.ts:115-118`

```ts
export function clearMemory() {
  cache = [];
  if (existsSync(MEMORY_PATH)) writeFileSync(MEMORY_PATH, "");
}
```

After `clearMemory()`, `load()` returns `cache` (already `[]`) and never re-reads. Fine for tests. But if the file is repopulated externally between calls (eval harness), nothing notices. The `reloadMemory` function exists but isn't called anywhere — verify the eval loop uses it.

**Fix:** Either delete `clearMemory` and use `reloadMemory` exclusively, or document the lifecycle.

---

## MEDIUM

### M1. `safeParseJSON` failure path silently masks truncated/garbled LLM output

**Files:** all new tools, e.g. `predictApprovalProbability.ts:60-68`, `adversarialReview.ts:41-46`

The fallback object on JSON parse failure ships zero-effort defaults (e.g. `predicted_probability: 0.5`, `denial_probability_if_submitted_as_is: 0.5`) and the calling code happily logs it to calibration / writes it to memory as if it were a real prediction. A run of N timeouts or rate-limit truncations populates calibration and memory with `0.5`/`0` predictions and degrades the system over time.

**Fix:** Distinguish parse failure from prediction. Throw or return a marker object that upstream code refuses to log.

```ts
const parsed = safeParseJSON<PredictResponse | null>(raw, null);
if (!parsed) {
  return textResponse(JSON.stringify({ error: "LLM parse failed", raw_first_200: raw.slice(0, 200) }));
}
```

And in `recordOutcome.ts`: also skip `logPrediction` if `predicted_probability == 0.5` and the parsed marker indicates parse-failure default.

---

### M2. `auditTool` is exported but never called

**File:** `src/audit/middleware.ts:69-77`

Defined but no call site (grep confirms). Tools log `mcp_session_open` once but never the per-tool invocations. The "every tool call audited" claim is not true.

**Fix:** Wrap the tool registration loop to inject audit calls, or have each tool call `auditTool(...)` at the top of its handler. Simplest:

```ts
// in src/index.ts inside POST /mcp
const origTool = server.tool.bind(server);
server.tool = (name, desc, schema, handler) => origTool(name, desc, schema, async (args, extra) => {
  auditTool(req.traceId, name, req.patientHash, { args_keys: Object.keys(args || {}) });
  return handler(args, extra);
});
```

(Type signatures will need adjusting; the goal is one audit event per tool invocation.)

---

### M3. `retrieveSimilar` fetches the whole corpus into memory every call and re-embeds the query

**File:** `src/memory/store.ts:85-98`

`load()` is cached per process, but `corpus.map(...)` does `cosine` over every record on each retrieval. Fine for hundreds of records, will be 500ms+ at 10k. More importantly, `embed(caseText(...))` always hits rag-service even when the eval harness clears memory between cases — no embedding cache for the query text.

**Fix (cheap):** Memoize embedding by query string with a small LRU. Not a v1 blocker; flag as scaling concern.

---

### M4. `auditMiddleware` writes to disk synchronously in the request hot path

**File:** `src/audit/middleware.ts:29, 36-67`

`appendFileSync` blocks the event loop. Combined with the JSONL race condition (C4), every request pays a sync I/O cost on `request_in`, plus another on `request_out`. Under load this becomes throughput-limiting.

**Fix:** After moving to the queue in C4, the writes become fire-and-forget Promises — but ensure errors are still caught. Avoid `await` in middleware so response isn't gated on disk I/O.

---

### M5. `pickEgfr` only matches obs by display string — misses LOINC code

**File:** `src/tools/draftPriorAuthRequest.ts:182-193`

Filters on `display` regex `/egfr|glomerular/i`. Many FHIR servers populate only the LOINC `code` (`33914-3`, `48642-3`, `48643-1`) and an opaque display. eGFR will silently be `null` and the renal safety check will not run.

**Fix:** Also match by LOINC code.

```ts
const EGFR_LOINC = new Set(["33914-3", "48642-3", "48643-1", "62238-1", "98979-8"]);
const candidates = observations.filter((o: any) => {
  const code = o.code?.coding?.[0]?.code || "";
  const display = (o.code?.coding?.[0]?.display || o.code?.text || "").toLowerCase();
  return EGFR_LOINC.has(code) || /egfr|glomerular/.test(display);
});
```

---

### M6. `isPregnant` over-matches "history of pregnancy" and "non-pregnant"

**File:** `src/tools/draftPriorAuthRequest.ts:195-201`

`/pregnan/i` matches "history of pregnancy", "non-pregnant status", "pregnancy test negative" — none of which mean the patient is currently pregnant. Will produce false-positive blocks for category-X drugs.

**Fix:** Match condition codes (SNOMED `77386006` "Pregnant", `289908002` "Pregnancy"), and exclude conditions whose `clinicalStatus` is `inactive` or `resolved`. Or simply check FHIR `Observation` LOINC `82810-3` "Pregnancy status" with code "LA15173-0" (pregnant).

---

### M7. `KEEP_PARTIAL` birthDate handling produces malformed dates

**File:** `src/audit/redact.ts:58-61`

`v.slice(0, 4) + "-XX-XX"` assumes ISO `YYYY-MM-DD`. If `birthDate` is just `1955` (FHIR allows year-only) the output is `1955-XX-XX` (still parses oddly). If it's `1955-03` the output is `1955-XX-XX` (loses the month even though the month was already partial). Edge cases, but produces audit-format inconsistency.

**Fix:** Switch on length:

```ts
if (KEEP_PARTIAL.has(k) && typeof v === "string") {
  out[k] = v.length >= 4 ? v.slice(0, 4) : "[REDACTED-DOB]";
}
```

---

### M8. RAG `/embed` endpoint has no rate limit or auth

**File:** `rag-service/src/index.ts:78-94`

`/embed` runs the local transformer model. Anyone with network access to port 3001 can flood it. No max-requests, no auth, no IP allowlist. In Docker compose this is internal-only, but if `RAG_SERVICE_URL` is exposed it's an open compute endpoint.

**Fix:** Optional shared-secret header (`x-internal-key`) gated on env var; document that the service is intended for in-cluster only.

---

### M9. `predictApprovalProbability` does not log the prediction to calibration

**File:** `src/tools/predictApprovalProbability.ts`

Predictions are made and returned, but `logPrediction` is only called from `recordOutcome.ts`. That means calibration data only includes cases where someone manually called `record_pa_outcome`. If a clinician asks for a prediction and never circles back with the outcome, calibration silently underrepresents real-world predictions. (Acceptable design choice — but the README claim of "every prediction calibrated" needs the prediction-side too.)

**Fix:** Either log a "prediction made, outcome unknown" event in a separate file, or document explicitly that calibration only includes confirmed outcomes.

---

## LOW

### L1. Phone regex over-matches — flags normal long digit strings

**File:** `src/audit/redact.ts:2`

`/\b(\+?1[-.\s]?)?(\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g` will match medical record numbers formatted like `123-456-7890` or `(800) 555-1234` inside legitimate medical text. Good (those are PHI). But it also matches FHIR resource IDs with embedded dashes (`abc-123-456-7890`)? No — the leading `\b` and `\(?\d{3}\)?` require digits in the first group, so resource IDs with letters are fine. Acceptable.

But the `EMAIL_RE` `\b[\w.+-]+@[\w-]+\.[\w.-]+\b` matches LDAP-style identifiers in some EHRs. Low priority.

---

### L2. `formatName` returns "Unknown" — but FHIR name array can have multiple uses

**File:** `src/tools/draftPriorAuthRequest.ts:167-171`

Always picks `names[0]`. If the first entry is `use: "old"` and the second is `use: "official"`, you'll print the old name. Edge case.

**Fix:** `names.find((n: any) => n.use === "official") ?? names[0]`.

---

### L3. `data_completeness` is binary-ish (3/2/<=1) and ignores observation freshness

**File:** `src/tools/draftPriorAuthRequest.ts:203-209`

A patient with one stale 5-year-old condition and zero obs scores `partial`. Fine for v1.

---

### L4. Tool description for `record_pa_outcome` says "after the payer responds" but `pending` is still allowed

**File:** `src/tools/recordOutcome.ts:19`

Including `pending` in the enum allows recording a "non-outcome" that pollutes memory.

**Fix:** Either remove `pending` from the enum or skip `recordCase` when outcome === `pending`.

---

### L5. `axios` timeouts (8s rag-service, 8s RxNav, 6s) inconsistent and not configurable

**Files:** `src/memory/embed.ts:12`, `src/tools/costAlternativeAnalysis.ts:15, 34`

Hardcoded literals. Move to env vars for tuning.

---

### L6. TypeScript: `auditMiddleware` mutates `req` with declared globals — ok — but `req.body` is `any` everywhere

**File:** `src/index.ts:35` and tools

`safeParseJSON<any>` (`draftPriorAuthRequest.ts:142`) erodes strictness. Strictness flagged as a review focus — there are several `any` casts across the new tool code where typed FHIR resources would be safer (`MedicationRequest`, `Condition`, `Observation`).

**Fix:** Adopt minimal interfaces in `src/fhir/types.ts` and import. Lower priority.

---

### L7. `/health` exposes Brier score and memory size — useful, but unauthenticated

**File:** `src/index.ts:22-32`

Reveals operational signal (number of cases processed, calibration quality) to anyone hitting the port. Probably fine for a demo, but mark as a deploy-time decision.

---

### L8. `recordFindings` truncates `example_drugs` with `shift()` — drops the *oldest*, not least-relevant

**File:** `src/learning/patterns.ts:65`

Minor; sliding window is fine.

---

### L9. `cost_alternative_analysis` swallows RxNav errors silently

**File:** `src/tools/costAlternativeAnalysis.ts:25-27, 38-40`

`catch { return []; }` and `catch { return null; }` — the LLM is then told `RxNorm-related drugs (raw): (none)` and confidently invents alternatives. No user-visible signal that RxNav was unreachable.

**Fix:** Track API status and include in the response so clinicians know the LLM ran without RxNorm anchoring.

---

### L10. `eval/loop-smoke.ts` and `eval/run.ts` not reviewed for runtime safety

Out of scope for the safety-critical path, but if these are run by a judge they should fail-loud rather than fail-silent if `data/` is non-writable.

---

## Summary

The v2 self-learning scaffolding is in the right shape, but the safety-critical pieces have correctness bugs that will undercut the submission's headline claims. The highest-risk findings are: **(C1, C2)** the dose-safety severity logic emits `warning` where FDA mandates a hard block (metformin <30 eGFR, codeine <12y, tramadol <12y) so contraindicated PA letters can still be drafted; **(C3)** statins are wrongly listed as pregnancy category X, producing false-positive blocks; **(C4)** all three JSONL stores (audit, memory, calibration) use raw `appendFileSync` from a concurrent Express server, so the records that prove the learning loop works can interleave and corrupt under load; **(C5)** the PHI redactor is implemented but never invoked — patient names, full DOBs, and MRNs are sent verbatim into the Groq prompt in `draftPriorAuthRequest`. On the learning math: **(H1)** the `hashEmbed` fallback collapses to a 32-d space repeated 12 times so cosine similarity is dominated by token presence and the 0.3 floor admits noise; **(H2)** temperature scaling kicks in at N=5 and silently anti-correlates negative slopes. On auth: **(H3)** SHARP token is dropped when the URL header is absent. The remaining medium/low items cover dead-code audit paths, eGFR/pregnancy detection misses, race-prone `patterns.json` writes, and cosmetic regex/timeout issues.

Concrete fix code is included for every Critical and High finding above.

Reviewed paths:
- /Users/himanshu/Desktop/promptOpinion/src/audit/middleware.ts
- /Users/himanshu/Desktop/promptOpinion/src/audit/redact.ts
- /Users/himanshu/Desktop/promptOpinion/src/memory/store.ts
- /Users/himanshu/Desktop/promptOpinion/src/memory/embed.ts
- /Users/himanshu/Desktop/promptOpinion/src/learning/patterns.ts
- /Users/himanshu/Desktop/promptOpinion/src/learning/calibration.ts
- /Users/himanshu/Desktop/promptOpinion/src/clinical/dosing.ts
- /Users/himanshu/Desktop/promptOpinion/src/provenance/types.ts
- /Users/himanshu/Desktop/promptOpinion/src/tools/predictApprovalProbability.ts
- /Users/himanshu/Desktop/promptOpinion/src/tools/suggestCounterfactualEvidence.ts
- /Users/himanshu/Desktop/promptOpinion/src/tools/adversarialReview.ts
- /Users/himanshu/Desktop/promptOpinion/src/tools/patientExplainer.ts
- /Users/himanshu/Desktop/promptOpinion/src/tools/costAlternativeAnalysis.ts
- /Users/himanshu/Desktop/promptOpinion/src/tools/recordOutcome.ts
- /Users/himanshu/Desktop/promptOpinion/src/tools/learningStats.ts
- /Users/himanshu/Desktop/promptOpinion/src/tools/draftPriorAuthRequest.ts
- /Users/himanshu/Desktop/promptOpinion/src/tools/index.ts
- /Users/himanshu/Desktop/promptOpinion/src/index.ts
- /Users/himanshu/Desktop/promptOpinion/src/llm/prompts.ts
- /Users/himanshu/Desktop/promptOpinion/rag-service/src/index.ts
- /Users/himanshu/Desktop/promptOpinion/src/sharp/context.ts (cross-checked for H3)
