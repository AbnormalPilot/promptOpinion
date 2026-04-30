/** Heuristics for clinical dose-safety checks. Not a substitute for a formal CDSS,
 *  but catches the obvious failure modes a PA letter must not miss. */

export interface DoseSafetyInput {
  age?: number | null;
  weightKg?: number | null;
  egfr?: number | null;
  pregnant?: boolean | null;
  drug: string;
}

export interface DoseSafetyFinding {
  level: "info" | "warning" | "block";
  message: string;
  recommendation?: string;
}

const RENAL_ADJUSTED_DRUGS: Record<string, { thresholdEgfr: number; advice: string }> = {
  metformin: { thresholdEgfr: 30, advice: "Contraindicated when eGFR < 30. Dose reduce 30-45." },
  gabapentin: { thresholdEgfr: 60, advice: "Dose adjustment required for eGFR < 60." },
  enoxaparin: { thresholdEgfr: 30, advice: "Reduce to 1 mg/kg once daily for eGFR < 30." },
  apixaban: { thresholdEgfr: 25, advice: "Reduce to 2.5 mg BID with risk factors." },
  rivaroxaban: { thresholdEgfr: 30, advice: "Avoid for eGFR < 30." },
  digoxin: { thresholdEgfr: 50, advice: "Lower dose for reduced renal function." },
  vancomycin: { thresholdEgfr: 50, advice: "AUC-guided or extended interval dosing." },
  semaglutide: { thresholdEgfr: 30, advice: "Caution with severe renal impairment, monitor for dehydration." },
};

const PREGNANCY_CATEGORY_X: string[] = [
  "isotretinoin", "warfarin", "methotrexate", "thalidomide", "lenalidomide",
  "ribavirin", "finasteride", "leflunomide", "atorvastatin", "rosuvastatin",
  "simvastatin", "lovastatin", "fluvastatin", "pravastatin",
];

const PEDIATRIC_BLACKBOX: Record<string, { minAge: number; reason: string }> = {
  ciprofloxacin: { minAge: 18, reason: "Tendon rupture / cartilage risk in pediatrics outside specific indications." },
  doxycycline: { minAge: 8, reason: "Tooth discoloration under age 8." },
  aspirin: { minAge: 16, reason: "Reye syndrome risk under age 16 with viral illness." },
  codeine: { minAge: 12, reason: "FDA contraindicated under 12 due to ultra-rapid metabolizer risk." },
  tramadol: { minAge: 12, reason: "FDA contraindicated under 12." },
};

export function checkDoseSafety(input: DoseSafetyInput): DoseSafetyFinding[] {
  const findings: DoseSafetyFinding[] = [];
  const drug = input.drug.toLowerCase();

  for (const [k, v] of Object.entries(RENAL_ADJUSTED_DRUGS)) {
    if (drug.includes(k) && input.egfr != null && input.egfr < v.thresholdEgfr) {
      findings.push({
        level: input.egfr < v.thresholdEgfr - 10 ? "block" : "warning",
        message: `Renal dosing concern: eGFR ${input.egfr} below threshold ${v.thresholdEgfr} for ${k}.`,
        recommendation: v.advice,
      });
    }
  }

  for (const drugX of PREGNANCY_CATEGORY_X) {
    if (drug.includes(drugX) && input.pregnant) {
      findings.push({
        level: "block",
        message: `${drugX} is pregnancy category X — teratogenic. Do not submit PA without explicit pregnancy-status review.`,
        recommendation: "Confirm pregnancy status, consult MFM, document discussion of risks.",
      });
    }
  }

  for (const [k, v] of Object.entries(PEDIATRIC_BLACKBOX)) {
    if (drug.includes(k) && input.age != null && input.age < v.minAge) {
      findings.push({
        level: "warning",
        message: `Pediatric concern: ${k} not first-line under age ${v.minAge}.`,
        recommendation: v.reason,
      });
    }
  }

  if (input.age != null && input.age >= 75) {
    findings.push({
      level: "info",
      message: `Geriatric (age ${input.age}): consider Beers Criteria for potentially inappropriate medications.`,
    });
  }

  return findings;
}

export function severityOf(findings: DoseSafetyFinding[]): "block" | "warning" | "info" | "none" {
  if (findings.some((f) => f.level === "block")) return "block";
  if (findings.some((f) => f.level === "warning")) return "warning";
  if (findings.some((f) => f.level === "info")) return "info";
  return "none";
}
