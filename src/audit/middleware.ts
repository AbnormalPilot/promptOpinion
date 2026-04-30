import { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";
import { appendFileSync, mkdirSync, existsSync } from "fs";
import { dirname } from "path";
import { hashPatientId } from "./redact";
import { SHARP_HEADERS } from "../sharp/constants";

const AUDIT_LOG_PATH = process.env.AUDIT_LOG_PATH || "data/audit.jsonl";
const AUDIT_ENABLED = process.env.AUDIT_DISABLED !== "1";

declare global {
  namespace Express {
    interface Request {
      traceId?: string;
      patientHash?: string;
    }
  }
}

function ensureDir(path: string) {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function writeAudit(event: Record<string, unknown>) {
  if (!AUDIT_ENABLED) return;
  try {
    ensureDir(AUDIT_LOG_PATH);
    appendFileSync(AUDIT_LOG_PATH, JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n");
  } catch (err) {
    // Audit must never break the request path
    console.error("audit write failed:", (err as Error).message);
  }
}

export function auditMiddleware(req: Request, res: Response, next: NextFunction) {
  req.traceId = (req.headers["x-sharp-trace-id"]?.toString()) || randomUUID();
  res.setHeader("x-sharp-trace-id", req.traceId);

  const rawPid = req.headers[SHARP_HEADERS.patientId]?.toString();
  if (rawPid) req.patientHash = hashPatientId(rawPid);

  const fhirUrl = req.headers[SHARP_HEADERS.fhirServerUrl]?.toString();
  const tokenPresent = !!req.headers[SHARP_HEADERS.fhirAccessToken];

  writeAudit({
    type: "request_in",
    traceId: req.traceId,
    method: req.method,
    path: req.path,
    patientHash: req.patientHash || null,
    fhirUrl: fhirUrl || null,
    tokenPresent,
    ua: req.headers["user-agent"] || null,
  });

  res.on("finish", () => {
    writeAudit({
      type: "request_out",
      traceId: req.traceId,
      status: res.statusCode,
      path: req.path,
    });
  });

  next();
}

export function auditTool(traceId: string | undefined, toolName: string, patientHash: string | undefined, meta: Record<string, unknown> = {}) {
  writeAudit({
    type: "tool_call",
    traceId: traceId || null,
    tool: toolName,
    patientHash: patientHash || null,
    ...meta,
  });
}
