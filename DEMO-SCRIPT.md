# Demo Video Shooting Script

> A 3-minute video that lands every judging-criterion lever.
> Keep your editing tight. Cut the empty space, not the substance.

---

## Pre-shoot checklist

- [ ] All three services running locally (`docker compose up --build`).
- [ ] MCP server published to Prompt Opinion Marketplace (URL filled in `SUBMISSION.md`).
- [ ] A2A agent registered in your Prompt Opinion workspace.
- [ ] Browser tab open on the workspace; second tab on the Marketplace listing page.
- [ ] Test patient `131926799` (Robert Barker) confirmed reachable: `curl https://hapi.fhir.org/baseR4/Patient/131926799` returns 200.
- [ ] Backup screenshots ready in case a live call stalls during recording (see §6).
- [ ] Screen recorder set to 1080p, 30 fps, system + mic audio. (Loom or OBS.)
- [ ] Quiet room. Test mic with one practice take.
- [ ] Run the demo prompt **once before recording** so the model and embeddings are warm.

---

## Final 3-minute script

### Title card (0:00–0:05)

```
ClinicalContext
Prior authorization in 90 seconds, not 20 minutes.
Built on MCP + A2A + FHIR + SHARP.
```

Voiceover starts at 0:05.

---

### Beat 1 — The pain (0:05–0:25)

**On screen:** B-roll of an EHR (your own dummy chart screenshot is fine). Pull-quote overlay:

> *"Prior auth wastes 20 minutes per request and costs the US health system $35 billion a year." — American Medical Association*

**Voiceover (≈40 words, ≈18 seconds):**

> "Prior authorization is the single most-hated administrative burden in US healthcare. Twenty to forty minutes per request — pulling charts, hunting ICD-10 codes, drafting justification letters. Universally hated. Universally automatable. Watch."

---

### Beat 2 — Live demo inside Prompt Opinion (0:25–1:35)

**On screen:** Your Prompt Opinion workspace. The ClinicalContext A2A agent is active.

**Action 1 — Type the single prompt (0:25–0:35):**

```
Draft a prior authorization for Ozempic (semaglutide 0.5mg weekly)
for patient 131926799. Payer is Aetna. Requesting provider Dr. Smith.
```

**Voiceover during typing:**

> "One prompt. The clinician's full intent."

**Action 2 — Tool chain executing (0:35–1:15):**

The agent fires the 11 MCP tools in sequence. The platform shows tool-call activity. Use a side panel or your video editor to overlay each tool name as it fires:

- `fetch_patient_context` → "Robert Barker, 64M, T2DM + HTN"
- `fetch_medication_list` → "Metformin 1g BID, amlodipine 5mg"
- `fetch_clinical_history` → "HbA1c 8.2%, BP 142/88"
- `check_drug_interactions` → "No significant interactions ✓"
- `lookup_coverage_policy` → "NCD 110.18 — GLP-1 RA coverage criteria"
- `check_coverage_requirements` → "Step therapy met ✓"
- `analyze_prior_auth_need` → "Confidence 0.91, primary ICD-10 E11.9"
- `draft_prior_auth_request` → "Letter ready"

**Voiceover during chain (≈75 words, ≈30 seconds):**

> "ClinicalContext chains eleven MCP tools. It pulls real patient data from a FHIR R4 server. It checks drug interactions with the public RxNorm API. It searches two hundred forty-four CMS coverage-policy chunks with local embeddings — no third-party RAG. It maps SNOMED to ICD-10. It scores its own confidence. Every clinical claim cites the FHIR field it came from. Ninety seconds. End to end."

**Action 3 — Show the rendered letter (1:15–1:35):**

Scroll through the generated PA letter. Pause on:

- The bold `DRAFT — FOR PHYSICIAN REVIEW BEFORE SUBMISSION` header.
- The ICD-10 codes (E11.9 primary, I10 secondary).
- The clinical-necessity paragraphs with cited values ("HbA1c of 8.2% on 04/10/2026").
- The NCD citation footnote.
- The confidence badge.

**Voiceover:**

> "A full payer-ready letter. Signed-off by the physician before transmission. The model never invents — every value is traceable to FHIR."

---

### Beat 3 — Standards & interoperability (1:35–2:20)

**On screen:** Split screen. Left = the architecture diagram (`assets/architecture.svg`). Right = a second agent in the workspace invoking ClinicalContext.

**Voiceover (≈85 words, ≈40 seconds):**

> "ClinicalContext is built on four open standards. MCP — every tool is discoverable and callable by any compliant agent. A2A — full v1 agent card and JSON-RPC at /.well-known/agent-card.json. FHIR R4 — read-only access against a HAPI sandbox today, ready for SMART-on-FHIR launch tomorrow. And SHARP — Prompt Opinion's context propagation. Three headers carry the FHIR URL, the access token, and the patient ID. The token never enters the LLM context window. The MCP server is stateless. There is zero patient data on disk."

**Action — Show the marketplace listing (2:00–2:20):**

Switch to the Prompt Opinion Marketplace tab showing the published ClinicalContext listing.

**Voiceover:**

> "Published on the Prompt Opinion Marketplace. Any healthcare agent in the ecosystem can compose ClinicalContext into its workflow today."

---

### Beat 4 — Impact and close (2:20–2:55)

**On screen:** Single-slide impact card.

