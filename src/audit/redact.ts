const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/g;
const PHONE_RE = /\b(\+?1[-.\s]?)?(\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g;
const EMAIL_RE = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;
const MRN_RE = /\bMRN[:\s]*\d{4,}\b/gi;
const DOB_RE = /\b(0?[1-9]|1[0-2])[\/\-](0?[1-9]|[12]\d|3[01])[\/\-](19|20)\d{2}\b/g;

export interface RedactionReport {
  redacted: number;
  kinds: Record<string, number>;
}

export function scrubPHIString(input: string): { text: string; report: RedactionReport } {
  const kinds: Record<string, number> = {};
  let total = 0;
  const tally = (kind: string, count: number) => {
    if (count > 0) {
      kinds[kind] = (kinds[kind] || 0) + count;
      total += count;
    }
  };
  let out = input;
  out = out.replace(SSN_RE, (m) => { tally("ssn", 1); return "[REDACTED-SSN]"; });
  out = out.replace(PHONE_RE, (m) => { tally("phone", 1); return "[REDACTED-PHONE]"; });
  out = out.replace(EMAIL_RE, (m) => { tally("email", 1); return "[REDACTED-EMAIL]"; });
  out = out.replace(MRN_RE, (m) => { tally("mrn", 1); return "[REDACTED-MRN]"; });
  out = out.replace(DOB_RE, (m) => { tally("dob", 1); return "[REDACTED-DOB]"; });
  return { text: out, report: { redacted: total, kinds } };
}

const PHI_FIELDS = new Set([
  "ssn", "socialSecurityNumber", "phone", "telecom", "email",
  "address", "line", "city", "postalCode", "state",
  "mrn", "memberId", "subscriberId",
]);

const KEEP_PARTIAL = new Set(["birthDate"]);

export function scrubPHIObject(obj: any, report: RedactionReport = { redacted: 0, kinds: {} }): { value: any; report: RedactionReport } {
  if (obj == null) return { value: obj, report };
  if (typeof obj === "string") {
    const r = scrubPHIString(obj);
    for (const [k, v] of Object.entries(r.report.kinds)) {
      report.kinds[k] = (report.kinds[k] || 0) + v;
      report.redacted += v;
    }
    return { value: r.text, report };
  }
  if (Array.isArray(obj)) {
    return { value: obj.map((v) => scrubPHIObject(v, report).value), report };
  }
  if (typeof obj === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(obj)) {
      if (PHI_FIELDS.has(k)) {
        report.kinds[k] = (report.kinds[k] || 0) + 1;
        report.redacted += 1;
        out[k] = "[REDACTED]";
      } else if (KEEP_PARTIAL.has(k) && typeof v === "string") {
        out[k] = v.slice(0, 4) + "-XX-XX";
        report.kinds["birthDate-month-day"] = (report.kinds["birthDate-month-day"] || 0) + 1;
        report.redacted += 1;
      } else {
        out[k] = scrubPHIObject(v, report).value;
      }
    }
    return { value: out, report };
  }
  return { value: obj, report };
}

import { createHash } from "crypto";
const SALT = process.env.AUDIT_SALT || "clinicalcontext-default-salt-rotate-me";
export function hashPatientId(id: string): string {
  return createHash("sha256").update(SALT + ":" + id).digest("hex").slice(0, 16);
}
