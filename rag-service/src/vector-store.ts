import { LocalIndex } from "vectra";
import path from "path";
import { embedText, embedBatch } from "./embeddings";
import { NcdChunk } from "./cms-loader";

const INDEX_PATH = path.join(process.cwd(), "data", "ncd-index");

let index: LocalIndex | null = null;

async function getIndex(): Promise<LocalIndex> {
  if (!index) {
    index = new LocalIndex(INDEX_PATH);
    if (!(await index.isIndexCreated())) {
      await index.createIndex();
    }
  }
  return index;
}

export interface IndexedChunk {
  id: string;
  title: string;
  section: string;
  text: string;
  ncdId: string;
  score: number;
}

/** Build the vector index from NCD chunks */
export async function buildIndex(chunks: NcdChunk[]): Promise<number> {
  const idx = await getIndex();

  // Delete existing items if rebuilding
  const stats = await idx.getIndexStats();
  if (stats.items > 0) {
    console.log(`Index exists with ${stats.items} items — rebuilding`);
    // Recreate index
    index = new LocalIndex(INDEX_PATH);
    await index.createIndex();
  }

  console.log(`Embedding ${chunks.length} chunks...`);
  const texts = chunks.map((c) => `${c.title}: ${c.text}`);
  const embeddings = await embedBatch(texts);

  console.log(`Inserting ${chunks.length} vectors into index...`);
  for (let i = 0; i < chunks.length; i++) {
    await idx.insertItem({
      vector: embeddings[i],
      metadata: {
        id: chunks[i].id,
        title: chunks[i].title,
        section: chunks[i].section,
        text: chunks[i].text,
        ncdId: chunks[i].ncdId,
      },
    });
  }

  const finalStats = await idx.getIndexStats();
  console.log(`Index built: ${finalStats.items} vectors`);
  return finalStats.items;
}

/** Query the index for relevant NCD chunks */
export async function queryIndex(query: string, topK: number = 5): Promise<IndexedChunk[]> {
  const idx = await getIndex();

  const stats = await idx.getIndexStats();
  if (stats.items === 0) {
    return [];
  }

  const queryVector = await embedText(query);
  const results = await idx.queryItems(queryVector, topK);

  return results.map((r) => ({
    id: (r.item.metadata as any).id,
    title: (r.item.metadata as any).title,
    section: (r.item.metadata as any).section,
    text: (r.item.metadata as any).text,
    ncdId: (r.item.metadata as any).ncdId,
    score: r.score,
  }));
}

/** Get index stats */
export async function getIndexStats(): Promise<{ items: number }> {
  try {
    const idx = await getIndex();
    return await idx.getIndexStats();
  } catch {
    return { items: 0 };
  }
}
