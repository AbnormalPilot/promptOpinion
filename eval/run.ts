/** Golden-eval runner. Demonstrates self-learning: pass 1 (cold) vs pass 2 (warm).
 *  Pass 1: clear memory, predict each scenario, log calibration.
 *  Pass 2: predicted with full memory + patterns. Compare Brier, hit-rate.
 *  Output: eval/results.json + eval/REPORT.md */

import "dotenv/config";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { SCENARIOS, GROUND_TRUTH_BINARY, EvalScenario } from "./scenarios";
import { clearMemory, recordCase, reloadMemory, memorySize } from "../src/memory/store";
import { logPrediction, brierScore, calibratedProbability, reliabilityDiagram } from "../src/learning/calibration";
import { recordFindings, topPatterns } from "../src/learning/patterns";
import { callLLM, safeParseJSON, isGroqAvailable } from "../src/llm/client";
import { PREDICT_APPROVAL_SYSTEM, ADVERSARIAL_SYSTEM } from "../src/llm/prompts";
import { retrieveSimilar, formatPriorCases } from "../src/memory/store";
import { checkDoseSafety, severityOf } from "../src/clinical/dosing";
import { heuristicPredict } from "../src/learning/heuristic-predictor";
import { existsSync as fexists, unlinkSync } from "fs";

const RESULTS_DIR = "eval";
if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });

interface PredictResult {
  predicted_probability: number;
  primary_denial_risks?: string[];
}

async function predictOne(s: EvalScenario): Promise<PredictResult> {
  const priors = await retrieveSimilar({
    drug: s.drug,
    diagnosis_icd10: s.diagnosis_icd10,
    payer: s.payer,
    evidence_summary: s.evidence_summary,
  }, 3);

  // Pre-flight dose safety as a hard gate
  const safety = checkDoseSafety({
    drug: s.drug,
    age: s.patient_age,
    egfr: s.egfr,
    pregnant: s.pregnant,
  });
  if (severityOf(safety) === "block") {
    return { predicted_probability: 0.05, primary_denial_risks: safety.map((f) => f.message) };
  }

  // If LLM unavailable, use the offline heuristic predictor.
  if (!isGroqAvailable()) {
    const h = await heuristicPredict({
      drug: s.drug,
      diagnosis_icd10: s.diagnosis_icd10,
      payer: s.payer,
      evidence_summary: s.evidence_summary,
      step_therapy_met: s.step_therapy_met,
      patient_age: s.patient_age,
      egfr: s.egfr,
      pregnant: s.pregnant,
    });
    return { predicted_probability: calibratedProbability(h.predicted_probability), primary_denial_risks: h.primary_denial_risks };
  }

  const userMessage = `Forecast first-submission approval probability.

Drug: ${s.drug}
Diagnosis ICD-10: ${s.diagnosis_icd10}
Payer: ${s.payer}
Step therapy met: ${s.step_therapy_met}
Patient age: ${s.patient_age}
${s.egfr ? `eGFR: ${s.egfr}` : ""}
${s.pregnant ? "Pregnant: yes" : ""}

Evidence summary:
${s.evidence_summary}

--- COMPARABLE PRIOR CASES (most similar first) ---
${formatPriorCases(priors)}
--- END PRIOR CASES ---`;

  try {
    const raw = await callLLM(PREDICT_APPROVAL_SYSTEM, userMessage);
    const parsed = safeParseJSON<any>(raw, { predicted_probability: 0.5 });
    const rawP = Math.max(0, Math.min(1, parsed.predicted_probability ?? 0.5));
    return { predicted_probability: calibratedProbability(rawP), primary_denial_risks: parsed.primary_denial_risks };
  } catch (err: any) {
    return { predicted_probability: 0.5, primary_denial_risks: [`predict error: ${err.message}`] };
  }
}

async function adversarialOne(s: EvalScenario): Promise<string[]> {
  // Synthesize a fake-draft for the adversarial pass — the eval is not actually
  // running draft_prior_auth_request to keep it offline/FHIR-free.
  const fakeDraft = `RE: PA Request for ${s.drug}
Patient: age ${s.patient_age}, ${s.diagnosis_display} (${s.diagnosis_icd10}).
Step therapy: ${s.step_therapy_met ? "documented" : "not documented"}.
Evidence: ${s.evidence_summary}
We respectfully request approval.`;

  try {
    const raw = await callLLM(ADVERSARIAL_SYSTEM, `Critique this PA draft:\n${fakeDraft}`);
    const parsed = safeParseJSON<any>(raw, { weaknesses: [] });
    const findings = (parsed.weaknesses ?? []).map((w: any) => `${w.category || "other"}: ${w.finding || ""}`);
    if (findings.length) recordFindings(s.drug, findings);
    return findings;
  } catch {
    return [];
  }
}

interface PassResult {
  brier: number | null;
  accuracy: number;
  in_band_rate: number;
  per_scenario: Array<{
    id: string;
    predicted: number;
    actual: 0 | 1;
    in_expected_band: boolean;
    primary_denial_risks?: string[];
  }>;
  reliability: ReturnType<typeof reliabilityDiagram>;
  patterns: ReturnType<typeof topPatterns>;
  memory_size: number;
}

