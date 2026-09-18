import { ArchitectureOutput } from "../schema/architecture.schema";

/**
 * Generates a Mermaid flowchart from the ArchitectureOutput's technology_stack.
 *
 * The diagram chains components top-to-bottom:
 *   Frontend → Backend → Database
 */
export function generateDiagram(arch: ArchitectureOutput): string {
  const { frontend, backend, database } = arch.technology_stack;

  const nodeId = (name: string) =>
    name.toLowerCase().replace(/[^a-z0-9]/g, "_");

  const lines: string[] = ["graph TD"];

  // Frontend → Backend
  lines.push(
    `  ${nodeId(frontend)}["Frontend\\n${frontend}"] --> ${nodeId(backend)}["Backend\\n${backend}"]`
  );

  // Backend → Database
  lines.push(
    `  ${nodeId(backend)}["Backend\\n${backend}"] --> ${nodeId(database)}["Database\\n${database}"]`
  );

  return lines.join("\n");
}
