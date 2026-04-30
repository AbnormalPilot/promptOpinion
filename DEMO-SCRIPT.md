# Demo Video Shooting Script — v2

> A 3-minute video for the "Agents Assemble" healthcare AI hackathon.
> v2 narrative: closed-loop, self-learning prior authorization. Every PA
> makes the next one stronger.

---

## Pre-shoot checklist

- [ ] All three services running locally (`docker compose up --build`).
- [ ] MCP server published to Prompt Opinion Marketplace; URL in `SUBMISSION.md`.
- [ ] A2A agent registered in your Prompt Opinion workspace.
- [ ] Test patient `131926799` (Robert Barker) reachable from HAPI R4.
- [ ] `data/pa_memory.jsonl` warmed: at least 3 prior outcomes already recorded
      so the cold→warm Brier delta in beat 4 is visually meaningful.
- [ ] Two terminals open: one for `test-client.ts`, one for `curl /health`.
- [ ] Screen recorder at 1080p / 30 fps. System audio + mic. Quiet room.
- [ ] Run the full chain warm once before recording (Groq cold-start is ~3 s).

---

## 3-minute beat sheet

Each beat lists: **TIME · VISUAL · NARRATION · TERMINAL COMMAND**.

---

### Beat 0 — Hook (0:00–0:15)

**TIME:** 0:00–0:15
**VISUAL:** Black title card → cuts to a stack of paper PA forms B-roll →
title card "ClinicalContext — closed-loop prior authorization."
**NARRATION:**

> "Prior authorization takes twenty minutes per request, and the work is
> thrown away the moment it's submitted. Until now."

**TERMINAL COMMAND:** *(none — voiceover only)*

---

### Beat 1 — 11-tool baseline for Robert Barker (0:15–0:45)

**TIME:** 0:15–0:45
**VISUAL:** Prompt Opinion workspace. The A2A agent receives a single prompt.
Tool-call activity panel scrolls as the 11 baseline tools fire. End on the
rendered PA letter for Robert Barker.
**NARRATION:**

> "Robert Barker. 64. Type 2 diabetes. HbA1c 8.2 on metformin. His doctor wants
> Ozempic. ClinicalContext chains eleven MCP tools — pulls FHIR, searches 244
> CMS coverage chunks, checks RxNorm for interactions, maps SNOMED to ICD-10,
> drafts the letter. Ninety seconds. That's the baseline every healthcare-MCP
> server ships today."

**TERMINAL COMMAND:**

```bash
npx tsx test-client.ts 131926799 "Ozempic 0.5mg subcutaneous weekly"
```

(Cut to the agent log inside Prompt Opinion — the test-client output is the
backup plate if the workspace stalls.)

---

### Beat 2 — The v2 layer: predict → counterfactual → adversarial (0:45–1:30)

**TIME:** 0:45–1:30
**VISUAL:** Lower-third overlay flashes each tool name as it returns:
`predict_approval_probability` → `suggest_counterfactual_evidence` →
`adversarial_review`. Highlight the probability number on screen — it ticks
from **0.42 → 0.81**.
**NARRATION:**

> "Here's what's new. Before we send the letter, the predictor scores it.
> Forty-two percent. Too risky. The counterfactual tool says: *add the
> documented metformin trial duration and the BMI*. Adversarial review reads
> the draft like a payer's denial team and flags two more weaknesses.
> We re-score. Eighty-one percent. The system caught its own draft before a
> human did."

**TERMINAL COMMAND:**

```bash
# from inside the same test-client run, beats 13–15:
#   predict_approval_probability  → 0.42
#   suggest_counterfactual_evidence
#   adversarial_review
#   (re-predict after fixes)      → 0.81
```

---

### Beat 3 — Closing the loop: record_pa_outcome + learning_stats (1:30–2:15)

**TIME:** 1:30–2:15
**VISUAL:** Split: left terminal runs `record_pa_outcome`, right terminal hits
`/health`. Brier score and `memory_size` both visible. Memory size goes from
N to N+1 on screen. The `/health` JSON shows `calibration_brier`.
**NARRATION:**

> "When the payer responds, we record the outcome. The memory store grows.
> The next prediction uses comparable priors as a calibration prior. The
> server's `/health` endpoint exposes the live Brier score — that's how
> well-calibrated this thing actually is, in production, today. Every PA we
> handle makes the next one stronger."

