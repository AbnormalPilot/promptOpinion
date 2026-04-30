import axios from "axios";
import { createHash } from "crypto";

const RAG_SERVICE_URL = process.env.RAG_SERVICE_URL || "http://localhost:3001";

/** Embed text via rag-service /embed. Falls back to deterministic hash-vector if service unavailable. */
export async function embed(text: string): Promise<number[]> {
  try {
    const res = await axios.post(
      `${RAG_SERVICE_URL}/embed`,
      { text },
      { timeout: 8000 }
    );
    const vec = res.data?.embedding;
    if (Array.isArray(vec) && vec.length > 0) return vec;
  } catch {
    // fall through to fallback
  }
  return hashEmbed(text);
}

/** Last-resort deterministic embedding so memory retrieval still functions when rag-service is down.
 * Not semantic — purely surface-form. Lets eval continue running offline. */
export function hashEmbed(text: string, dim = 384): number[] {
  const tokens = text.toLowerCase().match(/[a-z0-9]+/g) || [];
  const vec = new Array(dim).fill(0);
  for (const tok of tokens) {
    const h = createHash("sha256").update(tok).digest();
    for (let i = 0; i < dim; i++) {
      vec[i] += (h[i % h.length] - 128) / 128;
    }
  }
  // normalize
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}
