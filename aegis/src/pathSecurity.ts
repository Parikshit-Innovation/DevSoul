import * as path from "node:path";
import * as fs from "node:fs";

export interface PathSecurityResult {
  raw: string;
  normalized: string;
  absolute: string;
  relativePath: string;
  isEscaped: boolean;
  hasNullByte: boolean;
  reason?: string;
}

export class PathSecurity {
  private workspaceRoot: string;

  constructor(workspaceRoot: string = process.cwd()) {
    this.workspaceRoot = path.resolve(workspaceRoot);
  }

  public setWorkspaceRoot(root: string): void {
    this.workspaceRoot = path.resolve(root);
  }

  public getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }

  /**
   * Canonicalizes and validates resource path against workspace root
   */
  public validatePath(rawInput: string): PathSecurityResult {
    if (!rawInput || typeof rawInput !== "string") {
      return {
        raw: String(rawInput),
        normalized: "",
        absolute: "",
        relativePath: "",
        isEscaped: true,
        hasNullByte: false,
        reason: "Invalid or empty path string",
      };
    }

    // 1. Check for null bytes
    if (rawInput.includes("\0") || rawInput.includes("%00")) {
      return {
        raw: rawInput,
        normalized: "",
        absolute: "",
        relativePath: "",
        isEscaped: true,
        hasNullByte: true,
        reason: "Path contains dangerous null byte",
      };
    }

    // 2. Decode URL encodings like %2e%2e, %2f, %5c
    let decoded = rawInput;
    try {
      decoded = decodeURIComponent(rawInput);
    } catch {
      // If malformed URI, treat as suspicious
      decoded = rawInput.replace(/%2e/gi, ".").replace(/%2f/gi, "/").replace(/%5c/gi, "\\");
    }

    // 3. Normalize slashes
    let normalized = decoded.replace(/\\/g, "/").trim();

    // 4. Resolve absolute path relative to workspaceRoot
    let resolvedAbsolute: string;
    if (path.isAbsolute(normalized)) {
      resolvedAbsolute = path.normalize(normalized);
    } else {
      resolvedAbsolute = path.resolve(this.workspaceRoot, normalized);
    }

    // 5. Check realpath for symlinks if file exists
    try {
      if (fs.existsSync(resolvedAbsolute)) {
        resolvedAbsolute = fs.realpathSync(resolvedAbsolute);
      }
    } catch {
      // Ignore if cannot realpath non-existent file
    }

    // 6. Check for path escape outside workspaceRoot
    const rootNormalized = path.normalize(this.workspaceRoot).toLowerCase();
    const targetNormalized = path.normalize(resolvedAbsolute).toLowerCase();

    const isInsideRoot =
      targetNormalized === rootNormalized ||
      targetNormalized.startsWith(rootNormalized + path.sep);

    // Also check for UNC paths or drive traversal attempts on Windows
    const isUNC = normalized.startsWith("//") || normalized.startsWith("\\\\");

    const isEscaped = !isInsideRoot || isUNC;

    let relativePath = "";
    if (!isEscaped) {
      relativePath = path.relative(this.workspaceRoot, resolvedAbsolute).replace(/\\/g, "/");
    } else {
      relativePath = normalized;
    }

    return {
      raw: rawInput,
      normalized,
      absolute: resolvedAbsolute,
      relativePath: relativePath || ".",
      isEscaped,
      hasNullByte: false,
      reason: isEscaped ? `Path '${rawInput}' escapes workspace root '${this.workspaceRoot}'` : undefined,
    };
  }
}

export const pathSecurity = new PathSecurity();
