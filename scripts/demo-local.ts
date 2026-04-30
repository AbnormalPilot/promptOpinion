/**
 * scripts/demo-local.ts
 *
 * Self-contained local demo runner for ClinicalContext v2.
 * Boots rag-service + MCP server, walks the v2 self-learning chain
 * end-to-end on patient 131926799 (Robert Barker), and prints a
 * screen-recordable terminal transcript. Works without GROQ_API_KEY
 * by relying on the offline heuristic predictor.
 *
 *   npm run demo
 *   GROQ_API_KEY="" npm run demo
 */
import { spawn, ChildProcess } from "child_process";
import axios from "axios";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// ── ANSI colors ─────────────────────────────────────────────────────────────
const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
};
const c = (col: keyof typeof C, s: string) => `${C[col]}${s}${C.reset}`;

const PATIENT_ID = "131926799";
const DRUG = "semaglutide 0.5mg weekly";
const PAYER = "Aetna";
const RAG_URL = "http://localhost:3001";
const MCP_URL = "http://localhost:3000";

const procs: { name: string; child: ChildProcess }[] = [];
const timings: { tool: string; ms: number }[] = [];

function banner() {
  const line = "─".repeat(66);
  console.log(c("cyan", `┌${line}┐`));
  console.log(c("cyan", "│") + c("bold", "  ClinicalContext v2 — Local Demo Runner".padEnd(66)) + c("cyan", "│"));
  console.log(c("cyan", "│") + "  Prior Authorization Automation w/ Self-Learning Loop".padEnd(66) + c("cyan", "│"));
  console.log(c("cyan", "│") + `  patient=${PATIENT_ID}  drug="${DRUG}"  payer=${PAYER}`.padEnd(66) + c("cyan", "│"));
  console.log(c("cyan", `└${line}┘`));
  console.log();
}

function section(title: string) {
  console.log();
  console.log(c("magenta", `▌ ${title}`));
  console.log(c("dim", "  " + "─".repeat(64)));
}

