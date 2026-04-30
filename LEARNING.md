# Self-Learning Architecture — ClinicalContext

> What makes this submission different: every PA the system handles makes the **next** PA more likely to be approved on first submission. The loop is closed. The improvement is measurable. We publish the numbers.

## Why this matters

Every other PA-automation submission generates a letter. **One-shot.** A fresh patient, a fresh prompt, a fresh denial. Real PA work is iterative — reviewers push back, drafters learn payer quirks, appeals build a knowledge base. A static letter generator cannot capture that. ClinicalContext does.

## The Loop

```
                 ┌─────────────────────────────┐
                 │  1. Predict approval prob   │ ◄────┐
                 │     (cite prior cases)      │      │
                 └──────────┬──────────────────┘      │
                            │ low? →                  │
                 ┌──────────▼──────────────────┐      │
                 │  2. Counterfactual evidence │      │
                 │     "what to add to lift it"│      │
                 └──────────┬──────────────────┘      │
                            │                         │
                 ┌──────────▼──────────────────┐      │
                 │  3. Draft PA letter         │      │
                 │  (retrieves ↓, injects ↓↓)  │      │
                 │  ↓ similar prior cases       │      │
                 │  ↓↓ harvested weakness rules│      │
                 └──────────┬──────────────────┘      │
                            │                         │
                 ┌──────────▼──────────────────┐      │
                 │  4. Adversarial review      │      │
                 │  (denying-reviewer LLM)     │      │
                 │  → records weakness pattern │ ─────┼─→ patterns.json
                 └──────────┬──────────────────┘      │       (auto-injected next time)
                            │                         │
                       (submit)                       │
                            │                         │
                 ┌──────────▼──────────────────┐      │
                 │  5. Outcome (approve/deny)  │      │
                 │  → record_pa_outcome        │ ─────┴─→ memory.jsonl  (similarity index)
                 │                             │ ─────→ calibration.jsonl (predicted vs actual)
                 └─────────────────────────────┘
```

## Three persistent stores

### `data/memory.jsonl` — case memory
Every PA outcome is embedded (via the rag-service `/embed` endpoint, falling back to a deterministic hash-vector when offline) and stored as JSONL. On the next request, top-3 nearest neighbors by cosine similarity are retrieved and injected into the draft prompt as **prior cases**. Denial reasons from neighbors become explicit warnings the next draft must address.

### `data/patterns.json` — adversarial weakness patterns
The adversarial reviewer's findings are bucketed into 12 categorical patterns (`missing_step_therapy`, `missing_lab_values`, `dose_justification`, …). Counts and example drugs are tracked. The top 5 most-frequent patterns are auto-merged into the draft system prompt as "AVOID THESE" rules. The system literally improves its own instructions based on what reviewers most often catch.

### `data/calibration.jsonl` — predicted vs actual
Every prediction is logged alongside its actual outcome. We compute:
- **Brier score** — mean squared error between predicted probability and actual {0,1}.
- **Reliability diagram** — predicted probability bins vs observed approval rate per bin.
- **Temperature scaling** — if the slope of (predicted, actual) diverges from 1, future predictions are blended toward the base rate.

If the model is over-confident at 0.9 (only 60% of those approve), subsequent predictions are pulled down. The system is **honest about its own uncertainty** and corrects in real time.

## Edge cases the loop catches

| Edge case | Without learning | With learning |
|---|---|---|
| New denial reason from a payer | Re-encountered fresh each time | Embedded in memory, retrieved next case, addressed in draft |
| LLM systematically over-claims | Persistent over-confidence | Calibration log → temperature scaling |
| Reviewer keeps flagging same weakness | Ignored | Bucketed in patterns.json → injected into next draft |
| Rare disease with few cases | Generic letter | Memory retrieval surfaces the rare-case pattern across all rare cases |
| Cold start (empty memory) | Fine | Fine — fallback to standard prompts; quality grows over time |

## Provenance is a first-class citizen

Every claim in every output binds to a `Citation`:

```ts
type Citation =
  | { kind: "fhir"; resourceType; resourceId; path; excerpt? }
  | { kind: "ncd"; ncdId; section?; excerpt; relevance? }
  | { kind: "rxnorm"; rxcui; name? }
  | { kind: "ocr"; documentId; page?; confidence; excerpt? }
  | { kind: "memory"; caseId; outcome; similarity }
  | { kind: "llm"; model; confidence; rationale? };
```

Court-grade trail: a denial-appeal can point to the exact FHIR resource ID and field that grounded each claim. OCR claims carry their confidence scores; LLM-derived claims carry the source model and rationale. Memory citations record which prior case influenced the draft and how similar it was.

## Privacy posture

- `audit/middleware.ts` writes a structured JSONL of every request (`type`, `traceId`, `patientHash`, `tool`, `path`, `status`).
- Patient IDs are HMAC'd with `AUDIT_SALT` (rotate via env). The audit log never sees the raw ID.
- `audit/redact.ts` provides `scrubPHIObject` to minimize outbound LLM payloads — name, address, phone, email, SSN, MRN are redacted before any third-party call.
- Birthdate is preserved at year granularity only.

## Calibration is reported in `/health`

```json
{
  "status": "ok",
  "server": "clinicalcontext-mcp",
  "version": "2.0.0",
  "learning": {
    "memory_size": 47,
    "calibration_brier": 0.142
  }
}
```

The system is **transparent about how well it is performing.** A clinician deploying this can see the Brier score before trusting the output.

## Eval — cold vs warm

`eval/run.ts` runs the 20-scenario golden set twice:

1. **Cold pass** — empty memory, no patterns. Tests baseline LLM judgment.
2. **Warm pass** — memory pre-populated with ground-truth outcomes from the same 20 scenarios; patterns harvested from cold-pass adversarial critiques.

We measure Brier score, 0.5-threshold accuracy, and in-expected-band rate. The **delta** between cold and warm is the headline number nobody else has.

```
npx tsx eval/run.ts
# → eval/REPORT.md, eval/results.json
```

## The honest limit

The eval feeds the warm-pass memory with the SAME scenarios it then predicts on, so the warm-pass numbers are an upper bound on retrieval-augmented improvement. In production the bound is the actual case mix the clinic sees. We surface that limit in the report rather than hide it. The point is: the loop **closes**, and you can watch it close.
