import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { defaults, validateConfig, type Config } from "./domain.ts";

export class Store {
  db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS config (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, created TEXT NOT NULL, status TEXT NOT NULL, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS transactions (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, step TEXT NOT NULL, digest TEXT NOT NULL UNIQUE, json TEXT NOT NULL, UNIQUE(run_id,step));
      CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, created TEXT NOT NULL, action TEXT NOT NULL, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS locks (id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT NOT NULL, pid INTEGER NOT NULL);
      PRAGMA user_version=1;`);
    this.db
      .prepare("INSERT OR IGNORE INTO config VALUES(1,1,?)")
      .run(JSON.stringify(defaults));
  }
  config(): { version: number; config: Config } {
    const row = this.db.prepare("SELECT * FROM config WHERE id=1").get()!;
    return {
      version: Number(row.version),
      config: JSON.parse(String(row.json)),
    };
  }
  saveConfig(config: Config, expectedVersion: number) {
    const clean = validateConfig(config);
    const result = this.db
      .prepare(
        "UPDATE config SET version=version+1,json=? WHERE id=1 AND version=?",
      )
      .run(JSON.stringify(clean), expectedVersion);
    if (!result.changes)
      throw new Error("Configuration changed. Reload before saving.");
    this.audit("config.updated", this.config());
    return this.config();
  }
  audit(action: string, data: unknown) {
    this.db
      .prepare("INSERT INTO audit(created,action,json) VALUES(?,?,?)")
      .run(new Date().toISOString(), action, JSON.stringify(data));
  }
  runs(): any[] {
    return this.db
      .prepare("SELECT json FROM runs ORDER BY created DESC LIMIT 100")
      .all()
      .map((r) => JSON.parse(String(r.json)));
  }
  hasSlot(slot: string) {
    return !!this.db
      .prepare("SELECT 1 FROM runs WHERE json_extract(json,'$.slot')=? LIMIT 1")
      .get(slot);
  }
  active(): any {
    const row = this.db
      .prepare(
        "SELECT json FROM runs WHERE status!='complete' ORDER BY created LIMIT 1",
      )
      .get();
    return row ? JSON.parse(String(row.json)) : null;
  }
  run(id: string): any {
    const row = this.db.prepare("SELECT json FROM runs WHERE id=?").get(id);
    if (!row) throw new Error("Run not found");
    return JSON.parse(String(row.json));
  }
  saveRun(run: any) {
    this.db
      .prepare(
        "INSERT INTO runs VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,json=excluded.json",
      )
      .run(run.id, run.created, run.status, JSON.stringify(run));
  }
  tx(run: string, step: string): any {
    const row = this.db
      .prepare("SELECT json FROM transactions WHERE run_id=? AND step=?")
      .get(run, step);
    return row ? JSON.parse(String(row.json)) : null;
  }
  saveTx(tx: any) {
    this.db
      .prepare(
        "INSERT INTO transactions VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json",
      )
      .run(tx.id, tx.run, tx.step, tx.digest, JSON.stringify(tx));
  }
  history() {
    return this.db
      .prepare(
        "SELECT created,action,json FROM audit ORDER BY id DESC LIMIT 100",
      )
      .all();
  }
  async locked<T>(fn: () => Promise<T>): Promise<T> {
    const owner = randomUUID();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const old = this.db.prepare("SELECT * FROM locks WHERE id=1").get();
      if (old) {
        let alive = true;
        try {
          process.kill(Number(old.pid), 0);
        } catch (error: any) {
          if (error.code === "ESRCH") alive = false;
        }
        if (alive) throw new Error("Another worker operation is running");
        this.db.exec("DELETE FROM locks WHERE id=1");
      }
      this.db
        .prepare("INSERT INTO locks VALUES(1,?,?)")
        .run(owner, process.pid);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    try {
      return await fn();
    } finally {
      this.db.prepare("DELETE FROM locks WHERE owner=?").run(owner);
    }
  }
}
