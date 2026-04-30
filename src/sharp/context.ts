import { Request } from "express";
import * as jose from "jose";
import { SHARP_HEADERS } from "./constants";

export interface FhirContext {
  url: string;
  token?: string;
}

/** Extract FHIR server context from SHARP headers.
 *
 * Returns context if EITHER the url header OR the access-token header is
 * present. A common SMART/SHARP caller posture is to omit the URL header
 * (assuming the server uses its env default) but still send a bearer token —
 * the prior `if (!url) return null` silently dropped that token. We now
 * fall back to FHIR_BASE_URL when url is absent so the token survives. */
export function getFhirContext(req: Request): FhirContext | null {
  const urlHeader = req.headers[SHARP_HEADERS.fhirServerUrl]?.toString();
  const token = req.headers[SHARP_HEADERS.fhirAccessToken]?.toString();
  if (!urlHeader && !token) return null;
  const url = urlHeader || process.env.FHIR_BASE_URL || "";
  if (!url) return null; // no header, no env default — genuinely no context
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