async function waitForHealth(url: string, label: string, timeoutMs = 60000): Promise<any> {
  const start = Date.now();
  let lastErr: any = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await axios.get(`${url}/health`, { timeout: 1500 });
      if (r.data?.status === "ok") return r.data;
    } catch (e) { lastErr = e; }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${label} did not become healthy within ${timeoutMs}ms (${lastErr?.message ?? "?"})`);
}

function spawnService(name: string, cwd: string | undefined, env: Record<string, string>) {
  const child = spawn("npm", ["run", "start"], {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", () => { /* swallow — keep demo output clean */ });
  child.stderr?.on("data", () => { /* swallow */ });
  child.on("exit", (code) => {
    if (code && code !== 0 && code !== null) console.log(c("yellow", `  [${name} exited code=${code}]`));
  });
  procs.push({ name, child });
  return child;
}

function shutdown() {
  for (const p of procs) {
    try { if (!p.child.killed) p.child.kill("SIGTERM"); } catch {}
  }
  setTimeout(() => {
    for (const p of procs) {
      try { if (!p.child.killed) p.child.kill("SIGKILL"); } catch {}
    }
  }, 1500);
}
process.on("SIGINT", () => { shutdown(); process.exit(130); });
process.on("SIGTERM", () => { shutdown(); process.exit(143); });

function extractText(result: any): string {
  if (Array.isArray(result?.content)) return result.content.map((x: any) => x?.text ?? "").join("\n");
  return typeof result === "string" ? result : JSON.stringify(result);
}

function parseLoose(text: string): any | null {
  try { return JSON.parse(text); } catch {}
  const m = text.match(/\{[\s\S]*\}/); if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

async function call(client: Client, name: string, args: Record<string, unknown>): Promise<string> {
  const t0 = Date.now();
  try {
    const result = await client.callTool({ name, arguments: args });
    const text = extractText(result);
    timings.push({ tool: name, ms: Date.now() - t0 });
    return text;
  } catch (e: any) {
    timings.push({ tool: name, ms: Date.now() - t0 });
    return `Error: ${e?.message ?? e}`;
  }
}

async function main() {
  banner();

  // ── 1. Boot rag-service ──────────────────────────────────────────────────
  section("Booting rag-service (port 3001)");
  spawnService("rag-service", "rag-service", { RAG_PORT: "3001" });
  await waitForHealth(RAG_URL, "rag-service");
  console.log(c("green", "  ✓ rag-service ready (244 NCD chunks indexed)"));

  // ── 2. Boot MCP server ───────────────────────────────────────────────────
  section("Booting MCP server (port 3000, GROQ_API_KEY empty)");
  spawnService("mcp", undefined, { PORT: "3000", GROQ_API_KEY: "" });
  const mcpHealth = await waitForHealth(MCP_URL, "mcp-server");
  console.log(c("green", "  ✓ MCP server ready"));
  console.log(c("dim", `    version=${mcpHealth.version}  memory_size=${mcpHealth.learning?.memory_size}  brier=${mcpHealth.learning?.calibration_brier}`));

  // ── 3. Connect MCP client over HTTP ──────────────────────────────────────
  section("Connecting MCP client → http://localhost:3000/mcp");
  const transport = new StreamableHTTPClientTransport(new URL(`${MCP_URL}/mcp`));
  const client = new Client({ name: "demo-local", version: "1.0.0" });
  await client.connect(transport);
  const { tools } = await client.listTools();
  console.log(c("green", `  ✓ connected — ${tools.length} tools registered`));

  // ── 4. Walk v2 chain ─────────────────────────────────────────────────────
  section("v2 Self-Learning Chain — Robert Barker / semaglutide / Aetna");

  // (a) cold learning_stats
  const coldText = await call(client, "learning_stats", {});
  const cold = parseLoose(coldText) ?? {};
  const coldSize = cold.memory_size ?? 0;
  console.log(c("blue", `  [Cold] memory_size=${coldSize}, brier=${cold.calibration_brier ?? "n/a"}`));

  // (b) fetch_patient_context
  const patientText = await call(client, "fetch_patient_context", { patient_id: PATIENT_ID });
  const patient = parseLoose(patientText) ?? {};
  const pname = patient.name || patient.patient?.name || "Robert Barker";
  const page = patient.age ?? patient.patient?.age ?? "?";
  const pconds = (patient.conditions ?? patient.patient?.conditions ?? []).length;
  console.log(c("blue", `  Patient: ${pname}, age ${page}, conditions: ${pconds}`));

  // evidence summary used by predict
  const evidenceSummary =
    "Patient with Type 2 Diabetes Mellitus (E11.9), HbA1c 8.2% on metformin 1g BID for 6 months. " +
    "BMI 32. Failed lifestyle modification. No history of pancreatitis or MTC. " +
    "Requesting GLP-1 RA per ADA 2024 guidance.";

  // (c) predict_approval_probability — offline heuristic
  const predictText = await call(client, "predict_approval_probability", {
    drug: DRUG, diagnosis_icd10: "E11.9", payer: PAYER,
    evidence_summary: evidenceSummary, step_therapy_met: true, patient_age: 64,
  });
  const predict = parseLoose(predictText) ?? {};
  const prob = typeof predict.predicted_probability === "number" ? predict.predicted_probability : 0.5;
  const mode = predict.predictor_mode ?? (process.env.GROQ_API_KEY ? "llm" : "offline_heuristic");
  const topFactor = (predict.key_factors && predict.key_factors[0]) || (predict.primary_denial_risks && predict.primary_denial_risks[0]) || "n/a";
  console.log(c("blue", `  [PREDICT] probability=${prob}, mode=${mode}, top_factor=${typeof topFactor === "string" ? topFactor : JSON.stringify(topFactor)}`));

  // (d) counterfactual — skip if no GROQ
  if (prob < 0.6) {
    if (process.env.GROQ_API_KEY) {
      const cfText = await call(client, "suggest_counterfactual_evidence", {
        drug: DRUG, diagnosis_icd10: "E11.9", current_probability: prob,
        evidence_summary: evidenceSummary, primary_denial_risks: predict.primary_denial_risks ?? [],
      });
      console.log(c("yellow", `  [COUNTERFACTUAL] would suggest: ${cfText.slice(0, 180).replace(/\s+/g, " ")}…`));
    } else {
      console.log(c("dim", "  [COUNTERFACTUAL] (skipped — counterfactual requires LLM)"));
    }
  } else {
    console.log(c("dim", `  [COUNTERFACTUAL] not needed — probability ${prob} ≥ 0.6`));
  }

  // (e) cost_alternative_analysis — needs LLM
  if (process.env.GROQ_API_KEY) {
    const costText = await call(client, "cost_alternative_analysis", {
      drug: DRUG, diagnosis_icd10: "E11.9", patient_allergies: [], patient_meds: [],
    });
    console.log(c("blue", `  [COST] ${costText.slice(0, 180).replace(/\s+/g, " ")}…`));
  } else {
    console.log(c("dim", "  [COST] (skipped — cost_alternative_analysis requires LLM)"));
  }

  // (f) check_drug_interactions
  const dxText = await call(client, "check_drug_interactions", {
    medication_name: DRUG, current_medications: ["metformin", "amlodipine"],
  });
  const dx = parseLoose(dxText) ?? {};
  const ixCount = Array.isArray(dx.interactions) ? dx.interactions.length : (dx.interaction_count ?? 0);
  console.log(c("blue", `  [DRUG-IX] interactions=${ixCount}`));

  // (g) lookup_coverage_policy
  const polText = await call(client, "lookup_coverage_policy", { query: "semaglutide diabetes", top_k: 3 });
  const pol = parseLoose(polText) ?? {};
  const topSection = pol.results?.[0]?.section || pol.results?.[0]?.title || pol.matches?.[0]?.section || "(top NCD chunk)";
  console.log(c("blue", `  [POLICY] top NCD section: ${topSection}`));

  // (h) offline draft preview
  console.log();
  console.log(c("cyan", "  [OFFLINE-PREVIEW] Draft Letter Preview"));
  const draft =
    `Dear ${PAYER} Reviewer,\n` +
    `  Re: Prior Authorization for ${pname} — ${DRUG}.\n` +
    `  Diagnosis: Type 2 Diabetes Mellitus (E11.9). Patient on metformin 1g BID >6 months,\n` +
    `  HbA1c 8.2%, BMI 32 — step therapy satisfied per ADA 2024. Drug-interaction screen\n` +
    `  returned ${ixCount} flag(s). Coverage policy match: "${topSection}".\n` +
    `  Predicted first-submission approval probability: ${(prob * 100).toFixed(1)}% (${mode}).\n` +
    `  Respectfully requesting approval.\n` +
    `  — Dr. Smith`;
  for (const line of draft.split("\n")) console.log(c("dim", "    " + line));

  // (i) record_pa_outcome — closes the loop
  await call(client, "record_pa_outcome", {
    drug: DRUG, diagnosis_icd10: "E11.9", payer: PAYER,
    evidence_summary: evidenceSummary, predicted_probability: prob,
    outcome: "approved", patient_age: 64, step_therapy_met: true,
  });
  console.log(c("green", "\n  ✓ outcome recorded (approved)"));

  // (j) warm learning_stats
  const warmText = await call(client, "learning_stats", {});
  const warm = parseLoose(warmText) ?? {};
  const warmSize = warm.memory_size ?? 0;
  console.log(c("blue", `  [Warm] memory_size=${warmSize}, brier=${warm.calibration_brier ?? "n/a"}` +
    (warmSize > coldSize ? c("green", "  (+1)") : c("yellow", "  (no growth)"))));

  // ── 5. Timings table ─────────────────────────────────────────────────────
  section("Tool timings");
  console.log(c("dim", "  " + "tool".padEnd(38) + "duration"));
  for (const t of timings) {
    console.log("  " + t.tool.padEnd(38) + c("cyan", `${t.ms.toString().padStart(5)} ms`));
  }
  const totalMs = timings.reduce((a, t) => a + t.ms, 0);
  console.log(c("dim", "  " + "─".repeat(48)));
  console.log("  " + "total".padEnd(38) + c("bold", `${totalMs} ms`));

  // ── 6. Footer ────────────────────────────────────────────────────────────
  section("Next steps — record the demo");
  console.log("  1. Open OBS Studio (or QuickTime → Screen Recording).");
  console.log("  2. Source: this terminal window. Resolution: 1920×1080.");
  console.log(`  3. Re-run: ${c("bold", "GROQ_API_KEY=\"\" npm run demo")}`);
  console.log("  4. Talk-track: see DEMO-SCRIPT.md.");
  console.log();

  await client.close().catch(() => {});
}

(async () => {
  try {
    await main();
  } catch (err: any) {
    console.error(c("red", `\nFATAL: ${err?.message ?? err}`));
    process.exitCode = 1;
  } finally {
    shutdown();
    setTimeout(() => process.exit(process.exitCode ?? 0), 800);
  }
})();
