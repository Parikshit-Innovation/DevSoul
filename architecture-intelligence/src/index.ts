export { buildArchitecture } from "./generator/architectureGenerator";
export { generateDiagram } from "./generator/diagramGenerator";
export { readRequirements } from "./io/readRequirements";
export { writeArchitecture } from "./io/writeArchitecture";
export { runInterview } from "./interview/interviewLoop";
export { getActiveProvider } from "./llm/llmRouter";
export { generateArchitectureNarrative } from "./llm/architectureSummaryHelper";
export type {
  ArchitectureOutput,
  TechnologyStack,
  ComponentOutput,
} from "./schema/architecture.schema";
export { ArchitectureOutputSchema } from "./schema/architecture.schema";
