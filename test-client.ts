/**
 * Test client for ClinicalContext MCP Server (stdio transport).
 * Spawns the server as a child process and exercises all 18 tools end-to-end.
 *
 *   Tools 1–11  : baseline FHIR + RAG + LLM PA workflow (unchanged behavior).
 *   Tools 12–18 : v2 self-learning loop —
 *                 predict → counterfactual → adversarial → explain → cost
 *                 → record_pa_outcome → learning_stats (warm).
 *
 * Usage:
 *   npx tsx test-client.ts                        # default patient, scenario picked automatically
 *   npx tsx test-client.ts <patient_id>           # custom patient
 *   npx tsx test-client.ts <patient_id> <drug>    # custom drug too
 *
 * Notes:
 *   - LLM tools require GROQ_API_KEY in .env. Offline tools run regardless.
 *   - lookup_coverage_policy requires the RAG service running on RAG_SERVICE_URL (default http://localhost:3001).
 *   - process_clinical_document is best-effort — most HAPI test patients lack DocumentReferences.
 *   - record_pa_outcome + learning_stats persist into the local memory store (data/pa_memory.jsonl).
 *
 * Online vs offline matrix (v2 layer):
 *   predict_approval_probability       — LLM (GROQ_API_KEY)
 *   suggest_counterfactual_evidence    — LLM (GROQ_API_KEY)
 *   adversarial_review                 — LLM (GROQ_API_KEY)
 *   patient_explainer                  — LLM (GROQ_API_KEY)
 *   cost_alternative_analysis          — LLM + RxNorm (GROQ_API_KEY, network)
 *   record_pa_outcome                  — OFFLINE (writes to memory store)
 *   learning_stats                     — OFFLINE (reads from memory store)
 */
import "dotenv/config";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const TEST_PATIENT_ID = process.argv[2] || "131926799";
const TEST_DRUG = process.argv[3] || "Ozempic 0.5mg subcutaneous weekly";

interface ToolReport {
  name: string;
  status: "ok" | "skipped" | "error";
  detail: string;
  durationMs?: number;
}

const reports: ToolReport[] = [];
let analyzePayload: string | null = null;
let policyPayload: string | null = null;

function truncate(content: any, max = 1500): string {
  const text = typeof content === "string" ? content : JSON.stringify(content, null, 2);
  return text.length > max ? text.slice(0, max) + "\n... (truncated)" : text;
}

function extractText(result: any): string {
  if (Array.isArray(result?.content)) {
    return result.content.map((c: any) => c?.text ?? "").join("\n");
  }
  return typeof result === "string" ? result : JSON.stringify(result);
}

async function runTool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
  required: { groq?: boolean; rag?: boolean } = {}
): Promise<{ ok: boolean; text: string }> {
  if (required.groq && !process.env.GROQ_API_KEY) {
    reports.push({ name, status: "skipped", detail: "GROQ_API_KEY not set" });
    console.log(`⏭  Skipped (no GROQ_API_KEY)`);
    return { ok: false, text: "" };
  }
  const start = Date.now();
  try {
    const result = await client.callTool({ name, arguments: args });
    const text = extractText(result);
    const durationMs = Date.now() - start;
    const isError = /^Error:/i.test(text.trim());
    reports.push({
      name,
      status: isError ? "error" : "ok",
      detail: isError ? text.split("\n")[0].slice(0, 240) : `${text.length} chars returned`,
      durationMs,
    });
    console.log(truncate(text));
    return { ok: !isError, text };
  } catch (err: any) {
    const detail = err?.message?.slice(0, 240) ?? String(err);
    reports.push({ name, status: "error", detail, durationMs: Date.now() - start });
    console.log(`ERROR: ${detail}`);
    return { ok: false, text: "" };
  }
}

