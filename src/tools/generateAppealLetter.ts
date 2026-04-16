import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { IMcpTool, textResponse } from "./types";
import { FhirClient, FhirConfig } from "../fhir/client";
import { callLLM, safeParseJSON } from "../llm/client";

const APPEAL_SYSTEM = `You are a clinical documentation specialist with expertise in prior authorization appeals for US health insurers.

A prior authorization request was denied. Write a compelling appeal letter that addresses the denial reason with additional clinical justification.

Return a JSON object with:
- "letter": string (the complete appeal letter)
- "appeal_strategy": string (brief description of the appeal approach)
- "additional_evidence_cited": string[] (new evidence points emphasized in the appeal)
- "denial_counterarguments": string[] (specific arguments against each denial reason)
- "regulatory_citations": string[] (any applicable CMS rules, parity laws, or clinical guidelines cited)
- "recommended_attachments": string[] (supporting documents that should accompany the appeal)
- "escalation_options": string[] (next steps if appeal is denied: external review, state insurance commissioner, etc.)
- "confidence": number (0-1)

The appeal letter must include:
1. Header: "APPEAL LETTER — DRAFT FOR PHYSICIAN REVIEW"
2. Reference to original PA request and denial
3. Restatement of medical necessity with stronger language
4. Direct response to each denial reason
5. Citations to clinical guidelines (AMA, specialty societies) supporting the treatment
6. Emphasis on patient harm from delayed/denied treatment
7. Request for expedited review if clinically urgent

Tone: Firm, evidence-based, professional. Assert the patient's right to medically necessary treatment.
IMPORTANT: This is a DRAFT for physician review before submission.`;

class GenerateAppealLetterTool implements IMcpTool {
  registerTool(server: McpServer, fhirConfig?: FhirConfig) {
    server.tool(
      "generate_appeal_letter",
      "Generates a prior authorization appeal letter when an initial PA request was denied. Uses AI to craft counterarguments to specific denial reasons, cite clinical guidelines, and build a stronger medical necessity case.",
      {
        patient_id: z.string().optional().describe("FHIR Patient resource ID (auto-resolved from SHARP context if omitted)"),
        requested_medication_or_procedure: z.string().describe("The medication or procedure that was denied"),
        denial_reason: z.string().describe("The reason given by the payer for denying the PA request"),
        requesting_provider: z.string().optional().describe("Name of requesting provider"),
        payer_name: z.string().optional().describe("Insurance payer name"),
        original_pa_date: z.string().optional().describe("Date the original PA was submitted"),
      },
      async ({ patient_id, requested_medication_or_procedure, denial_reason, requesting_provider, payer_name, original_pa_date }) => {
        const pid = patient_id || fhirConfig?.patientId;
        if (!pid) return textResponse("Error: No patient_id provided via argument or SHARP context");
        const fhir = new FhirClient(fhirConfig);

        const [patient, conditions, medications, observations, allergies] = await Promise.all([
          fhir.read(`Patient/${pid}`),
          fhir.search("Condition", { patient: pid }),
          fhir.search("MedicationRequest", { patient: pid }),
          fhir.search("Observation", { patient: pid, _sort: "-date", _count: "20" }),
          fhir.search("AllergyIntolerance", { patient: pid }),
        ]);

        if (!patient) return textResponse(`Patient ${pid} not found`);

        const patientData = {
          patient: {
            name: formatName(patient.name),
            birthDate: patient.birthDate,
            gender: patient.gender,
            identifier: patient.identifier?.map((i: any) => ({ system: i.system, value: i.value })),
          },
          conditions: conditions.map((c: any) => ({
            display: c.code?.coding?.[0]?.display || c.code?.text,
            code: c.code?.coding?.[0]?.code,
            system: c.code?.coding?.[0]?.system,
            clinicalStatus: c.clinicalStatus?.coding?.[0]?.code,
            onsetDate: c.onsetDateTime,
          })),
          allMedications: medications.map((m: any) => ({
            medication: m.medicationCodeableConcept?.coding?.[0]?.display || m.medicationCodeableConcept?.text || "Unknown",
            status: m.status,
            authoredOn: m.authoredOn,
          })),
          observations: observations.map((o: any) => ({
            code: o.code?.coding?.[0]?.display || o.code?.text,
            value: o.valueQuantity ? `${o.valueQuantity.value} ${o.valueQuantity.unit || ""}` : o.valueString || null,
            date: o.effectiveDateTime,
          })),
          allergies: allergies.map((a: any) => ({
            substance: a.code?.coding?.[0]?.display || a.code?.text || "Unknown",
            type: a.type,
            criticality: a.criticality,
          })),
        };

        const userMessage = `Generate a prior authorization APPEAL letter:
- Medication/Procedure: ${requested_medication_or_procedure}
- Denial Reason: ${denial_reason}
- Provider: ${requesting_provider || "Not specified"}
- Payer: ${payer_name || "Insurance Company"}
- Original PA Date: ${original_pa_date || "Not specified"}
- Patient data: ${JSON.stringify(patientData, null, 2)}`;

        try {
          const llmResponse = await callLLM(APPEAL_SYSTEM, userMessage);
          const result = safeParseJSON(llmResponse, { error: "Failed to generate appeal", raw: llmResponse });
          return textResponse(JSON.stringify(result, null, 2));
        } catch (err: any) {
          return textResponse(`LLM Error: ${err.message}`);
        }
      }
    );
  }
}

function formatName(names: any[]): string {
  if (!names?.length) return "Unknown";
  const n = names[0];
  return `${n.given?.join(" ") || ""} ${n.family || ""}`.trim();
}

export const generateAppealLetter = new GenerateAppealLetterTool();
