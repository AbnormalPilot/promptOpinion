import Groq from "groq-sdk";

const ANALYZE_SYSTEM = `You are a clinical documentation specialist with expertise in prior authorization requirements for US health insurers.

Given patient FHIR data (conditions, medications, recent encounters), analyze what clinical justification is needed for the requested medication or procedure.

Return a JSON object with:
- "clinical_rationale": string (1-2 sentence clinical justification)
- "primary_diagnosis_code": string (ICD-10)
- "primary_diagnosis_display": string (human-readable name)
- "supporting_diagnosis_codes": string[]
- "evidence_points": string[] (specific clinical facts supporting medical necessity)
- "prior_treatments_tried": string[]
- "confidence": number (0-1)
- "missing_information": string[]

Base your analysis ONLY on the provided patient data. Do not fabricate clinical details.`;

const DRAFT_SYSTEM = `You are a clinical documentation specialist writing prior authorization letters to health insurance companies.

Return a JSON object with:
- "letter": string (the complete formatted letter text)
- "summary": string (1-2 sentence summary)
- "icd10_codes": string[]
- "cpt_codes": string[]
- "confidence": number (0-1)

The letter must include:
1. Header: "DRAFT — FOR PHYSICIAN REVIEW BEFORE SUBMISSION"
2. Patient identification (name, DOB)
3. Requesting provider information
4. Requested medication/procedure
5. Primary and supporting ICD-10 diagnosis codes
6. Clinical necessity statement (2-3 paragraphs)
7. Documentation of prior treatments tried
8. Supporting clinical evidence

Tone: Professional, clinical, factual.`;

async function callGroq(system: string, user: string): Promise<any> {
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const response = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      {
        role: "system",
        content:
          system +
          "\n\nIMPORTANT: Respond with valid JSON only. No markdown, no code fences.",
      },
      { role: "user", content: user },
    ],
    temperature: 0.2,
    max_tokens: 4096,
    response_format: { type: "json_object" },
  });
  const text = response.choices[0]?.message?.content || "{}";
  return JSON.parse(text);
}

export async function POST(request: Request) {
  const body = await request.json();
  const {
    patientData,
    medication,
    provider,
    payer,
    action,
  }: {
    patientData: any;
    medication: string;
    provider?: string;
    payer?: string;
    action: "analyze" | "draft";
  } = body;

  if (!patientData || !medication) {
    return Response.json(
      { error: "Missing patientData or medication" },
      { status: 400 }
    );
  }

  if (!process.env.GROQ_API_KEY) {
    return Response.json(
      { error: "GROQ_API_KEY not configured" },
      { status: 500 }
    );
  }

  try {
    if (action === "analyze") {
      const result = await callGroq(
        ANALYZE_SYSTEM,
        `Analyze prior authorization need for:\n- Requested: ${medication}\n- Provider: ${provider || "Not specified"}\n- Patient data: ${JSON.stringify(patientData, null, 2)}`
      );
      return Response.json(result);
    }

    if (action === "draft") {
      // Step 1: Analyze
      const analysis = await callGroq(
        ANALYZE_SYSTEM,
        `Analyze prior authorization need for:\n- Requested: ${medication}\n- Provider: ${provider || "Not specified"}\n- Patient data: ${JSON.stringify(patientData, null, 2)}`
      );

      // Step 2: Draft letter
      const draft = await callGroq(
        DRAFT_SYSTEM,
        `Draft a prior authorization request letter:\n- Requested: ${medication}\n- Provider: ${provider || "Not specified"}\n- Payer: ${payer || "Insurance Company"}\n- Patient data: ${JSON.stringify(patientData, null, 2)}\n- Clinical analysis: ${JSON.stringify(analysis, null, 2)}`
      );

      return Response.json({ analysis, draft });
    }

    return Response.json({ error: "Invalid action" }, { status: 400 });
  } catch (err: any) {
    return Response.json(
      { error: err.message || "LLM call failed" },
      { status: 500 }
    );
  }
}
