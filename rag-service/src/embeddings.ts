let pipeline: any = null;

async function getEmbeddingPipeline() {
  if (!pipeline) {
    // Dynamic import for ESM compatibility
    const { pipeline: createPipeline } = await import("@xenova/transformers");
    console.log("Loading embedding model (first time may download ~30MB)...");
    pipeline = await createPipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
    console.log("Embedding model loaded");
  }
  return pipeline;
}

/** Embed a single text string — returns float array */
export async function embedText(text: string): Promise<number[]> {
  const pipe = await getEmbeddingPipeline();
  const output = await pipe(text, { pooling: "mean", normalize: true });
  return Array.from(output.data as Float32Array);
}

/** Embed multiple texts in batch */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const pipe = await getEmbeddingPipeline();
  const results: number[][] = [];

  // Process one at a time to avoid memory issues
  for (let i = 0; i < texts.length; i++) {
    const output = await pipe(texts[i], { pooling: "mean", normalize: true });
    results.push(Array.from(output.data as Float32Array));

    if ((i + 1) % 10 === 0 || i === texts.length - 1) {
      console.log(`Embedded ${i + 1}/${texts.length} chunks`);
    }
  }

  return results;
}
