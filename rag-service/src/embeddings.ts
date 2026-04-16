let pipeline: any = null;
// Correct model name on Hugging Face Hub for Xenova's ONNX port of all-MiniLM-L6-v2
const MODEL_NAME = "Xenova/all-MiniLM-L6-v2";

async function getEmbeddingPipeline() {
  if (!pipeline) {
    let createPipeline: any;
    try {
      // Dynamic import for ESM compatibility
      const mod = await import("@xenova/transformers");
      createPipeline = mod.pipeline;
    } catch (err: any) {
      throw new Error(`Failed to import @xenova/transformers: ${err.message}`);
    }

    console.log(`Loading embedding model ${MODEL_NAME} (first time may download ~30MB)...`);
    try {
      pipeline = await createPipeline("feature-extraction", MODEL_NAME);
    } catch (err: any) {
      throw new Error(
        `Failed to load embedding model "${MODEL_NAME}". ` +
        `Ensure network access is available for the initial download, ` +
        `or pre-cache the model. Original error: ${err.message}`
      );
    }
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
