import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { IMcpTool, textResponse } from "./types";
import { FhirClient, FhirConfig } from "../fhir/client";
import Tesseract from "tesseract.js";

class ProcessClinicalDocumentTool implements IMcpTool {
  registerTool(server: McpServer, fhirConfig?: FhirConfig) {
    server.tool(
      "process_clinical_document",
      "Reads clinical documents from FHIR (DiagnosticReports, scanned faxes, referral letters) and extracts text using OCR when needed. Essential for capturing evidence from unstructured clinical documents that structured FHIR data alone cannot provide.",
      {
        document_id: z.string().optional().describe("FHIR DocumentReference resource ID"),
        patient_id: z.string().optional().describe("FHIR Patient ID (used to search for recent documents when document_id is not provided)"),
      },
      async ({ document_id, patient_id }) => {
        const pid = patient_id || fhirConfig?.patientId;

        if (!document_id && !pid) {
          return textResponse("Error: Provide either document_id or patient_id (or configure SHARP patient context)");
        }

        const fhir = new FhirClient(fhirConfig);

        // Resolve the list of DocumentReference resources to process
        let documents: any[] = [];

        if (document_id) {
          const doc = await fhir.read<any>(`DocumentReference/${document_id}`);
          if (!doc) return textResponse(`DocumentReference/${document_id} not found`);
          documents = [doc];
        } else {
          // patient_id only path — fetch latest 5 documents
          documents = await fhir.search<any>("DocumentReference", {
            patient: pid!,
            _count: "5",
            _sort: "-date",
          });
          if (documents.length === 0) {
            return textResponse(JSON.stringify({
              documents_processed: 0,
              results: [],
              message: `No DocumentReference resources found for patient ${pid}`,
            }, null, 2));
          }
        }

        const results: Array<{
          id: string;
          type: string;
          date: string | null;
          contentType: string;
          extractedText: string;
          method: "direct" | "ocr" | "narrative";
        }> = [];

        for (const doc of documents) {
          const docId: string = doc.id || "unknown";
          const docType: string =
            doc.type?.coding?.[0]?.display ||
            doc.type?.text ||
            doc.description ||
            "Clinical Document";
          const docDate: string | null = doc.date || null;

          // Always try to pull narrative from text.div as a fallback
          const narrativeText: string =
            doc.text?.div?.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() || "";

          const attachment = doc.content?.[0]?.attachment;

          if (!attachment) {
            // No attachment — use narrative if available
            if (narrativeText) {
              results.push({
                id: docId,
                type: docType,
                date: docDate,
                contentType: "text/html",
                extractedText: narrativeText,
                method: "narrative",
              });
            } else {
              results.push({
                id: docId,
                type: docType,
                date: docDate,
                contentType: "unknown",
                extractedText: "No content or narrative found in this DocumentReference",
                method: "narrative",
              });
            }
            continue;
          }

          const contentType: string = attachment.contentType || "application/octet-stream";

          // Resolve raw bytes from inline base64 data or external URL
          let rawBuffer: Buffer | null = null;

          if (attachment.data) {
            // Inline base64-encoded content
            rawBuffer = Buffer.from(attachment.data, "base64");
          } else if (attachment.url) {
            // External binary — fetch it
            try {
              const fetchHeaders: Record<string, string> = { Accept: "*/*" };
              if (fhirConfig?.token) {
                fetchHeaders["Authorization"] = `Bearer ${fhirConfig.token}`;
              }
              const response = await fetch(attachment.url, { headers: fetchHeaders });
              if (!response.ok) {
                throw new Error(`HTTP ${response.status} fetching ${attachment.url}`);
              }
              rawBuffer = Buffer.from(await response.arrayBuffer());
            } catch (fetchErr: any) {
              const fallback = narrativeText || "Failed to fetch binary content";
              results.push({
                id: docId,
                type: docType,
                date: docDate,
                contentType,
                extractedText: `Fetch error: ${fetchErr.message}. ${fallback}`,
                method: "narrative",
              });
              continue;
            }
          }

          if (!rawBuffer) {
            // No binary resolved — fall back to narrative
            results.push({
              id: docId,
              type: docType,
              date: docDate,
              contentType,
              extractedText: narrativeText || "No content data or URL found in attachment",
              method: "narrative",
            });
            continue;
          }

          // Extract text based on content type
          const mimeBase = contentType.split(";")[0].trim().toLowerCase();

          if (mimeBase.startsWith("text/")) {
            // Plain text — decode directly
            const text = rawBuffer.toString("utf-8");
            results.push({
              id: docId,
              type: docType,
              date: docDate,
              contentType,
              extractedText: text || narrativeText || "(empty text document)",
              method: "direct",
            });
          } else if (mimeBase.startsWith("image/")) {
            // Scanned image — run OCR via tesseract.js
            try {
              const { data: { text } } = await Tesseract.recognize(rawBuffer, "eng");
              const ocrText = text.trim();
              results.push({
                id: docId,
                type: docType,
                date: docDate,
                contentType,
                extractedText: ocrText || narrativeText || "(OCR produced no text)",
                method: "ocr",
              });
            } catch (ocrErr: any) {
              results.push({
                id: docId,
                type: docType,
                date: docDate,
                contentType,
                extractedText: `OCR failed: ${ocrErr.message}. Narrative: ${narrativeText}`,
                method: "narrative",
              });
            }
          } else if (mimeBase === "application/pdf") {
            // PDF — attempt UTF-8 decode of raw bytes (covers text-layer PDFs stored as base64)
            // Full PDF parsing would require a dedicated library (e.g., pdf-parse)
            const rawText = rawBuffer.toString("utf-8");
            // Extract any readable ASCII/UTF-8 runs that look like prose
            const extracted = rawText
              .replace(/[^\x20-\x7E\n\r\t]/g, " ")
              .replace(/\s{3,}/g, "\n")
              .trim();
            const usable = extracted.length > 50 ? extracted : "";
            results.push({
              id: docId,
              type: docType,
              date: docDate,
              contentType,
              extractedText: usable || narrativeText ||
                "PDF content detected — full PDF parsing requires a dedicated library (e.g., pdf-parse). Narrative fallback not available.",
              method: usable ? "direct" : "narrative",
            });
          } else {
            // Unsupported content type
            results.push({
              id: docId,
              type: docType,
              date: docDate,
              contentType,
              extractedText: narrativeText ||
                `Unsupported content type: ${contentType}. Cannot extract text without a dedicated parser.`,
              method: "narrative",
            });
          }
        }

        return textResponse(JSON.stringify({
          documents_processed: results.length,
          results,
        }, null, 2));
      }
    );
  }
}

export const processClinicalDocument = new ProcessClinicalDocumentTool();
