import express from "express";
import { v4 as uuidv4 } from "uuid";
import { Runner, InMemorySessionService } from "@google/adk";
import type { LlmAgent } from "@google/adk";

interface A2aAppConfig {
  agent: LlmAgent;
  name: string;
  description: string;
  url: string;
  version?: string;
  fhirExtensionUri?: string;
}

export function createA2aApp(config: A2aAppConfig) {
  const { agent, name, description, url, version = "1.0.0", fhirExtensionUri } = config;

  const runner = new Runner({
    agent,
    sessionService: new InMemorySessionService(),
  });

  // Agent card — A2A v1 compliant discovery document
  const agentCard = {
    name,
    description,
    version,
    capabilities: { streaming: false, pushNotifications: false },
    skills: [
      {
        id: "prior-auth-full",
        name: "Prior Authorization Automation",
        description: "Complete PA workflow: patient data → drug safety → CMS coverage policy → step therapy analysis → PA letter with ICD-10 codes and NCD citations",
        tags: ["fhir", "healthcare", "prior-auth", "mcp", "cms-ncd"],
      },
      {
        id: "prior-auth-appeal",
        name: "Prior Authorization Appeal",
        description: "Generate appeal letters for denied PA requests citing clinical guidelines, CMS policy, and regulatory leverage",
        tags: ["fhir", "healthcare", "appeal", "clinical-guidelines"],
      },
    ],
    supportedInterfaces: [
      { protocol: "a2a", url: url },
    ],
    ...(fhirExtensionUri ? { extensions: [fhirExtensionUri] } : {}),
  };

  const app = express();
  app.use(express.json());

  // Agent card endpoint — always public
  app.get("/.well-known/agent-card.json", (_req, res) => {
    res.json(agentCard);
  });

  // Health check
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", agent: name, version });
  });

  // A2A JSON-RPC endpoint
  app.post("/", async (req, res) => {
    try {
      const body = req.body;
      const method = body?.method;

      if (method === "message/send") {
        const message = body?.params?.message;
        if (!message) {
          res.status(400).json({ jsonrpc: "2.0", error: { code: -32602, message: "Missing message" }, id: body?.id });
          return;
        }

        // Extract text from message parts
        const text = (message.parts || [])
          .filter((p: any) => p.kind === "text")
          .map((p: any) => p.text)
          .join("\n");

        if (!text) {
          res.status(400).json({ jsonrpc: "2.0", error: { code: -32602, message: "No text in message" }, id: body?.id });
          return;
        }

        // Build session state from metadata (FHIR context)
        const stateDelta: Record<string, any> = {};
        if (message.metadata) {
          stateDelta["a2aMetadata"] = message.metadata;
          // Also flatten for direct tool access
          if (message.metadata.fhirUrl) stateDelta["fhirUrl"] = message.metadata.fhirUrl;
          if (message.metadata.fhirToken) stateDelta["fhirToken"] = message.metadata.fhirToken;
          if (message.metadata.patientId) stateDelta["patientId"] = message.metadata.patientId;
        }

        const contextId = message.contextId || uuidv4();
        const sessionId = contextId;

        // Run the agent
        let finalText = "";
        const events = runner.run({
          userId: "user",
          sessionId,
          newMessage: { role: "user", parts: [{ text }] },
        });

        for await (const event of events) {
          if (event.content?.parts) {
            for (const part of event.content.parts) {
              if ((part as any).text) finalText += (part as any).text;
            }
          }
        }

        // Return A2A response
        res.json({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            message: {
              kind: "message",
              messageId: uuidv4(),
              contextId,
              role: "agent",
              parts: [{ kind: "text", text: finalText }],
            },
          },
        });
      } else {
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32601, message: `Unknown method: ${method}` },
          id: body?.id,
        });
      }
    } catch (err: any) {
      console.error("A2A request error:", err);
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: err.message || "Internal error" },
        id: req.body?.id,
      });
    }
  });

  return app;
}
