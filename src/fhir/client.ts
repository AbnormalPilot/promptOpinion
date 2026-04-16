import axios, { AxiosInstance } from "axios";

const DEFAULT_FHIR_URL = process.env.FHIR_BASE_URL || "https://hapi.fhir.org/baseR4";

export interface FhirConfig {
  url?: string;
  token?: string;
}

/** Simple FHIR R4 HTTP client */
export class FhirClient {
  private client: AxiosInstance;

  constructor(config?: FhirConfig) {
    const baseURL = config?.url || DEFAULT_FHIR_URL;
    const headers: Record<string, string> = {
      Accept: "application/fhir+json",
    };
    if (config?.token) {
      headers["Authorization"] = `Bearer ${config.token}`;
    }

    this.client = axios.create({ baseURL, headers, timeout: 15000 });
  }

  /** GET a single resource by path, e.g. "Patient/123" */
  async read<T = any>(path: string): Promise<T | null> {
    try {
      const res = await this.client.get<T>(path);
      return res.data;
    } catch (err: any) {
      if (err.response?.status === 404) return null;
      throw err;
    }
  }

  /** GET a search Bundle, e.g. "Condition" with params {patient: "123"} */
  async search<T = any>(resourceType: string, params: Record<string, string>): Promise<T[]> {
    try {
      const res = await this.client.get(resourceType, { params });
      const bundle = res.data;
      if (!bundle?.entry) return [];
      return bundle.entry.map((e: any) => e.resource);
    } catch (err: any) {
      if (err.response?.status === 404) return [];
      throw err;
    }
  }
}
