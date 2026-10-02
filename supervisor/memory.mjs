// Memoria persistente: episodios, experimentos, evoluciones, corridas.
// SQLite local (node:sqlite built-in). JSONL sigue como fuente append-only de metricas.
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { config } from "../lib/config.mjs";

mkdirSync(resolve(config.root, "data"), { recursive: true });
const db = new DatabaseSync(resolve(config.root, "data/memory.sqlite"));

db.exec(`
CREATE TABLE IF NOT EXISTS episodes(date TEXT, lang TEXT, topic TEXT, video_id TEXT PRIMARY KEY, status TEXT, score REAL);
CREATE TABLE IF NOT EXISTS experiments(id TEXT PRIMARY KEY, hypothesis TEXT, format TEXT, lang TEXT, start_date TEXT, end_date TEXT, status TEXT, result TEXT);
CREATE TABLE IF NOT EXISTS evolutions(id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT, problem TEXT, evidence TEXT, change TEXT, metric TEXT, result TEXT, version TEXT, status TEXT, created_at TEXT DEFAULT (datetime('now','localtime')));
CREATE TABLE IF NOT EXISTS runs(date TEXT, kind TEXT, status TEXT, detail TEXT, at TEXT DEFAULT (datetime('now','localtime')));
`);

export const memory = {
  logRun: (date, kind, status, detail = "") =>
    db.prepare(`INSERT INTO runs(date,kind,status,detail) VALUES(?,?,?,?)`).run(date, kind, status, String(detail).slice(0, 500)),
  // fallos de produccion de la version actual (para rollback automatico: 2 seguidos = revertir)
  recentFailures: (kind, n = 2) =>
    db.prepare(`SELECT status FROM runs WHERE kind=? ORDER BY rowid DESC LIMIT ?`).all(kind, n),
  recordEvolution: (e) =>
    db.prepare(`INSERT INTO evolutions(date,problem,evidence,change,metric,result,version,status) VALUES(?,?,?,?,?,?,?,?)`)
      .run(e.date, e.problem || "", e.evidence || "", e.change || "", e.metric || "", e.result || "", e.version || "", e.status || ""),
  recordEpisode: (e) =>
    db.prepare(`INSERT OR REPLACE INTO episodes(date,lang,topic,video_id,status,score) VALUES(?,?,?,?,?,?)`)
      .run(e.date, e.lang || "pt-BR", e.topic || "", e.video_id, e.status || "", e.score ?? null),
  lastEvolutions: (n = 5) =>
    db.prepare(`SELECT date,problem,result,version,status FROM evolutions ORDER BY id DESC LIMIT ?`).all(n),
  failedEvolutions: () =>
    db.prepare(`SELECT date,problem,result FROM evolutions WHERE status IN ('failed','rolledback','discarded') ORDER BY id DESC LIMIT 5`).all(),
  close: () => db.close(),
};
