// Lock por fecha: una evolucion por dia, sin duplicados, reboot-safe.
// Un lock de ayer nunca bloquea hoy (el supervisor tambien corre al encender).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "../lib/config.mjs";

const P = resolve(config.root, "state/evolution/lock.json");
export const todayBA = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });

export function acquire(lockPath = P) {
  const today = todayBA();
  mkdirSync(resolve(config.root, "state/evolution"), { recursive: true });
  if (existsSync(lockPath)) {
    try {
      const l = JSON.parse(readFileSync(lockPath, "utf8"));
      if (l.date === today) {
        // recovery de crash: lock "running" de un pid muerto = corrida anterior asesinada
        if (l.status === "running" && l.pid && l.pid !== process.pid) {
          try { process.kill(l.pid, 0); return { ok: false, why: `ya corrio hoy (${l.status || "?"})` }; }
          catch { /* pid muerto: se permite reintentar */ }
        } else {
          return { ok: false, why: `ya corrio hoy (${l.status || "?"})` };
        }
      }
    } catch {}
  }
  writeFileSync(lockPath, JSON.stringify({ date: today, pid: process.pid, started: new Date().toISOString(), status: "running" }));
  return { ok: true, date: today };
}

export function release(status, detail = "", lockPath = P) {
  if (!existsSync(lockPath)) return;
  try {
    const l = JSON.parse(readFileSync(lockPath, "utf8"));
    writeFileSync(lockPath, JSON.stringify({ ...l, status, detail: String(detail).slice(0, 200), ended: new Date().toISOString() }));
  } catch {}
}
