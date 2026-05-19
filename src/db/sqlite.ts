import {
  BaseCheckpointSaver,
  Checkpoint,
  CheckpointMetadata,
  CheckpointTuple,
  CheckpointListOptions,
  PendingWrite,
  ChannelVersions,
} from "@langchain/langgraph-checkpoint";
import { RunnableConfig } from "@langchain/core/runnables";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

/**
 * SQLite-backed checkpointer for LangGraph state persistence.
 *
 * Stores checkpoints as JSON blobs in a local SQLite database.
 * Survives process restarts — enables true resume across sessions.
 */
export class SqliteCheckpointer extends BaseCheckpointSaver {
  private db: Database.Database;
  private dbPath: string;

  constructor(dbPath?: string) {
    super();
    this.dbPath = dbPath || path.resolve(process.cwd(), "data", "checkpoints.db");
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(this.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS checkpoints (
        thread_id TEXT NOT NULL,
        checkpoint_ns TEXT NOT NULL DEFAULT '',
        checkpoint_id TEXT NOT NULL,
        parent_checkpoint_id TEXT,
        checkpoint BLOB NOT NULL,
        metadata BLOB NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS checkpoint_writes (
        thread_id TEXT NOT NULL,
        checkpoint_ns TEXT NOT NULL DEFAULT '',
        checkpoint_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        idx INTEGER NOT NULL,
        channel TEXT NOT NULL,
        write_type TEXT NOT NULL DEFAULT '',
        value BLOB,
        PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
      )
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_checkpoints_thread
      ON checkpoints(thread_id, checkpoint_ns, checkpoint_id DESC)
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_writes_checkpoint
      ON checkpoint_writes(thread_id, checkpoint_ns, checkpoint_id)
    `);
  }

  /** Serialize to Buffer */
  private toBuf(data: unknown): Buffer {
    return Buffer.from(JSON.stringify(data), "utf-8");
  }

  /** Deserialize Buffer */
  private fromBuf<T>(buf: Buffer | null): T | null {
    if (!buf) return null;
    return JSON.parse(buf.toString("utf-8")) as T;
  }

  /**
   * Get a specific checkpoint by config.
   */
  async get(config: RunnableConfig): Promise<Checkpoint | undefined> {
    const { thread_id, checkpoint_ns = "", checkpoint_id } = config.configurable ?? {};

    if (!thread_id) return undefined;

    if (!checkpoint_id) {
      // Latest checkpoint for this thread
      const row = this.db
        .prepare(
          "SELECT checkpoint FROM checkpoints WHERE thread_id = ? AND checkpoint_ns = ? ORDER BY rowid DESC LIMIT 1"
        )
        .get(thread_id, checkpoint_ns) as { checkpoint: Buffer } | undefined;

      return row ? this.fromBuf<Checkpoint>(row.checkpoint) ?? undefined : undefined;
    }

    const row = this.db
      .prepare(
        "SELECT checkpoint FROM checkpoints WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?"
      )
      .get(thread_id, checkpoint_ns, checkpoint_id) as { checkpoint: Buffer } | undefined;

    return row ? this.fromBuf<Checkpoint>(row.checkpoint) ?? undefined : undefined;
  }

  /**
   * Get a full checkpoint tuple.
   */
  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const { thread_id, checkpoint_ns = "", checkpoint_id } = config.configurable ?? {};
    if (!thread_id) return undefined;

    let row: {
      checkpoint_id: string;
      parent_checkpoint_id: string | null;
      checkpoint: Buffer;
      metadata: Buffer;
    } | undefined;

    if (checkpoint_id) {
      row = this.db
        .prepare(
          "SELECT checkpoint_id, parent_checkpoint_id, checkpoint, metadata FROM checkpoints WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?"
        )
        .get(thread_id, checkpoint_ns, checkpoint_id) as typeof row;
    } else {
      row = this.db
        .prepare(
          "SELECT checkpoint_id, parent_checkpoint_id, checkpoint, metadata FROM checkpoints WHERE thread_id = ? AND checkpoint_ns = ? ORDER BY rowid DESC LIMIT 1"
        )
        .get(thread_id, checkpoint_ns) as typeof row;
    }

    if (!row) return undefined;

    const checkpoint = this.fromBuf<Checkpoint>(row.checkpoint);
    const metadata = this.fromBuf<CheckpointMetadata>(row.metadata);
    if (!checkpoint) return undefined;

    // Get pending writes
    const pendingWrites = this.db
      .prepare(
        "SELECT task_id, idx, channel, value FROM checkpoint_writes WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ? ORDER BY idx"
      )
      .all(thread_id, checkpoint_ns, row.checkpoint_id) as Array<{
      task_id: string;
      idx: number;
      channel: string;
      value: Buffer | null;
    }>;

    return {
      checkpoint,
      metadata: metadata ?? undefined,
      config: {
        configurable: {
          thread_id,
          checkpoint_ns,
          checkpoint_id: row.checkpoint_id,
        },
      },
      parentConfig: row.parent_checkpoint_id
        ? {
            configurable: {
              thread_id,
              checkpoint_ns,
              checkpoint_id: row.parent_checkpoint_id,
            },
          }
        : undefined,
      pendingWrites: pendingWrites.map(w => ([
        w.task_id,
        w.channel,
        w.value ? this.fromBuf(w.value) : undefined,
      ] as [string, string, unknown])),
    };
  }

  /**
   * List checkpoint tuples (newest first).
   */
  async *list(config: RunnableConfig, options?: CheckpointListOptions): AsyncGenerator<CheckpointTuple> {
    const { thread_id, checkpoint_ns = "" } = config.configurable ?? {};
    if (!thread_id) return;

    let query =
      "SELECT checkpoint_id, parent_checkpoint_id, checkpoint, metadata FROM checkpoints WHERE thread_id = ? AND checkpoint_ns = ?";
    const params: unknown[] = [thread_id, checkpoint_ns];

    if (options?.before?.configurable?.checkpoint_id) {
      query += " AND checkpoint_id < ?";
      params.push(options.before.configurable.checkpoint_id);
    }

    query += " ORDER BY rowid DESC";

    if (options?.limit) {
      query += " LIMIT ?";
      params.push(options.limit);
    }

    const rows = this.db.prepare(query).all(...params) as Array<{
      checkpoint_id: string;
      parent_checkpoint_id: string | null;
      checkpoint: Buffer;
      metadata: Buffer;
    }>;

    for (const row of rows) {
      const checkpoint = this.fromBuf<Checkpoint>(row.checkpoint);
      const metadata = this.fromBuf<CheckpointMetadata>(row.metadata);
      if (!checkpoint) continue;

      yield {
        checkpoint,
        metadata: metadata ?? undefined,
        config: {
          configurable: {
            thread_id,
            checkpoint_ns,
            checkpoint_id: row.checkpoint_id,
          },
        },
        parentConfig: row.parent_checkpoint_id
          ? {
              configurable: {
                thread_id,
                checkpoint_ns,
                checkpoint_id: row.parent_checkpoint_id,
              },
            }
          : undefined,
      };
    }
  }

  /**
   * Save a new checkpoint.
   */
  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    _newVersions: ChannelVersions
  ): Promise<RunnableConfig> {
    const { thread_id, checkpoint_ns = "", checkpoint_id } = config.configurable ?? {};
    if (!thread_id) throw new Error("Thread ID is required");

    const newCheckpointId = checkpoint_id || `cp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const parentCheckpointId = config.configurable?.checkpoint_id ?? null;

    this.db
      .prepare(
        `INSERT OR REPLACE INTO checkpoints (thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, checkpoint, metadata)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        thread_id,
        checkpoint_ns,
        newCheckpointId,
        parentCheckpointId,
        this.toBuf(checkpoint),
        this.toBuf(metadata)
      );

    return {
      configurable: {
        thread_id,
        checkpoint_ns,
        checkpoint_id: newCheckpointId,
      },
    };
  }

  /**
   * Store intermediate writes linked to a checkpoint.
   */
  async putWrites(
    config: RunnableConfig,
    writes: PendingWrite[],
    taskId: string
  ): Promise<void> {
    const { thread_id, checkpoint_ns = "", checkpoint_id } = config.configurable ?? {};
    if (!thread_id || !checkpoint_id) return;

    const insert = this.db.prepare(
      `INSERT OR REPLACE INTO checkpoint_writes (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, write_type, value)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );

    for (let idx = 0; idx < writes.length; idx++) {
      const [channel, value] = writes[idx];
      // Determine write_type based on index mapping
      let writeType = "";
      if (channel.startsWith("error:")) {
        writeType = "error";
      }

      insert.run(
        thread_id,
        checkpoint_ns,
        checkpoint_id,
        taskId,
        idx,
        channel,
        writeType,
        this.toBuf(value)
      );
    }
  }

  close(): void {
    this.db.close();
  }
}

// ── Ensure directories exist ───────────────────────────────────────
const dataDir = path.resolve(process.cwd(), "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const outputDir = path.resolve(process.cwd(), "output");
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Singleton checkpointer instance
export const checkpointer = new SqliteCheckpointer();