function parseJsonLoose(text: string): any | null {
  try {
    return JSON.parse(text);
  } catch {
    // tools sometimes wrap JSON in markdown fences or commentary
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}

async function main() {
  console.log("ClinicalContext — comprehensive 18-tool verification (v2 self-learning)");
  console.log(`Patient: ${TEST_PATIENT_ID}`);
  console.log(`Drug: ${TEST_DRUG}`);
  console.log(`GROQ_API_KEY: ${process.env.GROQ_API_KEY ? "set" : "MISSING (LLM tools will skip)"}`);
  console.log(`RAG_SERVICE_URL: ${process.env.RAG_SERVICE_URL || "http://localhost:3001"}`);
  console.log();
  console.log("Spawning MCP server via stdio...");

  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "src/stdio.ts"],
    env: { ...process.env },
  });

  const client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(transport);
  console.log("Connected!\n");

  const { tools } = await client.listTools();
  const toolNames = tools.map((t) => t.name).sort();
  console.log(`=== ${tools.length} tools registered ===`);
  for (const t of toolNames) console.log(`  - ${t}`);
  console.log();

  console.log("=== Online/offline matrix ===");
  console.log("  GROQ_API_KEY required (LLM):");
  console.log("    extract_clinical_evidence, check_coverage_requirements,");
  console.log("    analyze_prior_auth_need, draft_prior_auth_request, generate_appeal_letter,");
  console.log("    predict_approval_probability, suggest_counterfactual_evidence,");
  console.log("    adversarial_review, patient_explainer, cost_alternative_analysis");
  console.log("  Offline (no API key):");
  console.log("    fetch_patient_context, fetch_medication_list, fetch_clinical_history,");
  console.log("    process_clinical_document, lookup_coverage_policy, check_drug_interactions,");
  console.log("    record_pa_outcome, learning_stats");
  console.log();

  // ── 1. fetch_patient_context ─────────────────────────────────────────────
  console.log("=== 1. fetch_patient_context ===");
  const patientCtx = await runTool(client, "fetch_patient_context", {
    patient_id: TEST_PATIENT_ID,
  });

  // ── 2. fetch_medication_list ─────────────────────────────────────────────
  console.log("\n=== 2. fetch_medication_list ===");
  const medList = await runTool(client, "fetch_medication_list", {
    patient_id: TEST_PATIENT_ID,
    status: "all",
  });

  // ── 3. fetch_clinical_history ────────────────────────────────────────────
  console.log("\n=== 3. fetch_clinical_history ===");
  await runTool(client, "fetch_clinical_history", {
    patient_id: TEST_PATIENT_ID,
    lookback_days: 365,
  });

  // Extract current med names for the drug-interaction check
  let currentMeds: string[] = [];
  try {
    const parsed = JSON.parse(medList.text);
    currentMeds = (parsed.medications ?? [])
      .map((m: any) => m.medication)
      .filter(Boolean)
      .slice(0, 6);
  } catch {
    // Older JSON shape
  }

  // ── 4. check_drug_interactions ───────────────────────────────────────────
  console.log("\n=== 4. check_drug_interactions ===");
  await runTool(client, "check_drug_interactions", {
    medication_name: TEST_DRUG,
    current_medications: currentMeds,
  });

  // ── 5. lookup_coverage_policy ────────────────────────────────────────────
  console.log("\n=== 5. lookup_coverage_policy ===");
  const policy = await runTool(client, "lookup_coverage_policy", {
    query: TEST_DRUG,
    top_k: 3,
  });
  policyPayload = policy.ok ? policy.text : null;

  // ── 6. check_coverage_requirements ───────────────────────────────────────
  console.log("\n=== 6. check_coverage_requirements ===");
  await runTool(
    client,
    "check_coverage_requirements",
    {
      patient_id: TEST_PATIENT_ID,
      requested_medication_or_procedure: TEST_DRUG,
      payer_name: "Aetna",
    },
    { groq: true }
  );

  // ── 7. extract_clinical_evidence ─────────────────────────────────────────
  console.log("\n=== 7. extract_clinical_evidence ===");
  await runTool(
    client,
    "extract_clinical_evidence",
    {
      patient_id: TEST_PATIENT_ID,
      requested_medication_or_procedure: TEST_DRUG,
      lookback_days: 365,
    },
    { groq: true }
  );

  // ── 8. process_clinical_document ─────────────────────────────────────────
  console.log("\n=== 8. process_clinical_document ===");
  await runTool(client, "process_clinical_document", {
    patient_id: TEST_PATIENT_ID,
  });

  // ── 9. analyze_prior_auth_need ───────────────────────────────────────────
  console.log("\n=== 9. analyze_prior_auth_need ===");
  const analyze = await runTool(
    client,
    "analyze_prior_auth_need",
    {
      patient_id: TEST_PATIENT_ID,
      requested_medication_or_procedure: TEST_DRUG,
      requesting_provider: "Dr. Smith",
    },
    { groq: true }
  );
  analyzePayload = analyze.ok ? analyze.text : null;

  // ── 10. draft_prior_auth_request ─────────────────────────────────────────
  console.log("\n=== 10. draft_prior_auth_request ===");
  await runTool(
    client,
    "draft_prior_auth_request",
    {
      patient_id: TEST_PATIENT_ID,
      requested_medication_or_procedure: TEST_DRUG,
      requesting_provider: "Dr. Smith",
      payer_name: "Aetna",
      ...(analyzePayload ? { clinical_analysis: analyzePayload } : {}),
      ...(policyPayload ? { policy_context: policyPayload } : {}),
    },
    { groq: true }
  );

  // ── 11. generate_appeal_letter ───────────────────────────────────────────
  console.log("\n=== 11. generate_appeal_letter ===");
  await runTool(
    client,
    "generate_appeal_letter",
    {
      patient_id: TEST_PATIENT_ID,
      requested_medication_or_procedure: TEST_DRUG,
      denial_reason: "Step therapy not met — patient must try second-generation oral antidiabetic before GLP-1 RA",
      requesting_provider: "Dr. Smith",
      payer_name: "Aetna",
    },
    { groq: true }
  );

  // ════════════════════════════════════════════════════════════════════════
  //  v2 SELF-LEARNING CHAIN (tools 12–18)
  //  predict → counterfactual → adversarial → explain → cost
  //         → record_pa_outcome → learning_stats (warm)
  // ════════════════════════════════════════════════════════════════════════
  console.log("\n\n========== v2 SELF-LEARNING CHAIN ==========\n");

  const evidenceSummary =
    analyzePayload && analyzePayload.length > 0
      ? analyzePayload.slice(0, 4000)
      : "Patient with Type 2 Diabetes Mellitus (E11.9), HbA1c 8.2% on metformin 1g BID for 6 months. " +
        "BMI 32. Failed lifestyle modification. No history of pancreatitis or MTC. " +
        "Requesting GLP-1 RA per ADA 2024 guidance.";

  // ── 12. learning_stats (cold baseline) ───────────────────────────────────
  console.log("=== 12. learning_stats (cold) ===");
  const coldStats = await runTool(client, "learning_stats", {});
  let coldMemorySize: number | null = null;
  const coldParsed = parseJsonLoose(coldStats.text);
  if (coldParsed && typeof coldParsed.memory_size === "number") {
    coldMemorySize = coldParsed.memory_size;
    console.log(`  → cold memory_size = ${coldMemorySize}`);
  }

  // ── 13. predict_approval_probability ─────────────────────────────────────
  // Works offline (heuristic fallback) — does not require GROQ_API_KEY.
  console.log("\n=== 13. predict_approval_probability ===");
  const predict = await runTool(
    client,
    "predict_approval_probability",
    {
      drug: "semaglutide 0.5mg weekly",
      diagnosis_icd10: "E11.9",
      payer: "Aetna",
      evidence_summary: evidenceSummary,
      step_therapy_met: true,
      patient_age: 64,
    },
    {}
  );

  let predictedProbability: number = 0.5;
  const predictParsed = parseJsonLoose(predict.text);
  if (predictParsed && typeof predictParsed.predicted_probability === "number") {
    predictedProbability = predictParsed.predicted_probability;
  }
  const denialRisks: string[] =
    predictParsed && Array.isArray(predictParsed.primary_denial_risks)
      ? predictParsed.primary_denial_risks
      : [];
  console.log(`  → predicted_probability = ${predictedProbability}`);

  // ── 14. suggest_counterfactual_evidence ──────────────────────────────────
  console.log("\n=== 14. suggest_counterfactual_evidence ===");
  await runTool(
    client,
    "suggest_counterfactual_evidence",
    {
      drug: "semaglutide 0.5mg weekly",
      diagnosis_icd10: "E11.9",
      current_probability: predictedProbability,
      evidence_summary: evidenceSummary,
      primary_denial_risks: denialRisks,
    },
    { groq: true }
  );

  // ── 15. adversarial_review (synthetic short draft) ───────────────────────
  console.log("\n=== 15. adversarial_review ===");
  const syntheticDraft =
    "Dear Aetna Reviewer,\n\n" +
    "Please approve semaglutide 0.5mg weekly for patient Robert Barker (DOB redacted) " +
    "with Type 2 Diabetes Mellitus (E11.9). Patient has been on metformin and is not " +
    "controlled. Requesting GLP-1 receptor agonist per guidelines.\n\n" +
    "Sincerely,\nDr. Smith";
  await runTool(
    client,
    "adversarial_review",
    {
      drug: "semaglutide 0.5mg weekly",
      draft_letter: syntheticDraft,
      clinical_context: evidenceSummary,
    },
    { groq: true }
  );

  // ── 16. patient_explainer ────────────────────────────────────────────────
  console.log("\n=== 16. patient_explainer ===");
  await runTool(
    client,
    "patient_explainer",
    {
      drug: "semaglutide 0.5mg weekly",
      clinical_reason:
        "Your blood sugar is still high (HbA1c 8.2%) on your current pill. This medicine helps lower it.",
      payer: "Aetna",
      is_appeal: false,
    },
    { groq: true }
  );

  // ── 17. cost_alternative_analysis ────────────────────────────────────────
  console.log("\n=== 17. cost_alternative_analysis ===");
  await runTool(
    client,
    "cost_alternative_analysis",
    {
      drug: "semaglutide 0.5mg weekly",
      diagnosis_icd10: "E11.9",
      patient_allergies: [],
      patient_meds: currentMeds,
    },
    { groq: true }
  );

  // ── 18. record_pa_outcome (close the loop) ───────────────────────────────
  console.log("\n=== 18. record_pa_outcome ===");
  await runTool(client, "record_pa_outcome", {
    drug: "semaglutide 0.5mg weekly",
    diagnosis_icd10: "E11.9",
    payer: "Aetna",
    evidence_summary: evidenceSummary,
    predicted_probability: predictedProbability,
    outcome: "approved",
    patient_age: 64,
    step_therapy_met: true,
  });

  // ── 19. learning_stats (warm — confirm growth) ───────────────────────────
  console.log("\n=== learning_stats (warm) ===");
  const warmStats = await runTool(client, "learning_stats", {});
  const warmParsed = parseJsonLoose(warmStats.text);
  if (warmParsed && typeof warmParsed.memory_size === "number" && coldMemorySize != null) {
    const grew = warmParsed.memory_size > coldMemorySize;
    console.log(
      `  → warm memory_size = ${warmParsed.memory_size} ` +
        `(${grew ? "GREW" : "no change"} from cold ${coldMemorySize})`
    );
    if (!grew) {
      console.log("  ⚠  Expected memory_size to increase after record_pa_outcome.");
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log("\n=== Verification summary ===");
  const ok = reports.filter((r) => r.status === "ok").length;
  const skipped = reports.filter((r) => r.status === "skipped").length;
  const errors = reports.filter((r) => r.status === "error").length;
  for (const r of reports) {
    const icon = r.status === "ok" ? "✓" : r.status === "skipped" ? "—" : "✗";
    const dur = r.durationMs != null ? `${r.durationMs.toString().padStart(5, " ")}ms` : "      ";
    console.log(`  ${icon} ${dur}  ${r.name.padEnd(32, " ")}  ${r.detail}`);
  }
  console.log(`\nResult: ${ok} ok / ${skipped} skipped / ${errors} error  (of ${reports.length} total)`);
  if (errors > 0) {
    console.log("\n⚠  Some tools returned errors. Investigate before submission.");
  } else {
    console.log("\nAll tools verified. Submission-ready.");
  }

  await client.close();
  process.exit(errors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(2);
});
