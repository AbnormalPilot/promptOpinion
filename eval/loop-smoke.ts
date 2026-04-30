/** Offline smoke test for the self-learning infrastructure.
 *  Hits memory store, patterns, calibration WITHOUT calling Groq or FHIR.
 *  Run after a clean checkout to verify the loop wiring before the full eval. */

import "dotenv/config";
import { existsSync, unlinkSync } from "fs";
import { recordCase, retrieveSimilar, formatPriorCases, memorySize, clearMemory, reloadMemory } from "../src/memory/store";
import { recordFindings, topPatterns, patternsForPrompt } from "../src/learning/patterns";
import { logPrediction, brierScore, calibratedProbability, reliabilityDiagram } from "../src/learning/calibration";
import { checkDoseSafety, severityOf } from "../src/clinical/dosing";
import { scrubPHIObject, hashPatientId } from "../src/audit/redact";

function clearLogs() {
  for (const p of ["data/calibration.jsonl", "data/patterns.json", "data/memory.jsonl"]) {
    if (existsSync(p)) try { unlinkSync(p); } catch {}
  }
  clearMemory();
  reloadMemory();
}

async function main() {
  clearLogs();

  console.log("[1] memory empty?", memorySize() === 0 ? "yes" : "no");

  await recordCase({
    drug: "semaglutide",
    diagnosis_icd10: "E11.9",
    payer: "Aetna",
    evidence_summary: "HbA1c 8.4%, metformin 14 months",
    outcome: "approved",
  });
  await recordCase({
    drug: "semaglutide",
    diagnosis_icd10: "E11.9",
    payer: "UnitedHealthcare",
    evidence_summary: "newly diagnosed, no prior meds",
    outcome: "denied",
    denial_reason: "Step therapy not met",
  });
  console.log("[2] memory size after writes:", memorySize());

  const sims = await retrieveSimilar({
    drug: "semaglutide",
    diagnosis_icd10: "E11.9",
    payer: "Aetna",
    evidence_summary: "HbA1c 8.6%, metformin 12 months",
  }, 2);
  console.log("[3] retrieved", sims.length, "similar cases");
  console.log("    top similarity:", sims[0]?.similarity?.toFixed(3));
  console.log("    formatted preview:", formatPriorCases(sims).slice(0, 200), "...");

  recordFindings("semaglutide", [
    "step_therapy: First-line metformin not documented with duration",
    "missing_lab_values: HbA1c value cited without date",
  ]);
  recordFindings("apixaban", [
    "renal_dosing: eGFR not provided for dose calculation",
  ]);
  console.log("[4] top patterns:", topPatterns(3).map((p) => p.pattern + "(" + p.count + ")").join(", "));
  console.log("    patternsForPrompt():", patternsForPrompt().split("\n")[0]);

  logPrediction({ ts: new Date().toISOString(), predicted: 0.85, actual: 1, drug: "semaglutide" });
  logPrediction({ ts: new Date().toISOString(), predicted: 0.80, actual: 1, drug: "evolocumab" });
  logPrediction({ ts: new Date().toISOString(), predicted: 0.20, actual: 0, drug: "ciprofloxacin" });
  logPrediction({ ts: new Date().toISOString(), predicted: 0.65, actual: 0, drug: "rituximab" });
  logPrediction({ ts: new Date().toISOString(), predicted: 0.10, actual: 0, drug: "atorvastatin" });
  console.log("[5] Brier:", brierScore()?.toFixed(3));
  console.log("    calibrated(0.9) =", calibratedProbability(0.9).toFixed(3));
  console.log("    reliability bins:", reliabilityDiagram().filter((r) => r.n > 0).length);

  const safety = checkDoseSafety({ drug: "metformin", age: 71, egfr: 24 });
  console.log("[6] metformin@eGFR24 safety:", severityOf(safety), "->", safety[0]?.message);

  const safety2 = checkDoseSafety({ drug: "atorvastatin", age: 31, pregnant: true });
  console.log("[7] atorvastatin@pregnant safety:", severityOf(safety2), "->", safety2[0]?.message);

  const dirty = {
    name: "Robert Barker",
    ssn: "123-45-6789",
    phone: "(555) 123-4567",
    notes: "Patient SSN 999-88-7777 emailed me at robert@example.com",
    address: { line: ["1 Main St"], city: "Boston" },
    birthDate: "1972-04-15",
  };
  const { value: clean, report } = scrubPHIObject(dirty);
  console.log("[8] redaction kinds:", JSON.stringify(report.kinds));
  console.log("    cleaned notes:", (clean as any).notes);
  console.log("    cleaned ssn:", (clean as any).ssn);

  const h1 = hashPatientId("131926799");
  const h2 = hashPatientId("131926799");
  console.log("[9] patient hash deterministic?", h1 === h2, h1.length, "chars");

  console.log("\nAll smoke checks ran. Inspect data/ for artifacts.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
