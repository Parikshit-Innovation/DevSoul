import type {
  Action,
  Agent,
  BehaviorAnomaly,
  ResourceClassification,
  RiskAssessment,
  RiskFactor,
  RiskLevel,
  Target,
} from "./models.ts";

export class RiskEngine {
  public assessRisk(
    agent: Agent,
    action: Action,
    target: Target,
    classification: ResourceClassification,
    currentTrust: number,
    anomalies: BehaviorAnomaly[]
  ): RiskAssessment {
    const factors: RiskFactor[] = [];
    let totalScore = 0;

    // 1. Resource Sensitivity Factor
    if (classification === "CRITICAL") {
      factors.push({
        category: "RESOURCE",
        description: `Target resource '${target.resource}' is classified as CRITICAL (credentials/keys)`,
        weight: 45,
      });
      totalScore += 45;
    } else if (classification === "SENSITIVE") {
      factors.push({
        category: "RESOURCE",
        description: `Target resource '${target.resource}' is classified as SENSITIVE (.env/secrets)`,
        weight: 35,
      });
      totalScore += 35;
    } else if (target.resource.startsWith("http://") || target.resource.startsWith("https://")) {
      factors.push({
        category: "RESOURCE",
        description: `External network destination: '${target.resource}'`,
        weight: 20,
      });
      totalScore += 20;
    } else if (classification === "INTERNAL") {
      factors.push({
        category: "RESOURCE",
        description: `Target resource '${target.resource}' is INTERNAL project code/configuration`,
        weight: 10,
      });
      totalScore += 10;
    } else {
      factors.push({
        category: "RESOURCE",
        description: `Target resource '${target.resource}' is PUBLIC documentation or asset`,
        weight: 0,
      });
    }

    // 2. Action Impact Factor
    const actionType = (action.type || "read").toLowerCase();
    if (
      actionType.includes("delete") ||
      actionType.includes("drop") ||
      actionType.includes("schema") ||
      actionType.includes("migrate") ||
      actionType === "git_push" ||
      actionType === "install_package" ||
      actionType === "remove_package"
    ) {
      factors.push({
        category: "ACTION",
        description: `Action '${action.type}' has HIGH/MUTATING system impact`,
        weight: 40,
      });
      totalScore += 40;
    } else if (
      actionType === "network_call" ||
      actionType === "send" ||
      actionType === "export"
    ) {
      factors.push({
        category: "ACTION",
        description: `Action '${action.type}' interacts with external network/data transmission`,
        weight: 15,
      });
      totalScore += 15;
    } else if (actionType.includes("write") || actionType.includes("modify")) {
      factors.push({
        category: "ACTION",
        description: `Action '${action.type}' modifies project state`,
        weight: 15,
      });
      totalScore += 15;
    }

    // 3. Trust Score Factor
    if (currentTrust <= 30) {
      factors.push({
        category: "TRUST",
        description: `Agent reputation is CRITICALLY DEGRADED (Trust: ${currentTrust})`,
        weight: 30,
      });
      totalScore += 30;
    } else if (currentTrust <= 60) {
      factors.push({
        category: "TRUST",
        description: `Agent reputation is DEGRADED from prior infractions (Trust: ${currentTrust})`,
        weight: 15,
      });
      totalScore += 15;
    }

    // 4. Behavioral Anomalies Factor
    for (const anomaly of anomalies) {
      const weight =
        anomaly.type === "EXFILTRATION_PATTERN"
          ? 60
          : anomaly.severity === "critical"
          ? 35
          : 25;

      factors.push({
        category: "BEHAVIOR",
        description: `[${anomaly.type}] ${anomaly.description}`,
        weight,
      });
      totalScore += weight;
    }

    // 5. Intent Context Factor
    if (action.intent && /bypass|force|production|secret|override/i.test(action.intent)) {
      factors.push({
        category: "IDENTITY",
        description: `Suspicious action intent declared: '${action.intent}'`,
        weight: 20,
      });
      totalScore += 20;
    }

    const clampedScore = Math.min(100, totalScore);

    // Determine Risk Level
    let level: RiskLevel = "LOW";
    if (clampedScore >= 75) {
      level = "CRITICAL";
    } else if (clampedScore >= 50) {
      level = "HIGH";
    } else if (clampedScore >= 25) {
      level = "MEDIUM";
    } else {
      level = "LOW";
    }

    return {
      score: clampedScore,
      level,
      factors,
    };
  }
}

export const riskEngine = new RiskEngine();
