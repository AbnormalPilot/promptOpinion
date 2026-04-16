import axios from "axios";

const CMS_API_BASE = "https://api.coverage.cms.gov";

export interface NcdChunk {
  id: string;
  title: string;
  section: string;
  text: string;
  ncdId: string;
}

interface NcdReport {
  ncdId: string;
  title: string;
  ncdVersion: number;
}

/** Fetch NCD list from CMS Coverage API */
async function fetchNcdList(): Promise<NcdReport[]> {
  try {
    const res = await axios.get(`${CMS_API_BASE}/v1/reports/national-coverage-ncd`, {
      timeout: 30000,
      headers: { Accept: "application/json" },
    });
    return res.data?.data || res.data || [];
  } catch (err: any) {
    console.error("Failed to fetch NCD list:", err.message);
    return [];
  }
}

/** Fetch detail for a single NCD */
async function fetchNcdDetail(ncdId: string): Promise<any | null> {
  try {
    const res = await axios.get(`${CMS_API_BASE}/v1/data/ncd/${ncdId}`, {
      timeout: 15000,
      headers: { Accept: "application/json" },
    });
    return res.data;
  } catch (err: any) {
    // Many NCDs may 404 — skip silently
    return null;
  }
}

/** Chunk text into ~300 token segments by paragraph/section */
function chunkText(text: string, maxChars: number = 1200): string[] {
  if (!text || text.length < 50) return [];

  const paragraphs = text.split(/\n\n+/);
  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    if (current.length + para.length > maxChars && current.length > 100) {
      chunks.push(current.trim());
      current = para;
    } else {
      current += (current ? "\n\n" : "") + para;
    }
  }
  if (current.trim().length > 50) chunks.push(current.trim());

  return chunks;
}

/** Load and chunk all NCDs from CMS Coverage API */
export async function loadCmsNcds(): Promise<NcdChunk[]> {
  console.log("Fetching NCD list from CMS Coverage API...");
  const ncdList = await fetchNcdList();
  console.log(`Found ${ncdList.length} NCDs`);

  if (ncdList.length === 0) {
    console.log("CMS API returned empty — using fallback NCD dataset");
    return getFallbackNcds();
  }

  const allChunks: NcdChunk[] = [];
  const batchSize = 10;

  for (let i = 0; i < Math.min(ncdList.length, 100); i += batchSize) {
    const batch = ncdList.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map((ncd) => fetchNcdDetail(ncd.ncdId))
    );

    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      if (result.status !== "fulfilled" || !result.value) continue;

      const detail = result.value;
      const ncd = batch[j];
      const bodyText =
        detail.description || detail.narrative || detail.text || JSON.stringify(detail);

      const textChunks = chunkText(bodyText);
      for (let k = 0; k < textChunks.length; k++) {
        allChunks.push({
          id: `${ncd.ncdId}-${k}`,
          title: ncd.title || detail.title || `NCD ${ncd.ncdId}`,
          section: `Section ${k + 1} of ${textChunks.length}`,
          text: textChunks[k],
          ncdId: ncd.ncdId,
        });
      }
    }

    console.log(`Processed ${Math.min(i + batchSize, ncdList.length)}/${ncdList.length} NCDs (${allChunks.length} chunks)`);
  }

  if (allChunks.length === 0) {
    console.log("No chunks extracted from CMS API — using fallback");
    return getFallbackNcds();
  }

  return allChunks;
}

