import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { ArchitectureOutput } from "../schema/architecture.schema";

/**
 * Writes three files into the given .devos directory:
 *
 *   architecture.yaml   — YAML representation of ArchitectureOutput
 *   architecture.json   — JSON representation (for downstream consumers)
 *   architecture.mmd    — Mermaid diagram source
 */
export function writeArchitecture(
  devosDir: string,
  arch: ArchitectureOutput,
  mermaidDiagram: string
): void {
  if (!fs.existsSync(devosDir)) {
    fs.mkdirSync(devosDir, { recursive: true });
  }

  // 1. YAML ──────────────────────────────────────────────────────────────────
  const yamlPath = path.join(devosDir, "architecture.yaml");
  fs.writeFileSync(yamlPath, yaml.dump(arch, { lineWidth: 120 }), "utf8");
  console.log(`\n✅ architecture.yaml  → ${yamlPath}`);

  // 2. JSON ──────────────────────────────────────────────────────────────────
  const jsonPath = path.join(devosDir, "architecture.json");
  fs.writeFileSync(jsonPath, JSON.stringify(arch, null, 2), "utf8");
  console.log(`✅ architecture.json  → ${jsonPath}`);

  // 3. Mermaid ───────────────────────────────────────────────────────────────
  const mmdPath = path.join(devosDir, "architecture.mmd");
  fs.writeFileSync(mmdPath, mermaidDiagram, "utf8");
  console.log(`✅ architecture.mmd   → ${mmdPath}`);
}
