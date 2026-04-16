import axios from "axios";

const CMS_API_BASE = "https://api.coverage.cms.gov/api";

export interface NcdChunk {
  id: string;
  title: string;
  section: string;
  text: string;
  ncdId: string;
}

/** Strip HTML tags and decode common HTML entities */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_match, dec) => String.fromCharCode(Number(dec)))
    .replace(/\s+/g, " ")
    .trim();
}

/** Chunk text into ~300 token segments by paragraph */
function chunkText(text: string, maxChars: number = 1200): string[] {
  if (!text || text.length < 50) return [];
  const paragraphs = text.split(/\n\n+|\. (?=[A-Z])/);
  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    if (current.length + para.length > maxChars && current.length > 100) {
      chunks.push(current.trim());
      current = para;
    } else {
      current += (current ? " " : "") + para;
    }
  }
  if (current.trim().length > 50) chunks.push(current.trim());
  return chunks;
}

/** Load NCDs from CMS Coverage API */
export async function loadCmsNcds(): Promise<NcdChunk[]> {
  console.log("Fetching NCD list from CMS Coverage API...");

  let ncdList: any[] = [];
  try {
    const res = await axios.get(`${CMS_API_BASE}/v1/ncd`, {
      timeout: 30000,
      headers: { Accept: "application/json" },
    });
    ncdList = res.data?.data || [];
    console.log(`Found ${ncdList.length} NCDs`);
  } catch (err: any) {
    console.error("Failed to fetch NCD list:", err.message);
  }

  if (ncdList.length === 0) {
    console.log("Using fallback NCD dataset");
    return getFallbackNcds();
  }

  const allChunks: NcdChunk[] = [];
  const batchSize = 10;
  const maxNcds = Math.min(ncdList.length, 80); // Limit for speed

  for (let i = 0; i < maxNcds; i += batchSize) {
    const batch = ncdList.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map(async (ncd: any) => {
        const docId = ncd.document_id;
        const ver = ncd.document_version || 1;
        const res = await axios.get(
          `${CMS_API_BASE}/v1/ncd/${docId}?version=${ver}`,
          { timeout: 15000, headers: { Accept: "application/json" } }
        );
        const items = res.data?.data;
        if (!items || !Array.isArray(items) || items.length === 0) return null;
        return { ncd, detail: items[0] };
      })
    );

    for (const result of results) {
      if (result.status !== "fulfilled" || !result.value) continue;

      const { ncd, detail } = result.value;
      const displayId = ncd.document_display_id || String(ncd.document_id);
      const title = detail.title || ncd.title || `NCD ${displayId}`;

      // Extract all text fields, strip HTML
      const sections: { label: string; text: string }[] = [];

      if (detail.item_service_description) {
        sections.push({ label: "Description", text: stripHtml(detail.item_service_description) });
      }
      if (detail.indications_limitations) {
        sections.push({ label: "Indications & Limitations", text: stripHtml(detail.indications_limitations) });
      }
      if (detail.reasons_for_denial) {
        sections.push({ label: "Reasons for Denial", text: stripHtml(detail.reasons_for_denial) });
      }
      if (detail.cross_reference) {
        sections.push({ label: "Cross Reference", text: stripHtml(detail.cross_reference) });
      }

      for (const section of sections) {
        const textChunks = chunkText(section.text);
        for (let k = 0; k < textChunks.length; k++) {
          allChunks.push({
            id: `NCD-${displayId}-${section.label}-${k}`,
            title: `${title} (NCD ${displayId})`,
            section: `${section.label} — Part ${k + 1}/${textChunks.length}`,
            text: textChunks[k],
            ncdId: displayId,
          });
        }
      }
    }

    console.log(`Processed ${Math.min(i + batchSize, maxNcds)}/${maxNcds} NCDs → ${allChunks.length} chunks`);
  }

  if (allChunks.length === 0) {
    console.log("No chunks from API — using fallback");
    return getFallbackNcds();
  }

  return allChunks;
}

