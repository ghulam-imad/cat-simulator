import type { DatabaseSync } from "node:sqlite";

export interface AttemptRow {
  id: string;
  student: string;
  setNumber: string;
  startedAt: number;
  /** Every random number the engine has drawn, in order, so replaying gives the same Questions. */
  randomValues: number[];
}

export type AttemptEvent =
  | { kind: "selection"; selected: number[]; at: number }
  | { kind: "response"; selected: number[]; at: number }
  /** The Student's page is open: sent every few seconds, and on logging in again. */
  | { kind: "heartbeat"; at: number };

/** Saves Attempts as their start plus an append-only list of events. */
export class AttemptStore {
  constructor(private db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student TEXT NOT NULL,
        set_number TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        random_values TEXT NOT NULL DEFAULT '[]',
        discarded_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS attempt_events (
        attempt_id INTEGER NOT NULL REFERENCES attempts(id),
        seq INTEGER NOT NULL,
        kind TEXT NOT NULL,
        selected TEXT,
        at INTEGER NOT NULL,
        PRIMARY KEY (attempt_id, seq)
      );
    `);
  }

  create(student: string, setNumber: string, startedAt: number): string {
    const result = this.db
      .prepare("INSERT INTO attempts (student, set_number, started_at) VALUES (?, ?, ?)")
      .run(student, setNumber, startedAt);
    return String(result.lastInsertRowid);
  }

  get(id: string): AttemptRow | undefined {
    const row = this.db.prepare("SELECT * FROM attempts WHERE id = ?").get(id);
    return row ? toAttemptRow(row) : undefined;
  }

  /** The Student's most recent Attempt at this Exercise Set, if any. */
  latest(student: string, setNumber: string): AttemptRow | undefined {
    const row = this.db
      .prepare("SELECT * FROM attempts WHERE student = ? AND set_number = ? AND discarded_at IS NULL ORDER BY id DESC LIMIT 1")
      .get(student, setNumber);
    return row ? toAttemptRow(row) : undefined;
  }

  /** Every Attempt not discarded, newest first. */
  all(): AttemptRow[] {
    return this.db.prepare("SELECT * FROM attempts WHERE discarded_at IS NULL ORDER BY id DESC").all().map(toAttemptRow);
  }

  discard(id: string, at: number): void {
    this.db.prepare("UPDATE attempts SET discarded_at = ? WHERE id = ?").run(at, id);
  }

  saveRandomValues(id: string, values: number[]): void {
    this.db.prepare("UPDATE attempts SET random_values = ? WHERE id = ?").run(JSON.stringify(values), id);
  }

  append(id: string, event: AttemptEvent): void {
    this.db
      .prepare(
        `INSERT INTO attempt_events (attempt_id, seq, kind, selected, at)
         VALUES (?, (SELECT COUNT(*) FROM attempt_events WHERE attempt_id = ?), ?, ?, ?)`,
      )
      .run(id, id, event.kind, "selected" in event ? JSON.stringify(event.selected) : null, event.at);
  }

  events(id: string): AttemptEvent[] {
    return this.db
      .prepare("SELECT kind, selected, at FROM attempt_events WHERE attempt_id = ? ORDER BY seq")
      .all(id)
      .map((row) =>
        row.kind === "heartbeat"
          ? { kind: "heartbeat", at: Number(row.at) }
          : {
              kind: row.kind as "selection" | "response",
              selected: JSON.parse(String(row.selected)) as number[],
              at: Number(row.at),
            },
      );
  }
}

function toAttemptRow(row: Record<string, unknown>): AttemptRow {
  return {
    id: String(row.id),
    student: String(row.student),
    setNumber: String(row.set_number),
    startedAt: Number(row.started_at),
    randomValues: JSON.parse(String(row.random_values)) as number[],
  };
}
