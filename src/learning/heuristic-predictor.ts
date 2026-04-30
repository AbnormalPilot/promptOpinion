/** Offline heuristic approval-probability predictor.
 *  Used as a fallback when no LLM API key is available — and as a structural
 *  baseline the LLM predictor must beat. Produces calibrated, defensible
 *  probabilities from rule-based features that match real PA approval drivers. */

import { retrieveSimilar, RetrievalResult } from "../memory/store";
import { checkDoseSafety, severityOf } from "../clinical/dosing";

export interface HeuristicInput {
  drug: string;
  diagnosis_icd10: string;
  payer?: string;
  evidence_summary: string;
  step_therapy_met?: boolean;
  patient_age?: number;
  egfr?: number;
  pregnant?: boolean;
}

export interface HeuristicOutput {
  predicted_probability: number;
  key_factors: Array<{ factor: string; direction: "positive" | "negative"; weight: number; rationale: string }>;
  primary_denial_risks: string[];
  comparable_priors_used: string[];
  rationale: string;
  prior_cases_count: number;
}

const STRONG_EVIDENCE_TOKENS = [
  "hba1c", "ldl", "egfr", "fev1", "ejection fraction", "ef ",
  "biomarker", "genetic", "mutation", "stage iv", "ecog", "phq-9",
  "cha2ds2", "pasi", "peer-reviewed",
];

const WEAK_EVIDENCE_FLAGS = [
  /no prior medication/i,
  /no documented/i,
  /no labs/i,
  /no imaging/i,
  /newly diagnosed/i,
  /no compendium/i,
  /off[-\s]?label/i,
];

const LIFETIME_HIGH_APPROVAL_DRUGS = [
  "metformin", "lisinopril", "atorvastatin", "simvastatin", "aspirin",
];

function tokenScore(text: string): number {
  const t = text.toLowerCase();
  let n = 0;
  for (const tok of STRONG_EVIDENCE_TOKENS) if (t.includes(tok)) n++;
  return Math.min(n, 4);
}

function weakFlags(text: string): number {
  let n = 0;
  for (const r of WEAK_EVIDENCE_FLAGS) if (r.test(text)) n++;
  return n;
}

export async function heuristicPredict(input: HeuristicInput): Promise<HeuristicOutput> {
  const factors: HeuristicOutput["key_factors"] = [];
  let logit = 0; // log-odds; we map to probability via sigmoid at the end

  // Base rate ~0.5 for an unknown PA. We then add/subtract.
  // Step therapy
  if (input.step_therapy_met === true) {
    logit += 1.4;
    factors.push({ factor: "step_therapy_met", direction: "positive", weight: 1.4, rationale: "Documented step therapy is the largest single driver of approval." });
  } else if (input.step_therapy_met === false) {
    logit -= 1.6;
    factors.push({ factor: "step_therapy_not_met", direction: "negative", weight: 1.6, rationale: "Failed step therapy is the most common cited denial reason." });
  }

  // Evidence specificity
  const tok = tokenScore(input.evidence_summary);
  if (tok > 0) {
    logit += 0.35 * tok;
    factors.push({ factor: "specific_clinical_values_cited", direction: "positive", weight: 0.35 * tok, rationale: `${tok} domain-specific evidence tokens (labs/biomarkers/staging) detected.` });
  }
  const weak = weakFlags(input.evidence_summary);
  if (weak > 0) {
    logit -= 0.6 * weak;
    factors.push({ factor: "weak_documentation_flags", direction: "negative", weight: 0.6 * weak, rationale: `${weak} documentation gap signals detected.` });
  }

  // Dose safety
  const safety = checkDoseSafety({
    drug: input.drug,
    age: input.patient_age,
    egfr: input.egfr,
    pregnant: input.pregnant,
  });
  const sev = severityOf(safety);
  if (sev === "block") {
    logit -= 4.5;
    factors.push({ factor: "dose_safety_block", direction: "negative", weight: 4.5, rationale: "Pre-flight blocked: contraindication or pregnancy-category-X." });
  } else if (sev === "warning") {
    logit -= 0.8;
    factors.push({ factor: "dose_safety_warning", direction: "negative", weight: 0.8, rationale: "Renal/pediatric/geriatric concern — payer will scrutinize." });
  }

  // Cheap drug bias
  if (LIFETIME_HIGH_APPROVAL_DRUGS.some((d) => input.drug.toLowerCase().includes(d))) {
    logit += 0.5;
    factors.push({ factor: "low_cost_high_approval_drug", direction: "positive", weight: 0.5, rationale: "Generic / first-line agent — historically near-universal approval when appropriate." });
  }

  // Memory retrieval
  const priors = await retrieveSimilar({
    drug: input.drug,
    diagnosis_icd10: input.diagnosis_icd10,
    payer: input.payer,
    evidence_summary: input.evidence_summary,
  }, 3);

  let priorAdj = 0;
  for (const p of priors) {
    const w = Math.min(p.similarity, 0.95);
    if (p.case.outcome === "approved" || p.case.outcome === "appealed_won") priorAdj += 0.9 * w;
    else if (p.case.outcome === "denied" || p.case.outcome === "appealed_lost") priorAdj -= 1.2 * w;
  }
  if (priorAdj !== 0) {
    logit += priorAdj;
    factors.push({
      factor: "memory_retrieval",
      direction: priorAdj > 0 ? "positive" : "negative",
      weight: Math.abs(priorAdj),
      rationale: `${priors.length} similar prior cases retrieved; net signal ${priorAdj > 0 ? "approval" : "denial"}.`,
    });
  }

  const probability = sigmoid(logit);
  const denialRisks = collectDenialRisks(input, safety, weak);
  return {
    predicted_probability: clamp(probability, 0.02, 0.98),
    key_factors: factors,
    primary_denial_risks: denialRisks,
    comparable_priors_used: priors.map((p: RetrievalResult) => `${p.case.id} (sim ${p.similarity.toFixed(2)}, ${p.case.outcome})`),
    rationale: explain(input, probability, priors.length, sev),
    prior_cases_count: priors.length,
  };
}

function collectDenialRisks(input: HeuristicInput, safety: ReturnType<typeof checkDoseSafety>, weak: number): string[] {
  const out: string[] = [];
  if (input.step_therapy_met === false) out.push("Step therapy not documented as met");
  if (weak > 0) out.push("Insufficient documentation in record");
  for (const f of safety) if (f.level !== "info") out.push(f.message);
  if (/off[-\s]?label/i.test(input.evidence_summary)) out.push("Off-label use without compendium support");
  return out;
}

function explain(input: HeuristicInput, p: number, priorN: number, sev: string): string {
  if (p >= 0.75) return `Strong case: step therapy + specific evidence + ${priorN} prior similar cases support approval.`;
  if (p >= 0.5) return `Defensible case with notable gaps. Address primary denial risks before submission.`;
  if (p >= 0.25) return `Weak case. Significant documentation gaps or contraindications likely to drive denial.`;
  return `Very low approval probability${sev === "block" ? " — clinical safety BLOCK detected" : ""}. Recommend gathering more evidence or pursuing an alternative.`;
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