/** Fallback NCD data for when CMS API is unavailable */
function getFallbackNcds(): NcdChunk[] {
  const fallbackData = [
    {
      ncdId: "210.10", title: "Screening for Type 2 Diabetes Mellitus",
      text: "Medicare covers screening tests for diabetes for beneficiaries at risk. Risk factors include hypertension, dyslipidemia, obesity (BMI >= 30), previous elevated impaired fasting glucose, and impaired glucose tolerance. HbA1c testing is a covered screening test. Screening is covered twice per year for pre-diabetic individuals and once per year for previously tested negatives.",
    },
    {
      ncdId: "210.7", title: "Blood Glucose Testing",
      text: "Medicare covers blood glucose monitors, testing strips, lancets, and glucose control solutions for beneficiaries diagnosed with diabetes. Coverage includes both home glucose monitors and continuous glucose monitoring (CGM) systems when medical necessity criteria are met. Beneficiaries must be insulin-treated or have a documented history of problematic hypoglycemia.",
    },
    {
      ncdId: "220.6", title: "Positron Emission Tomography (PET) Scans",
      text: "Medicare covers FDG PET imaging for initial treatment strategy for solid tumors and myeloma when the physician determines it is needed. CMS requires that the PET scan results will assist in determining the optimal treatment strategy. Coverage includes initial anti-tumor treatment strategy, subsequent anti-tumor treatment strategy, and monitoring response to treatment.",
    },
    {
      ncdId: "180.1", title: "Continuous Positive Airway Pressure (CPAP) Therapy",
      text: "Medicare covers CPAP therapy for obstructive sleep apnea when diagnosed by a sleep study. The apnea-hypopnea index (AHI) must be >= 15 events per hour, or AHI >= 5 and <= 14 with documented symptoms of excessive daytime sleepiness, impaired cognition, mood disorders, or hypertension. Compliance monitoring is required during the first 90 days.",
    },
    {
      ncdId: "220.12", title: "Magnetic Resonance Imaging (MRI)",
      text: "Medicare covers MRI when medically necessary for diagnosis. Covered indications include central nervous system disorders, musculoskeletal conditions, cardiac imaging, breast cancer screening in high-risk patients, and prostate cancer diagnosis. MRI is not covered for screening purposes unless specific criteria are met.",
    },
    {
      ncdId: "250.4", title: "Implantable Automatic Defibrillators",
      text: "Medicare covers implantable cardioverter defibrillators (ICDs) for patients who have documented sustained ventricular tachyarrhythmia, documented familial or inherited conditions with high risk of sudden cardiac death, or documented coronary artery disease with documented prior MI and measured left ventricular ejection fraction <= 35%.",
    },
    {
      ncdId: "160.18", title: "Pharmacogenomic Testing for Warfarin Response",
      text: "Medicare covers pharmacogenomic testing for CYP2C9 and VKORC1 alleles for beneficiaries who are candidates for anticoagulation therapy with warfarin. Testing must be ordered by the treating physician before initiation of warfarin therapy to help determine the optimal initial dose.",
    },
    {
      ncdId: "190.3", title: "Intravenous Immune Globulin (IVIG)",
      text: "Medicare covers IVIG for the treatment of primary immune deficiency disease in the home setting. The patient must have a diagnosis of primary immune deficiency and administration must be medically necessary.",
    },
    {
      ncdId: "110.23", title: "Screening Mammography",
      text: "Medicare covers screening mammography for all female beneficiaries age 40 and older. Annual screening is covered. Diagnostic mammography requires signs, symptoms, or personal history of breast cancer. Digital breast tomosynthesis (3D mammography) is covered as a screening modality.",
    },
    {
      ncdId: "310.1", title: "Routine Costs in Clinical Trials",
      text: "Medicare covers routine costs of qualifying clinical trials and reasonable and necessary items and services to diagnose and treat complications arising from trial participation. Qualifying trials include trials funded by NIH, CDC, AHRQ, CMS, DOD, or VA.",
    },
    {
      ncdId: "240.2", title: "Home Use of Oxygen",
      text: "Medicare covers home oxygen therapy for beneficiaries with significant hypoxemia. Coverage requires documented arterial blood gas (PO2 at or below 55 mmHg) or oxygen saturation at or below 88% while at rest, during sleep, or during exercise. Prior authorization is required for home oxygen equipment. A Certificate of Medical Necessity (CMN) must be completed by the treating physician. Coverage is limited to 36 months for stationary equipment after which ongoing medical necessity must be re-established. Portable oxygen is separately covered when the beneficiary is mobile.",
    },
    {
      ncdId: "110.6", title: "Infusion Pumps and Chemotherapy",
      text: "Medicare covers external infusion pumps for chemotherapy when the drug being administered is itself covered and when use of an infusion pump is medically necessary. Implantable infusion pumps are covered for intraarterial infusion of chemotherapeutic agents for primary hepatocellular carcinoma or colorectal cancer with metastases to the liver. Prior authorization may be required for non-standard chemotherapy regimens. Documentation must include the diagnosis, treatment plan, and evidence that the treatment is reasonable and necessary for the individual patient's condition.",
    },
  ];

  const chunks: NcdChunk[] = [];
  for (const ncd of fallbackData) {
    const textChunks = chunkText(ncd.text);
    for (let i = 0; i < textChunks.length; i++) {
      chunks.push({
        id: `NCD-${ncd.ncdId}-fallback-${i}`,
        title: `${ncd.title} (NCD ${ncd.ncdId})`,
        section: `Section ${i + 1}/${textChunks.length}`,
        text: textChunks[i],
        ncdId: ncd.ncdId,
      });
    }
  }
  console.log(`Loaded ${chunks.length} fallback NCD chunks`);
  return chunks;
}
