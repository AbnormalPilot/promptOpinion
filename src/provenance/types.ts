export type Citation =
  | { kind: "fhir"; resourceType: string; resourceId: string; path: string; excerpt?: string }
  | { kind: "ncd"; ncdId: string; section?: string; excerpt: string; relevance?: number }
  | { kind: "rxnorm"; rxcui: string; name?: string }
  | { kind: "ocr"; documentId: string; page?: number; confidence: number; excerpt?: string }
  | { kind: "memory"; caseId: string; outcome: "approved" | "denied" | "appealed"; similarity: number }
  | { kind: "llm"; model: string; confidence: number; rationale?: string };

export interface Cited<T> {
  value: T;
  provenance: Citation[];
}

export interface ProvenancedResult {
  data: Record<string, unknown>;
  provenance: Citation[];
  data_completeness: "complete" | "partial" | "insufficient";
  gaps?: string[];
  trace_id?: string;
}

export function emptyProvenance(): Citation[] {
  return [];
}

export function fhirCite(resourceType: string, resourceId: string, path: string, excerpt?: string): Citation {
  return { kind: "fhir", resourceType, resourceId, path, excerpt };
}

export function llmCite(model: string, confidence: number, rationale?: string): Citation {
  return { kind: "llm", model, confidence, rationale };
}

export function ncdCite(ncdId: string, excerpt: string, section?: string, relevance?: number): Citation {
  return { kind: "ncd", ncdId, section, excerpt, relevance };
}

export function memoryCite(caseId: string, outcome: "approved" | "denied" | "appealed", similarity: number): Citation {
  return { kind: "memory", caseId, outcome, similarity };
}