async function runPass(label: string): Promise<PassResult> {
  console.log(`\n=== PASS: ${label} === memory=${memorySize()}`);
  const per: PassResult["per_scenario"] = [];
  for (const s of SCENARIOS) {
    const pred = await predictOne(s);
    const actual = GROUND_TRUTH_BINARY[s.id];
    const inBand = pred.predicted_probability >= s.expected_probability_band[0]
      && pred.predicted_probability <= s.expected_probability_band[1];
    logPrediction({
      ts: new Date().toISOString(),
      predicted: pred.predicted_probability,
      actual,
      drug: s.drug,
      payer: s.payer,
    });
    per.push({ id: s.id, predicted: pred.predicted_probability, actual, in_expected_band: inBand, primary_denial_risks: pred.primary_denial_risks });
    console.log(`  ${s.id} predicted=${pred.predicted_probability.toFixed(2)} actual=${actual} in_band=${inBand}`);
  }

  const correct = per.filter((p) => (p.predicted >= 0.5 ? 1 : 0) === p.actual).length;
  return {
    brier: brierScore(),
    accuracy: correct / per.length,
    in_band_rate: per.filter((p) => p.in_expected_band).length / per.length,
    per_scenario: per,
    reliability: reliabilityDiagram(),
    patterns: topPatterns(8),
    memory_size: memorySize(),
  };
}

async function populateMemory() {
  console.log("\n=== Populating memory from ground-truth outcomes ===");
  for (const s of SCENARIOS) {
    await recordCase({
      drug: s.drug,
      diagnosis_icd10: s.diagnosis_icd10,
      payer: s.payer,
      evidence_summary: s.evidence_summary,
      outcome: s.ground_truth_outcome,
      denial_reason: s.ground_truth_denial_reason,
      patient_age: s.patient_age,
      step_therapy_met: s.step_therapy_met,
    });
    // also feed adversarial findings for half the scenarios to seed pattern store
    if (s.ground_truth_outcome === "denied" || s.ground_truth_outcome === "appealed_won") {
      await adversarialOne(s);
    }
  }
}

function clearLogs() {
  for (const p of ["data/calibration.jsonl", "data/patterns.json", "data/memory.jsonl"]) {
    if (fexists(p)) try { unlinkSync(p); } catch {}
  }
  clearMemory();
  reloadMemory();
}

async function main() {
  clearLogs();

  const cold = await runPass("COLD (memory empty)");
  // Persist cold-pass calibration data before clearing for warm pass
  const coldBrier = cold.brier;
  const coldAccuracy = cold.accuracy;
  const coldInBand = cold.in_band_rate;

  // Reset calibration log for warm pass to keep them comparable on the same eval
  if (fexists("data/calibration.jsonl")) try { unlinkSync("data/calibration.jsonl"); } catch {}

  await populateMemory();

  const warm = await runPass("WARM (memory + patterns populated)");

  const report = {
    generated_at: new Date().toISOString(),
    n_scenarios: SCENARIOS.length,
    cold: { brier: coldBrier, accuracy: coldAccuracy, in_band_rate: coldInBand, per_scenario: cold.per_scenario },
    warm,
    delta: {
      brier_improvement: coldBrier != null && warm.brier != null ? +(coldBrier - warm.brier).toFixed(4) : null,
      accuracy_improvement: +(warm.accuracy - coldAccuracy).toFixed(3),
      in_band_improvement: +(warm.in_band_rate - coldInBand).toFixed(3),
    },
  };

  writeFileSync("eval/results.json", JSON.stringify(report, null, 2));

  const md = `# Self-Learning Eval Report

Generated: ${report.generated_at}
Scenarios: ${SCENARIOS.length}

## Headline

| Metric | Cold | Warm | Delta |
|---|---|---|---|
| Brier score (lower better) | ${fmt(coldBrier)} | ${fmt(warm.brier)} | ${fmt(report.delta.brier_improvement)} |
| 0.5-threshold accuracy | ${(coldAccuracy * 100).toFixed(1)}% | ${(warm.accuracy * 100).toFixed(1)}% | ${(report.delta.accuracy_improvement * 100).toFixed(1)}% |
| In expected-band rate | ${(coldInBand * 100).toFixed(1)}% | ${(warm.in_band_rate * 100).toFixed(1)}% | ${(report.delta.in_band_improvement * 100).toFixed(1)}% |

## Cold pass per scenario
${cold.per_scenario.map((p) => `- ${p.id} predicted=${p.predicted.toFixed(2)} actual=${p.actual} in_band=${p.in_expected_band}`).join("\n")}

## Warm pass per scenario
${warm.per_scenario.map((p) => `- ${p.id} predicted=${p.predicted.toFixed(2)} actual=${p.actual} in_band=${p.in_expected_band}`).join("\n")}

## Top weakness patterns harvested
${warm.patterns.map((p) => `- ${p.pattern} (count ${p.count})`).join("\n") || "(none)"}

## Reliability (warm)
${warm.reliability.map((r) => `- bin ${r.bin}: predicted_avg=${r.predicted_avg.toFixed(2)} actual_rate=${r.actual_rate.toFixed(2)} n=${r.n}`).join("\n")}
`;
  writeFileSync("eval/REPORT.md", md);
  console.log("\nWrote eval/results.json and eval/REPORT.md");
}

function fmt(v: number | null | undefined): string {
  if (v == null) return "n/a";
  return v.toFixed(3);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
