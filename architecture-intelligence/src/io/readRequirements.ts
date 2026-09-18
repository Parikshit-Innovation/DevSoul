import fs from "fs";
import path from "path";
import yaml from "js-yaml";

/**
 * Reads requirements.yaml from the given .devos directory.
 * Expected shape (same as project-brain):
 *   project: <name>
 *   requirements:
 *     - id: REQ-001
 *       text: ...
 *       category: ...
 *       status: proposed
 */
export function readRequirements(devosDir: string): any {
  const reqPath = path.join(devosDir, "requirements.yaml");

  if (!fs.existsSync(reqPath)) {
    throw new Error(
      `requirements.yaml not found at ${reqPath}.\n` +
        `Make sure your teammate has pushed it to the .devos folder.`
    );
  }

  const raw = fs.readFileSync(reqPath, "utf8");
  const parsed = yaml.load(raw);

  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("requirements" in (parsed as object))
  ) {
    throw new Error(
      `requirements.yaml at ${reqPath} is malformed. ` +
        `Expected top-level keys: project, requirements[]`
    );
  }

  return parsed;
}
