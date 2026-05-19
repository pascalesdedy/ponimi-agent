import { MemorySaver } from "@langchain/langgraph";
import path from "path";
import fs from "fs";

/**
 * Checkpointer for LangGraph state persistence.
 *
 * Currently using MemorySaver (in-memory) as a fallback.
 * TODO: Migrate to SqliteSaver when better-sqlite3 supports Node v24,
 * or downgrade to Node v20/v22 LTS.
 */

// Ensure output directories exist
const dataDir = path.resolve(process.cwd(), "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const outputDir = path.resolve(process.cwd(), "output");
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// In-memory checkpointer for now
export const checkpointer = new MemorySaver();
