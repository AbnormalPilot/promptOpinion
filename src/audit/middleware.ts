import { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";
import { hashPatientId } from "./redact";
import { SHARP_HEADERS } from "../sharp/constants";
import { appendJsonl } from "../util/jsonl";

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

/** Defensive scrubber: walks the event object and replaces any string value
 * that looks like a Bearer token or a JWT with [REDACTED-TOKEN]. Should be a
 * no-op given current call sites (we only persist tokenPresent: boolean), but
 * acts as belt-and-braces if a future callsite accidentally forwards a header. */
const BEARER_RE = /^Bearer\s/i;
const JWT_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
function scrubTokens(v: unknown): unknown {
  if (typeof v === "string") {
    if (BEARER_RE.test(v) || JWT_RE.test(v)) return "[REDACTED-TOKEN]";
    return v;
  }
  if (Array.isArray(v)) return v.map(scrubTokens);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = scrubTokens(val);
    return out;
  }
  return v;
}

export function writeAudit(event: Record<string, unknown>) {
  if (!AUDIT_ENABLED) return;
  // Fire-and-forget: serialised through per-file mutex in appendJsonl.
  // Audit must never break the request path, and must never block it.
  const scrubbed = scrubTokens({ ts: new Date().toISOString(), ...event }) as Record<string, unknown>;
  appendJsonl(AUDIT_LOG_PATH, scrubbed).catch((err) => {
    console.error("audit write failed:", (err as Error).message);
  });
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

if (process.env.AUDIT_SELFTEST === "1") {
  const tampered = {
    type: "tool_call",
    bearer: "Bearer abc.def.ghi",
    raw_jwt: "aAA-1.bBB-2.cCC-3",
    nested: { token: "Bearer SHOULD-REDACT", inner: ["safe", "Bearer xyz"] },
    safe: "hello world",
  };
  const scrubbed = scrubTokens(tampered) as any;
  const ok =
    scrubbed.bearer === "[REDACTED-TOKEN]" &&
    scrubbed.raw_jwt === "[REDACTED-TOKEN]" &&
    scrubbed.nested.token === "[REDACTED-TOKEN]" &&
    scrubbed.nested.inner[1] === "[REDACTED-TOKEN]" &&
    scrubbed.safe === "hello world";
  console.log(`[audit selftest] ok=${ok} ${JSON.stringify(scrubbed)}`);
}
