// Cliente de evolucion: turnos `opencode run --session` (multi-turno sin server anidado).
// Sesiones provadas 2026-10-02 con tier gratis: create + continue con memoria + cache.
// Hijos de vida corta: timeout via kill, sin huerfanos, sin puertos, sin passwords.
import { spawn } from "node:child_process";

export function parseRunEvents(out) {
  let sessionId = null;
  let text = "";
  for (const line of out.split("\n")) {
    const s = line.trim();
    if (!s.startsWith("{")) continue;
    try {
      const ev = JSON.parse(s);
      if (ev.sessionID) sessionId = ev.sessionID;
      const c = ev.part?.text ?? ev.text ?? "";
      if (typeof c === "string" && c) text = c; // ultimo texto
    } catch {}
  }
  return { sessionId, text: text.trim() };
}

// Un turno. Si no hay sessionId, crea sesion (usa --title). Devuelve {sessionId, text}.
export function runTurn({ sessionId = null, title = null, task, model, cwd, timeoutMs = 600000 }) {
  return new Promise((resolve) => {
    const args = ["run", "--model", model, "--format", "json"];
    if (sessionId) args.push("--session", sessionId);
    else if (title) args.push("--title", title);
    args.push(task);
    const p = spawn("opencode", args, {
      shell: true,
      cwd,
      stdio: ["ignore", "pipe", "pipe"], // sin esto opencode se bloquea esperando stdin heredado
    });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    const kill = setTimeout(() => p.kill(), timeoutMs);
    p.on("close", (code) => {
      clearTimeout(kill);
      const { sessionId: sid, text } = parseRunEvents(out);
      resolve({ code, sessionId: sid || sessionId, text, raw: out.slice(-500) });
    });
  });
}
