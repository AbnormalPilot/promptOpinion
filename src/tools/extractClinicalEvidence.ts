import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { IMcpTool, textResponse } from "./types";
import { FhirClient, FhirConfig } from "../fhir/client";
import { callLLM, safeParseJSON } from "../llm/client";

const EXTRACT_EVIDENCE_SYSTEM = `You are a clinical evidence extraction specialist. You read unstructured clinical documents (physician notes, pathology reports, radiology reports, discharge summaries) and extract evidence relevant to a prior authorization request.

Given clinical document text and the medication/procedure being requested, identify:
1. Clinical findings that support medical necessity
2. Severity indicators
3. Treatment history mentioned in the narrative
4. Contraindications or risk factors
5. Physician's clinical impression/recommendation

Return a JSON object with:
- "extracted_evidence": string[] (specific clinical facts found in the documents)
- "severity_indicators": string[] (findings suggesting condition severity)
- "narrative_treatment_history": string[] (treatments mentioned in free text that may not be in structured FHIR data)
- "physician_impressions": string[] (clinical opinions or recommendations found)
- "contraindications_noted": string[] (any contraindications or warnings found)
- "supporting_quotes": string[] (direct quotes from the documents that support the PA request, max 5)
- "document_types_reviewed": string[] (types of documents analyzed)
- "relevance_score": number (0-1, how relevant the documents are to the PA request)

Extract ONLY what is written in the documents. Do not infer or fabricate. If documents contain no relevant information, say so explicitly.`;

class ExtractClinicalEvidenceTool implements IMcpTool {
  registerTool(server: McpServer, fhirConfig?: FhirConfig) {
    server.tool(
      "extract_clinical_evidence",
      "Reads unstructured clinical notes (DiagnosticReports, DocumentReferences) and uses AI to extract evidence supporting a prior authorization request. Call this to strengthen the clinical justification with narrative evidence that structured FHIR data alone cannot provide.",
      {
        patient_id: z.string().optional().describe("FHIR Patient resource ID (auto-resolved from SHARP context if omitted)"),
        requested_medication_or_procedure: z.string().describe("The medication or procedure requiring prior auth"),
        lookback_days: z.number().default(365).describe("How far back to search for clinical documents"),
      },
      async ({ patient_id, requested_medication_or_procedure, lookback_days }) => {
        const pid = patient_id || fhirConfig?.patientId;
        if (!pid) return textResponse("Error: No patient_id provided via argument or SHARP context");
        const fhir = new FhirClient(fhirConfig);

        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - lookback_days);
        const dateParam = `ge${cutoffDate.toISOString().split("T")[0]}`;

        // Fetch DiagnosticReports and DocumentReferences in parallel
        const [diagnosticReports, documentRefs] = await Promise.all([
          fhir.search("DiagnosticReport", { patient: pid, _sort: "-date", _count: "10" }),
          fhir.search("DocumentReference", { patient: pid, _sort: "-date", _count: "10" }),
        ]);

        // Extract text content from DiagnosticReports
        const reportTexts = diagnosticReports.map((r: any) => {
          const conclusion = r.conclusion || "";
          const presentedForm = r.presentedForm?.map((p: any) => {
            if (p.data) return Buffer.from(p.data, "base64").toString("utf-8");
            return "";
          }).join("\n") || "";
          const codeDisplay = r.code?.coding?.[0]?.display || r.code?.text || "Unknown report";
          const narrative = r.text?.div?.replace(/<[^>]*>/g, " ").trim() || "";

          return {
            type: codeDisplay,
            date: r.effectiveDateTime || r.issued || null,
            text: [conclusion, presentedForm, narrative].filter(Boolean).join("\n"),
          };
        }).filter((r: any) => r.text.length > 10);

        // Extract text from DocumentReferences
        const docTexts = documentRefs.map((d: any) => {
          const content = d.content?.[0]?.attachment;
          let text = "";
          if (content?.data) {
            text = Buffer.from(content.data, "base64").toString("utf-8");
          }
          const narrative = d.text?.div?.replace(/<[^>]*>/g, " ").trim() || "";
          return {
            type: d.type?.coding?.[0]?.display || d.description || "Clinical document",
            date: d.date || null,
            text: [text, narrative].filter(Boolean).join("\n"),
          };
        }).filter((d: any) => d.text.length > 10);

        const allDocuments = [...reportTexts, ...docTexts];

        if (allDocuments.length === 0) {
          return textResponse(JSON.stringify({
            message: "No clinical narrative documents found for this patient",
            documents_searched: {
              diagnostic_reports: diagnosticReports.length,
              document_references: documentRefs.length,
            },
            recommendation: "Prior authorization will rely on structured FHIR data only (conditions, medications, observations). Consider requesting the provider attach clinical notes separately.",
          }, null, 2));
        }

        // Build document context for LLM
        const documentContext = allDocuments.map((d, i) =>
          `--- Document ${i + 1}: ${d.type} (${d.date || "undated"}) ---\n${d.text}`
        ).join("\n\n");

        const userMessage = `Extract evidence relevant to a prior authorization request for: ${requested_medication_or_procedure}

Clinical documents for review:
${documentContext}`;

        try {
          const llmResponse = await callLLM(EXTRACT_EVIDENCE_SYSTEM, userMessage);
          const result = safeParseJSON(llmResponse, { error: "Failed to parse extraction", raw: llmResponse });
          return textResponse(JSON.stringify(result, null, 2));
        } catch (err: any) {
          return textResponse(`LLM Error: ${err.message}`);
        }
      }
    );
  }
}

export const extractClinicalEvidence = new ExtractClinicalEvidenceTool();
