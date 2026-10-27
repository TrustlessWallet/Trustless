/* Real SQLite adapter for Jest. Node 22.14+ provides node:sqlite without an added dependency. */
declare const require: (name: string) => any;
declare const process: { pid: number; env: Record<string, string | undefined> };

const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (path: string) => any };
const databasePath = `/tmp/trustless-terminal-${process.pid}-${process.env.JEST_WORKER_ID ?? '0'}.sqlite`;
let nextWriteError: Error | null = null;

function values(params: unknown[]): unknown[] {
  return params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
}

class NodeSQLiteDatabase {
  private database: any;
  readonly databasePath: string;
  readonly options = {};
  readonly nativeDatabase = {} as any;

  constructor(path: string) {
    this.databasePath = path;
    this.database = new DatabaseSync(path);
  }

  async execAsync(sql: string): Promise<void> { this.database.exec(sql); }

  async runAsync(sql: string, ...input: unknown[]): Promise<{ changes: number; lastInsertRowId: number }> {
    if (nextWriteError && (/^\s*(?:INSERT|UPDATE|DELETE|REPLACE)/i.test(sql) || /^\s*WITH\b[\s\S]*?\)\s*(?:INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql))) {
      const error = nextWriteError;
      nextWriteError = null;
      throw error;
    }
    const result = this.database.prepare(sql).run(...values(input));
    return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
  }

  async getFirstAsync<T>(sql: string, ...input: unknown[]): Promise<T | null> {
    return (this.database.prepare(sql).get(...values(input)) as T | undefined) ?? null;
  }

  async getAllAsync<T>(sql: string, ...input: unknown[]): Promise<T[]> {
    return this.database.prepare(sql).all(...values(input)) as T[];
  }

  async withExclusiveTransactionAsync<T>(task: (transaction: NodeSQLiteDatabase) => Promise<T>): Promise<T> {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = await task(this);
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  async withTransactionAsync<T>(task: () => Promise<T>): Promise<T> {
    return this.withExclusiveTransactionAsync(task as unknown as (transaction: NodeSQLiteDatabase) => Promise<T>);
  }

  async closeAsync(): Promise<void> { this.database.close(); }
}

export const expoSqliteMock = {
  openDatabaseAsync: async (name: string) => new NodeSQLiteDatabase(databasePath.replace('.sqlite', `-${name.replace(/[^a-z0-9_-]/gi, '_')}.sqlite`)),
};

/** Initialize the service database if needed, then clear all terminal rows. */
export async function resetTerminalSqlite(): Promise<void> {
  nextWriteError = null;
  const { resetTerminalDatabaseForTests } = require('../../services/terminalDatabase') as {
    resetTerminalDatabaseForTests: () => Promise<void>;
  };
  await resetTerminalDatabaseForTests();
}

export function failNextTerminalSqliteWrite(error = new Error('storage full')): void {
  nextWriteError = error;
}
