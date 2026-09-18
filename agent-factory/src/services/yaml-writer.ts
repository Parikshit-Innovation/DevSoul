/**
 * DevSoul Agent Factory — YAML Writer Service
 * Atomically persists the validated agent configuration to agents.yaml.
 * Uses js-yaml for serialization — never builds YAML by string concatenation.
 * Writes to a temp file first, then renames atomically.
 * Does not overwrite the previous file if writing fails.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import yaml from "js-yaml";
import type { AgentConfig, AgentsYamlDocument } from "../types/agent-config.js";
import type { PlannerInput } from "../types/planner.js";

export class YamlWriterError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "YamlWriterError";
  }
}

export interface YamlWriterOptions {
  /** Absolute path to the output file. */
  outputPath: string;
  /** Provider name used for planning, shown in source metadata. */
  plannerProvider: string;
  /** Model name used for planning, shown in source metadata. */
  plannerModel: string;
}

export class YamlWriterService {
  private readonly outputPath: string;
  private readonly plannerProvider: string;
  private readonly plannerModel: string;

  constructor(options: YamlWriterOptions) {
    this.outputPath = options.outputPath;
    this.plannerProvider = options.plannerProvider;
    this.plannerModel = options.plannerModel;
  }

  /**
   * Serializes the agent configurations to agents.yaml atomically.
   * Throws YamlWriterError if serialization or file I/O fails.
   * The existing file is never touched until the write succeeds.
   */
  async write(
    agents: AgentConfig[],
    input: PlannerInput,
    plannerTask: string
  ): Promise<void> {
    const document: AgentsYamlDocument = {
      version: 1,
      project: {
        id: input.project_id,
        name: input.project_name,
      },
      task: plannerTask,
      source: {
        requirements: "mock requirement intelligence input",
        architecture: "mock architecture intelligence input",
      },
      planning: {
        provider: this.plannerProvider,
        model: this.plannerModel,
        status: "validated",
      },
      agents,
    };

    // Serialize with js-yaml — never concatenate strings
    let yamlContent: string;
    try {
      yamlContent =
        "# DevSoul Agent Factory — agents.yaml\n" +
        `# Generated: ${new Date().toISOString()}\n` +
        "# DO NOT edit manually unless you know what you are doing.\n\n" +
        yaml.dump(document, {
          indent: 2,
          lineWidth: 120,
          noRefs: true,
          sortKeys: false,
        });
    } catch (err) {
      throw new YamlWriterError("Failed to serialize agent configuration to YAML.", err);
    }

    // Ensure output directory exists
    const outputDir = path.dirname(this.outputPath);
    try {
      await fs.mkdir(outputDir, { recursive: true });
    } catch (err) {
      throw new YamlWriterError(`Failed to create output directory "${outputDir}".`, err);
    }

    // Write to a temp file in the same directory, then rename atomically
    const tempPath = path.join(outputDir, `.agents.yaml.tmp.${process.pid}`);
    try {
      await fs.writeFile(tempPath, yamlContent, "utf8");
      await fs.rename(tempPath, this.outputPath);
    } catch (err) {
      // Clean up temp file if it exists
      try {
        await fs.unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }
      throw new YamlWriterError(
        `Failed to write agents.yaml to "${this.outputPath}".`,
        err
      );
    }
  }

  /**
   * Reads and returns the current agents.yaml contents.
   * Returns null if the file does not exist.
   */
  async read(): Promise<string | null> {
    try {
      return await fs.readFile(this.outputPath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw new YamlWriterError(`Failed to read agents.yaml from "${this.outputPath}".`, err);
    }
  }

  get filePath(): string {
    return this.outputPath;
  }
}
