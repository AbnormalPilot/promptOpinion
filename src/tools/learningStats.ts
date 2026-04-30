import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { IMcpTool, textResponse } from "./types";
import { FhirConfig } from "../fhir/client";
import { memorySize } from "../memory/store";
import { brierScore, reliabilityDiagram } from "../learning/calibration";
import { topPatterns } from "../learning/patterns";

class LearningStatsTool implements IMcpTool {
  registerTool(server: McpServer, _fhirConfig?: FhirConfig) {
    server.tool(
      "learning_stats",
      "Returns the system's self-learning posture: memory size, Brier-score calibration, reliability diagram, and top weakness patterns harvested from adversarial reviews. Useful for trust + auditability — judges and clinicians can see the system's track record.\n\noutputSchema (JSON): { memory_size: number, calibration_brier: number|null, reliability_diagram: Array<{bin: string, predicted_avg: number, actual_rate: number, n: number}>, top_weakness_patterns: Array<{category: string, count: number, examples?: string[]}>, interpretation: string }\n\n[fhir_context_required: false]",
      {},
      async () => {
        const stats = {
          memory_size: memorySize(),
          calibration_brier: brierScore(),
          reliability_diagram: reliabilityDiagram(),
          top_weakness_patterns: topPatterns(8),
          interpretation: brierScore() == null
            ? "No calibration data yet. Run record_pa_outcome on submitted cases to bootstrap."
            : (brierScore()! < 0.15 ? "Well-calibrated."
              : brierScore()! < 0.25 ? "Moderately calibrated."
              : "Calibration weak — predictions diverge from actuals; temperature scaling will pull future predictions toward the base rate."),
        };
        return textResponse(JSON.stringify(stats, null, 2));
      }
    );
  }
}

export const learningStats = new LearningStatsTool();
