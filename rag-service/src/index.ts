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

// Health check
app.get("/health", async (_req, res) => {
  const stats = await getIndexStats();
  res.json({
    status: ready ? "ok" : "building",
    service: "clinicalcontext-rag",
    indexed_chunks: stats.items,
  });
});

// Query endpoint
app.post("/query", async (req, res) => {
  if (!ready) {
    res.status(503).json({ error: "Index still building — try again in a moment" });
    return;
  }

  const { query, topK } = req.body;
  if (!query) {
    res.status(400).json({ error: "Missing query field" });
    return;
  }

  try {
    const results = await queryIndex(query, topK || 5);
    res.json({
      query,
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

    const chunks = await loadCmsNcds();
    if (chunks.length > 0) {
      await buildIndex(chunks);
    }
    ready = true;
    console.log("RAG service ready");
  } catch (err: any) {
    console.error("Failed to build index:", err.message);
    // Still serve — will return 503 on /query until index is built
  }
}

startup();
