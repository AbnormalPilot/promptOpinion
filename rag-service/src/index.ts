import "dotenv/config";
import express from "express";
import cors from "cors";
import { loadCmsNcds } from "./cms-loader";
import { buildIndex, queryIndex, getIndexStats } from "./vector-store";

const PORT = parseInt(process.env.RAG_PORT || "3001", 10);
const app = express();
app.use(cors());
app.use(express.json());

let ready = false;
let startupError: string | null = null;
const startedAt = new Date().toISOString();

// Health check
app.get("/health", async (_req, res) => {
  const stats = await getIndexStats();
  res.json({
    status: ready ? "ok" : startupError ? "error" : "building",
    service: "clinicalcontext-rag",
    indexed_chunks: stats.items,
    port: PORT,
    started_at: startedAt,
    uptime_seconds: Math.floor(process.uptime()),
    ...(startupError ? { startup_error: startupError } : {}),
  });
});

// Query endpoint
app.post("/query", async (req, res) => {
  if (!ready) {
    res.status(503).json({ error: "Index still building — try again in a moment" });
    return;
  }

  const { query, topK } = req.body;

  // Input validation
  if (query === undefined || query === null) {
    res.status(400).json({ error: "Missing required field: query" });
    return;
  }
  if (typeof query !== "string") {
    res.status(400).json({ error: "Field 'query' must be a string" });
    return;
  }
  if (query.trim().length === 0) {
    res.status(400).json({ error: "Field 'query' must not be empty" });
    return;
  }
  if (topK !== undefined) {
    if (typeof topK !== "number" || !Number.isInteger(topK) || topK < 1 || topK > 20) {
      res.status(400).json({ error: "Field 'topK' must be an integer between 1 and 20" });
      return;
    }
  }

  try {
    const results = await queryIndex(query.trim(), topK ?? 5);
    res.json({
      query: query.trim(),
      results: results.map((r) => ({
        ncdId: r.ncdId,
        title: r.title,
        section: r.section,
        text: r.text,
        relevance_score: Math.round(r.score * 100) / 100,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Startup: build index
async function startup() {
  app.listen(PORT, () => {
    console.log(`RAG service starting on http://localhost:${PORT}`);
    console.log(`Building CMS NCD index...`);
  });

  try {
    const stats = await getIndexStats();
    if (stats.items > 0) {
      console.log(`Index already exists with ${stats.items} chunks — ready`);
      ready = true;
      return;
    }

    // loadCmsNcds already falls back to local data if CMS API is down,
    // so the service will always start even when the API is unavailable.
    const chunks = await loadCmsNcds();
    if (chunks.length === 0) {
      throw new Error("No NCD chunks available — neither from CMS API nor fallback dataset");
    }

    await buildIndex(chunks);
    ready = true;
    console.log("RAG service ready");
  } catch (err: any) {
    startupError = err.message;
    console.error("Failed to build index:", err.message);
    // Server continues running — /health will surface the error,
    // /query returns 503 until a successful build completes.
  }
}

startup();
