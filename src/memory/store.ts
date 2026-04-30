import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import { randomUUID } from "crypto";
import { embed, cosine } from "./embed";

export interface PACase {
  id: string;
  ts: string;
  drug: string;
  diagnosis_icd10: string;
  payer?: string;
  evidence_summary: string;
  predicted_probability?: number;
  outcome: "approved" | "denied" | "appealed_won" | "appealed_lost" | "pending";
  denial_reason?: string;
  adversarial_findings?: string[];
  patient_age?: number;
  step_therapy_met?: boolean;
  trace_id?: string;
}

export interface MemoryRecord extends PACase {
  embedding: number[];
}

const MEMORY_PATH = process.env.MEMORY_PATH || "data/memory.jsonl";

let cache: MemoryRecord[] | null = null;

function ensureDir(path: string) {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function load(): MemoryRecord[] {
  if (cache) return cache;
  if (!existsSync(MEMORY_PATH)) {
    cache = [];
    return cache;
  }
  try {
    const lines = readFileSync(MEMORY_PATH, "utf8").trim().split("\n").filter(Boolean);
    cache = lines.map((l) => JSON.parse(l) as MemoryRecord);
  } catch (err) {
    console.error("memory load error:", (err as Error).message);
    cache = [];
  }
  return cache;
}

export function memorySize(): number {
  return load().length;
}

function caseText(c: PACase): string {
  return [
    `drug: ${c.drug}`,
    `diagnosis: ${c.diagnosis_icd10}`,
    `payer: ${c.payer || "unknown"}`,
    `evidence: ${c.evidence_summary}`,
    c.denial_reason ? `denial: ${c.denial_reason}` : "",
    `outcome: ${c.outcome}`,
  ].filter(Boolean).join(" | ");
}

export async function recordCase(c: Omit<PACase, "id" | "ts">): Promise<MemoryRecord> {
  const full: PACase = {
    id: randomUUID(),
    ts: new Date().toISOString(),
    ...c,
  };
  const embedding = await embed(caseText(full));
  const record: MemoryRecord = { ...full, embedding };
  ensureDir(MEMORY_PATH);
  appendFileSync(MEMORY_PATH, JSON.stringify(record) + "\n");
  if (cache) cache.push(record);
  return record;
}

export interface RetrievalResult {
  case: MemoryRecord;
  similarity: number;
}

export async function retrieveSimilar(query: { drug: string; diagnosis_icd10: string; payer?: string; evidence_summary?: string }, k = 3): Promise<RetrievalResult[]> {
  const corpus = load();
  if (corpus.length === 0) return [];
  const qVec = await embed(caseText({
    drug: query.drug,
    diagnosis_icd10: query.diagnosis_icd10,
    payer: query.payer,
    evidence_summary: query.evidence_summary || "",
    outcome: "pending",
  }));
  const scored = corpus.map((c) => ({ case: c, similarity: cosine(qVec, c.embedding) }));
  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, k).filter((r) => r.similarity > 0.3);
}

/** Format retrieved cases as concise prompt-friendly text. */
export function formatPriorCases(results: RetrievalResult[]): string {
  if (results.length === 0) return "No comparable past cases on record.";
  return results.map((r, i) => {
    const c = r.case;
    return `[Case ${i + 1} | similarity ${r.similarity.toFixed(2)} | outcome ${c.outcome}]
  drug: ${c.drug}
  dx: ${c.diagnosis_icd10}
  payer: ${c.payer || "n/a"}
  step_therapy_met: ${c.step_therapy_met ?? "unknown"}
  ${c.denial_reason ? "DENIAL REASON: " + c.denial_reason : ""}
  ${c.adversarial_findings?.length ? "WEAKNESSES FOUND: " + c.adversarial_findings.join("; ") : ""}`;
  }).join("\n\n");
}

export function clearMemory() {
  cache = [];
  if (existsSync(MEMORY_PATH)) writeFileSync(MEMORY_PATH, "");
}

export function reloadMemory() {
  cache = null;
  load();
}
