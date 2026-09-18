export class ScopeManager {
  /**
   * Matches a file path against a list of glob patterns (e.g. "src/frontend/**", "*.ts", "**")
   */
  public isPathInScope(filePath: string, allowedPatterns: string[]): boolean {
    if (!allowedPatterns || allowedPatterns.length === 0) {
      return false;
    }

    if (allowedPatterns.includes("**") || allowedPatterns.includes("*")) {
      return true;
    }

    const normalizedPath = filePath.replace(/\\/g, "/").replace(/^\.\//, "");

    for (const pattern of allowedPatterns) {
      if (this.matchGlob(normalizedPath, pattern)) {
        return true;
      }
    }

    return false;
  }

  private matchGlob(target: string, pattern: string): boolean {
    const normPattern = pattern.replace(/\\/g, "/").replace(/^\.\//, "");

    if (normPattern === target) return true;
    if (normPattern === "**") return true;

    // Convert simple glob pattern to RegExp
    let regexStr = normPattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*/g, ".*")
      .replace(/(?<!\.)\*/g, "[^/]*");

    const regex = new RegExp(`^${regexStr}$`, "i");
    return regex.test(target);
  }

  /**
   * Validates role against forbidden architecture boundaries (e.g. frontend modifying database)
   */
  public checkRoleBoundary(
    role: string,
    actionType: string,
    targetResource: string
  ): { isForbidden: boolean; reason?: string } {
    const normRole = (role || "").toLowerCase();
    const normTarget = targetResource.replace(/\\/g, "/").toLowerCase();
    const normAction = actionType.toLowerCase();

    if (normRole === "frontend") {
      const isDbResource =
        normTarget.startsWith("database/") ||
        normTarget.startsWith("migrations/") ||
        normTarget.includes("schema.sql") ||
        normTarget.includes("schema.prisma");

      const isDbAction =
        normAction === "modify_schema" ||
        normAction === "modify_database" ||
        normAction === "drop_table" ||
        normAction === "migrate";

      if (isDbResource || isDbAction) {
        return {
          isForbidden: true,
          reason: `Role '${role}' is forbidden from modifying database/schema tier (${targetResource})`,
        };
      }
    }

    if (normRole === "reviewer" || normRole === "tester") {
      if (normAction === "delete" || normAction === "modify_schema" || normAction === "git_push") {
        return {
          isForbidden: true,
          reason: `Read-only role '${role}' is forbidden from executing mutating action '${actionType}'`,
        };
      }
    }

    return { isForbidden: false };
  }
}

export const scopeManager = new ScopeManager();
