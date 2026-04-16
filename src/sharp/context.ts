import { Request } from "express";
import * as jose from "jose";
import { SHARP_HEADERS } from "./constants";

export interface FhirContext {
  url: string;
  token?: string;
}

/** Extract FHIR server context from SHARP headers */
export function getFhirContext(req: Request): FhirContext | null {
  const url = req.headers[SHARP_HEADERS.fhirServerUrl]?.toString();
  if (!url) return null;
  const token = req.headers[SHARP_HEADERS.fhirAccessToken]?.toString();
  return { url, token };
}

/** Extract patient ID: first from JWT claim, then from header, then from tool arg */
export function getPatientId(req: Request, toolArg?: string): string | null {
  // 1. Try JWT patient claim
  const fhirToken = req.headers[SHARP_HEADERS.fhirAccessToken]?.toString();
  if (fhirToken) {
    try {
      const claims = jose.decodeJwt(fhirToken);
      if (claims["patient"]) return claims["patient"]?.toString() ?? null;
    } catch {
      // Not a valid JWT — skip
    }
  }

  // 2. Try x-patient-id header
  const headerPatientId = req.headers[SHARP_HEADERS.patientId]?.toString();
  if (headerPatientId) return headerPatientId;

  // 3. Fallback to tool argument (for local testing)
  return toolArg ?? null;
}
