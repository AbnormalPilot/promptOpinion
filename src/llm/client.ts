import Groq from "groq-sdk";

let groq: Groq | null = null;

function getGroq(): Groq {
  if (!groq) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error("GROQ_API_KEY not set in environment");
    groq = new Groq({ apiKey });
  }
  return groq;
}

/** Call Groq LLM with system prompt + user message. Returns raw text. */
export async function callLLM(systemPrompt: string, userMessage: string): Promise<string> {
  try {
    const response = await getGroq().chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: systemPrompt + "\n\nIMPORTANT: Respond with valid JSON only. No markdown, no code fences." },
        { role: "user", content: userMessage },
      ],
      temperature: 0.2,
      max_tokens: 4096,
      response_format: { type: "json_object" },
    });

    return response.choices[0]?.message?.content || "{}";
  } catch (err: any) {
    const msg = err?.message || String(err);
    if (msg.includes("429") || msg.includes("rate")) {
      throw new Error("Groq rate limit hit. Wait a moment and retry.");
    }
    throw new Error(`LLM error: ${msg.slice(0, 200)}`);
  }
}

/** Parse JSON from LLM output with fallback */
export function safeParseJSON<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    console.error("Failed to parse LLM JSON:", text.slice(0, 200));
    return fallback;
  }
}
