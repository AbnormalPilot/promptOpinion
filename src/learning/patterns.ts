import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";

export interface PatternEntry {
  pattern: string;
  count: number;
  example_drugs: string[];
  last_seen: string;
}

const PATTERNS_PATH = process.env.PATTERNS_PATH || "data/patterns.json";

function ensureDir(path: string) {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function loadPatterns(): PatternEntry[] {
  if (!existsSync(PATTERNS_PATH)) return [];
  try {
    return JSON.parse(readFileSync(PATTERNS_PATH, "utf8"));
  } catch {
    return [];
  }
}

function savePatterns(p: PatternEntry[]) {
  ensureDir(PATTERNS_PATH);
  writeFileSync(PATTERNS_PATH, JSON.stringify(p, null, 2));
}

const PATTERN_BUCKETS: Array<{ id: string; rx: RegExp; description: string }> = [
  { id: "missing_step_therapy", rx: /step\s*therapy|first[-\s]?line|prior\s+(med|treatment)/i, description: "Step therapy documentation incomplete or missing" },
  { id: "missing_lab_values", rx: /lab\s*value|hba1c|ldl|egfr|biomarker/i, description: "Required lab values not cited with date and value" },
  { id: "diagnosis_specificity", rx: /icd[-\s]?10|specific\s+diagnosis|laterality/i, description: "Diagnosis lacks specificity (e.g., laterality, severity, complications)" },
  { id: "duration_undocumented", rx: /duration|months?\s+of|trial\s+length/i, description: "Duration of prior trials not documented" },
  { id: "intolerance_undocumented", rx: /intoleran|adverse|side\s+effect/i, description: "Intolerance to first-line agent not documented" },
  { id: "off_label", rx: /off[-\s]?label|not\s+fda|compendium/i, description: "Off-label use without compendium support" },
  { id: "dose_justification", rx: /dose|dosage|titrat/i, description: "Requested dose not justified for severity" },
  { id: "frequency_limit", rx: /quantity\s+limit|frequency|refill/i, description: "Quantity/frequency exceeds typical limits" },
  { id: "renal_dosing", rx: /renal|kidney|egfr|creatinine/i, description: "Renal function not assessed for dose adjustment" },
  { id: "pregnancy_safety", rx: /pregnan|teratogen|category\s+[abcdx]/i, description: "Pregnancy status / teratogenicity not addressed" },
  { id: "duplicative_therapy", rx: /duplicate|duplicative|concurrent/i, description: "Possible duplicative therapy not justified" },
  { id: "appeal_window", rx: /appeal\s+window|deadline|timely/i, description: "Appeal window expiry risk" },
];

export function classifyFinding(finding: string): string {
  for (const b of PATTERN_BUCKETS) {
    if (b.rx.test(finding)) return b.id;
  }
  return "other";
}

export function recordFindings(drug: string, findings: string[]) {
  const patterns = loadPatterns();
  const now = new Date().toISOString();
  for (const f of findings) {
    const id = classifyFinding(f);
    const existing = patterns.find((p) => p.pattern === id);
    if (existing) {
      existing.count += 1;
      existing.last_seen = now;
      if (!existing.example_drugs.includes(drug)) {
        existing.example_drugs.push(drug);
        if (existing.example_drugs.length > 5) existing.example_drugs.shift();
      }
    } else {
      patterns.push({ pattern: id, count: 1, example_drugs: [drug], last_seen: now });
    }
  }
  savePatterns(patterns);
}

export function topPatterns(n = 5): PatternEntry[] {
  const patterns = loadPatterns();
  patterns.sort((a, b) => b.count - a.count);
  return patterns.slice(0, n);
}

export function patternsForPrompt(): string {
  const top = topPatterns(5);
  if (top.length === 0) return "";
  const bucket = (id: string) => PATTERN_BUCKETS.find((b) => b.id === id)?.description || id;
  return top
    .map((p) => `- ${bucket(p.pattern)} (seen ${p.count}x, e.g. ${p.example_drugs.join(", ")})`)
    .join("\n");
}