/** Fallback NCD data for when CMS API is unavailable */
function getFallbackNcds(): NcdChunk[] {
  // Key NCDs relevant to common PA scenarios
  const fallbackData = [
    {
      ncdId: "210.10",
      title: "Screening for Type 2 Diabetes Mellitus",
      text: "Medicare covers screening tests for diabetes for beneficiaries at risk. Risk factors include hypertension, dyslipidemia, obesity (BMI ≥30 kg/m²), previous identification of elevated impaired fasting glucose, and impaired glucose tolerance. HbA1c testing is a covered screening test. Screening is covered twice per year for pre-diabetic individuals and once per year for previously tested negatives.",
    },
    {
      ncdId: "210.7",
      title: "Blood Glucose Testing",
      text: "Medicare covers blood glucose monitors, testing strips, lancets, and glucose control solutions for beneficiaries diagnosed with diabetes. Coverage includes both home glucose monitors and continuous glucose monitoring (CGM) systems when medical necessity criteria are met. Beneficiaries must be insulin-treated or have a documented history of problematic hypoglycemia.",
    },
    {
      ncdId: "110.23",
      title: "Screening Mammography",
      text: "Medicare covers screening mammography for all female beneficiaries age 40 and older. Annual screening is covered. Diagnostic mammography requires signs, symptoms, or personal history of breast cancer. Digital breast tomosynthesis (3D mammography) is covered as a screening modality.",
    },
    {
      ncdId: "220.6",
      title: "Positron Emission Tomography (PET) Scans",
      text: "Medicare covers FDG PET imaging for initial treatment strategy for solid tumors and myeloma when the physician determines it is needed. CMS requires that the PET scan results will assist in determining the optimal treatment strategy. Coverage includes initial anti-tumor treatment strategy, subsequent anti-tumor treatment strategy, and monitoring response to treatment.",
    },
    {
      ncdId: "250.4",
      title: "Implantable Automatic Defibrillators",
      text: "Medicare covers implantable cardioverter defibrillators (ICDs) for patients who have documented sustained ventricular tachyarrhythmia, documented familial or inherited conditions with high risk of sudden cardiac death, or documented coronary artery disease with documented prior MI and measured left ventricular ejection fraction ≤35%. Patient must not have conditions that would make ICD implantation unreasonable.",
    },
    {
      ncdId: "180.1",
      title: "Continuous Positive Airway Pressure (CPAP) Therapy",
      text: "Medicare covers CPAP therapy for obstructive sleep apnea when diagnosed by a sleep study. The apnea-hypopnea index (AHI) must be ≥15 events per hour, or AHI ≥5 and ≤14 with documented symptoms of excessive daytime sleepiness, impaired cognition, mood disorders, or hypertension. Compliance monitoring is required during the first 90 days.",
    },
    {
      ncdId: "310.1",
      title: "Routine Costs in Clinical Trials",
      text: "Medicare covers routine costs of qualifying clinical trials and reasonable and necessary items and services to diagnose and treat complications arising from trial participation. Qualifying trials include trials funded by NIH, CDC, AHRQ, CMS, DOD, or VA, and trials conducted under an investigational new drug application (IND) reviewed by the FDA.",
    },
    {
      ncdId: "190.3",
      title: "Intravenous Immune Globulin (IVIG)",
      text: "Medicare covers IVIG for the treatment of primary immune deficiency disease in the home setting. The patient must have a diagnosis of primary immune deficiency and administration must be medically necessary. Coverage includes the IVIG itself and items and services needed to administer it in the home.",
    },
    {
      ncdId: "260.1",
      title: "Adult Liver Transplantation",
      text: "Medicare covers liver transplantation for patients with end-stage liver disease when performed in a Medicare-approved transplant center. Covered indications include biliary atresia, primary biliary cholangitis, primary sclerosing cholangitis, alcoholic cirrhosis (with documented abstinence), and hepatocellular carcinoma meeting Milan criteria. Contraindications include active substance abuse and uncontrolled infection.",
    },
    {
      ncdId: "160.18",
      title: "Pharmacogenomic Testing for Warfarin Response",
      text: "Medicare covers pharmacogenomic testing for CYP2C9 and VKORC1 alleles for beneficiaries who are candidates for anticoagulation therapy with warfarin. Testing must be ordered by the treating physician before initiation of warfarin therapy to help determine the optimal initial dose. Results must be used in the clinical management of the patient.",
    },
    {
      ncdId: "150.2",
      title: "Osteogenesis Stimulators",
      text: "Medicare covers non-invasive osteogenesis stimulators for nonunion fractures. The fracture must show no clinically significant evidence of fracture healing for 3 or more months. Invasive osteogenesis stimulators are covered for nonunion of long bone fractures as an adjunct to surgery. Coverage requires documented failed prior conservative treatment.",
    },
    {
      ncdId: "220.12",
      title: "Magnetic Resonance Imaging (MRI)",
      text: "Medicare covers MRI when medically necessary for diagnosis. Covered indications include but are not limited to: central nervous system disorders, musculoskeletal conditions, cardiac imaging, breast cancer screening in high-risk patients, and prostate cancer diagnosis. MRI is not covered for screening purposes unless specific criteria are met (e.g., breast MRI for BRCA carriers).",
    },
  ];

  const chunks: NcdChunk[] = [];
  for (const ncd of fallbackData) {
    const textChunks = chunkText(ncd.text);
    for (let i = 0; i < textChunks.length; i++) {
      chunks.push({
        id: `${ncd.ncdId}-${i}`,
        title: ncd.title,
        section: `Section ${i + 1} of ${textChunks.length}`,
        text: textChunks[i],
        ncdId: ncd.ncdId,
      });
    }
  }

  console.log(`Loaded ${chunks.length} fallback NCD chunks`);
  return chunks;
}