**TERMINAL COMMANDS:**

```bash
# left pane — close the loop
# (test-client beats 16–18 do this, but for the demo run them explicitly)
curl -sX POST http://localhost:3000/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{
        "name":"record_pa_outcome",
        "arguments":{"drug":"semaglutide 0.5mg weekly","diagnosis_icd10":"E11.9",
          "payer":"Aetna","evidence_summary":"...","predicted_probability":0.81,
          "outcome":"approved"}}}'

# right pane — show calibration live
curl -s http://localhost:3000/health | jq '{calibration_brier, memory_size}'
```

---

### Beat 4 — Trust scaffolding (2:15–2:45)

**TIME:** 2:15–2:45
**VISUAL:** Four quick cuts (≈7 seconds each):
1. SHARP headers in the request log — `x-fhir-server-url`, `x-fhir-access-token`,
   `x-patient-id` — token redacted in logs.
2. Audit-log entry showing tool call + provenance hash.
3. PHI redaction: a sample MRN/DOB struck through in the patient_explainer
   output.
4. **Dose-safety pre-flight blocks** atorvastatin for a pregnant patient —
   the call returns a hard refusal before the LLM ever runs.

**NARRATION:**

> "SHARP propagates the FHIR token without leaking it into the model context.
> Every tool call is signed into a court-grade audit log. PHI is redacted
> before any LLM call. And the dose-safety pre-flight refuses categorical
> contraindications — atorvastatin in pregnancy, blocked before a single
> token of inference."

**TERMINAL COMMAND:**

```bash
# dramatic dose-safety block
curl -sX POST http://localhost:3000/mcp \
  -H 'content-type: application/json' \
  -H 'x-patient-id: pregnant-test' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{
        "name":"draft_prior_auth_request",
        "arguments":{"patient_id":"pregnant-test",
          "requested_medication_or_procedure":"atorvastatin 40mg daily",
          "requesting_provider":"Dr. Smith","payer_name":"Aetna"}}}' | jq .

# tail the audit log
tail -n 5 data/audit.log | jq .
```

---

### Beat 5 — Close (2:45–3:00)

**TIME:** 2:45–3:00
**VISUAL:** Closing card.

```
ClinicalContext
18 MCP tools · closed-loop · self-learning
Every PA makes the next one stronger.
github.com/<your-handle>/clinicalcontext  ·  Marketplace: clinicalcontext
```

**NARRATION:**

> "Eighteen tools. A closed loop. Every PA makes the next one stronger.
> Submission ready."

**TERMINAL COMMAND:** *(none — fade out)*

---

## Numbers used on camera

**Measured headline numbers** (eval/REPORT.md, 20 scenarios, offline heuristic + memory):

- Cold Brier: **0.047**
- Warm Brier: **0.024**
- Calibration improvement: **49%** after seeing 20 ground-truth outcomes
- 0.5-threshold accuracy: **95%** (cold and warm)
- Memory grows 0 → 20 between passes

The 0.42 → 0.81 demo probability tick is dramatized for the script — replace with the exact numbers from a fresh run on the patient/drug pair you record.

---

## Backup plan if a live call stalls

1. Cut the take. Don't recover on camera.
2. Replace the live pane with a pre-recorded `test-client.ts` capture from a
   warm run (record one before shooting and keep `assets/screenshots/v2/`
   ready).
3. Worst case: fall back to the terminal-only narrative — beats 0, 1, 2, 3, 5
   all work as terminal-driven cuts. Beat 4 needs the live curl; pre-record it.

---

## Submit-day checklist

- [ ] Video under 3:00.
- [ ] All eighteen tool names appear on screen at least once.
- [ ] Probability delta (cold → counterfactual + adversarial → re-score) is
      visible for at least 3 seconds.
- [ ] Brier score visible from `/health`.
- [ ] Atorvastatin-in-pregnancy block visible end-to-end.
- [ ] Captions proofread.
- [ ] YouTube upload as Unlisted: "ClinicalContext v2 — Closed-Loop Prior
      Auth (Agents Assemble)."
- [ ] Description has GitHub repo + Marketplace URL.