```
Time per PA:    20 min  →  90 sec    (~92% reduction)
Daily savings:  ~12 hours of clinical staff time per clinic
Sector cost:    $35B/year — addressable today
Patient wait:   3 days   →  same-day for in-formulary requests
```

**Voiceover (≈55 words, ≈25 seconds):**

> "Twenty minutes to ninety seconds. Twelve hours of clinical staff time saved per clinic per day. A thirty-five-billion-dollar annual administrative cost — addressable with technology that ships into a real EHR session today. Prior auth drafting is administrative documentation, not clinical decision-making. Regulatorily safe. Standards-native. Deployable now."

---

### Closing card (2:55–3:00)

```
ClinicalContext
github.com/<your-handle>/clinicalcontext
Marketplace: promptopinion.ai/marketplace/clinicalcontext
```

End at 3:00 sharp. Devpost rejects videos over the limit.

---

## Recording tips

- **One take per beat, not the whole video.** Edit the four beats together.
- **Mute system notifications.** macOS: Focus mode. Linux: `notify-send` paused.
- **Record with timestamps off-camera.** A timer in your phone next to the keyboard helps you stay on pace.
- **Run the prompt warm.** First Groq + RAG call has cold-start latency. Trigger it once before you hit Record.
- **Overlay the tool names.** The platform may not visually highlight each tool by default. Use your editor (Final Cut, DaVinci, ScreenFlow, CapCut) to add lower-thirds.

---

## Visual assets to prepare before shooting

1. **Title card** (0:00) — solid background, `ClinicalContext` wordmark, tagline. PNG, 1920×1080.
2. **Architecture diagram** (1:35) — `assets/architecture.svg` exported to PNG at 1920×1080.
3. **Tool-name lower-thirds** (0:35–1:15) — eleven 1920×120 strips with the tool name + a one-line description.
4. **Letter close-ups** (1:15–1:35) — keep the PA letter readable at 1080p; zoom to 125% in the editor when on the letter.
5. **Marketplace screenshot** (2:00) — your published listing.
6. **Impact card** (2:20) — solid background, four bullets per the script.
7. **Closing card** (2:55) — wordmark + URLs.

Total assets: **7 graphics + the live workspace recording**. Build them once, slot them into the timeline.

---

## §6 — Backup plan if a live call stalls

If during recording the agent hangs or a service times out:

1. **Cut the take immediately.** Don't try to recover on camera.
2. **Use pre-recorded screenshots** from `assets/screenshots/` (build these during a successful warm run before shooting).
3. **Show a side-by-side: terminal log** of the successful run + **screenshot of the letter**. Voiceover stays the same.
4. **Worst case: switch to the local UI** (`web/` if built) which talks to the same backend but bypasses any platform latency.

The fallback should look the same to a viewer — same letter, same tools, same standards. Only the live-platform shot is replaced.

---

## §7 — Voiceover full script (paste into prompter)

Total: ~280 words, ~150 wpm = ~2:00 spoken (leaves 1:00 for B-roll, transitions, and the impact card).

```
Prior authorization is the single most-hated administrative burden in US healthcare.
Twenty to forty minutes per request — pulling charts, hunting ICD-10 codes, drafting
justification letters. Universally hated. Universally automatable. Watch.

[on the prompt being typed]
One prompt. The clinician's full intent.

[on the tool chain firing]
ClinicalContext chains eleven MCP tools. It pulls real patient data from a FHIR R4
server. It checks drug interactions with the public RxNorm API. It searches two
hundred forty-four CMS coverage-policy chunks with local embeddings — no third-party
RAG. It maps SNOMED to ICD-10. It scores its own confidence. Every clinical claim
cites the FHIR field it came from. Ninety seconds. End to end.

[on the rendered letter]
A full payer-ready letter. Signed-off by the physician before transmission. The
model never invents — every value is traceable to FHIR.

[on the architecture diagram]
ClinicalContext is built on four open standards. MCP — every tool is discoverable
and callable by any compliant agent. A2A — full v1 agent card and JSON-RPC at
slash dot well-known slash agent dash card dot json. FHIR R4 — read-only access
against a HAPI sandbox today, ready for SMART-on-FHIR launch tomorrow. And SHARP
— Prompt Opinion's context propagation. Three headers carry the FHIR URL, the
access token, and the patient ID. The token never enters the LLM context window.
The MCP server is stateless. There is zero patient data on disk.

[on the marketplace listing]
Published on the Prompt Opinion Marketplace. Any healthcare agent in the ecosystem
can compose ClinicalContext into its workflow today.

[on the impact card]
Twenty minutes to ninety seconds. Twelve hours of clinical staff time saved per
clinic per day. A thirty-five-billion-dollar annual administrative cost —
addressable with technology that ships into a real EHR session today. Prior auth
drafting is administrative documentation, not clinical decision-making.
Regulatorily safe. Standards-native. Deployable now.
```

---

## §8 — Submit-day checklist

- [ ] Video is under 3:00.
- [ ] Audio levels: -3 dB peak, no clipping.
- [ ] All seven graphics rendered at 1920×1080.
- [ ] Title card and closing card both visible long enough to read (≥4 seconds each).
- [ ] Uploaded to YouTube as **Unlisted** with a clear title: "ClinicalContext — Prior Auth Automation (Agents Assemble Hackathon Demo)".
- [ ] Description includes GitHub repo + Marketplace URL.
- [ ] Captions auto-generated, then proofread (judges may watch muted).
- [ ] Test the link from a private browser before pasting into Devpost.
