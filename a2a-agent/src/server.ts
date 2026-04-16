import "dotenv/config";
import { rootAgent } from "./agent.js";
import { createA2aApp } from "./app-factory.js";

const PORT = Number(process.env.A2A_PORT ?? 8001);
const URL = process.env.AGENT_URL ?? `http://localhost:${PORT}`;

const app = createA2aApp({
  agent: rootAgent,
  name: "ClinicalContext Prior Auth Agent",
  description: "Orchestrates 11 MCP tools for complete prior authorization automation — patient data, drug safety, CMS policy, PA drafting, and appeals.",
  url: URL,
  version: "1.0.0",
  fhirExtensionUri: process.env.FHIR_EXTENSION_URI ?? "https://promptopinion.ai/schemas/a2a/v1/fhir-context",
});

app.listen(PORT, () => {
  console.log(`A2A Agent running on http://localhost:${PORT}`);
  console.log(`Agent card: http://localhost:${PORT}/.well-known/agent-card.json`);
  console.log(`Health: http://localhost:${PORT}/health`);
});
