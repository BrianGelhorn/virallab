// Ciclo diario de evolucion (09:00 America/Argentina/Buenos_Aires o al encender).
// 1 ciclo/dia, 1 candidato, 30 min max, 2 reparaciones, 1 activacion.
// Si no hay evidencia: "sin cambio justificado" (decidir esperar tambien es decidir).
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config, loadEnv } from "../lib/config.mjs";
import { acquire, release, todayBA } from "./lock.mjs";
import { runTurn } from "./ocode.mjs";
import { checkDiff, checkModel, parseContract } from "./guards.mjs";
import { startCandidate, candidateDiff, aheadCount, commitCandidate, activate, rollback, cleanup, workdir } from "./versions.mjs";
import { memory } from "./memory.mjs";
import { evolve } from "../jobs/evolve.mjs";
import { charsUsedThisMonth } from "../lib/tts.mjs";

const ROOT = config.root;
const ENV = loadEnv();
const MODEL = ENV.EVOLVE_MODEL || config.brainModel;
const T0 = Date.now();
const BUDGET_MS = 30 * 60 * 1000;
const timeLeft = () => BUDGET_MS - (Date.now() - T0);

function observe() {
  const fails = memory.recentFailures("publish", 2).map((r) => r.status);
  const evo = evolve();
  const failed = memory.failedEvolutions();
  let backlog = [];
  try {
    const t = readFileSync(resolve(ROOT, "backlog.md"), "utf8");
    // items pendientes multi-linea: "- [ ] titulo" + lineas hasta el proximo item o header
    const chunks = t.split(/(?=^- \[ \]|^## )/m).filter((c) => c.trim().startsWith("- [ ]"));
    backlog = chunks.slice(0, 3);
  } catch {}
  return {
    date: todayBA(),
    prodFailures: fails,
    videos: evo.totalVideos,
    formats: evo.formats,
    changes: evo.changes,
    tts: `${charsUsedThisMonth()}/${config.elevenLabsCharsPerMonth}`,
    failedPast: failed.map((f) => `${f.date}: ${f.problem} -> ${f.result}`),
    backlog,
  };
}

// Contrato deterministico desde un item del backlog (el operador ya escribio
// problema/evidencia/cambio/metrica/comprobacion). El LLM implementa, no decide.
export function contractFromBacklog(item) {
  const labels = ["Evidencia", "Cambio", "Metrica", "Comprobacion"];
  const sec = (label) => {
    const rest = labels.slice(labels.indexOf(label) + 1).map((l) => l + ":").join("|");
    const re = new RegExp(label + ":\\s*([\\s\\S]*?)(?:" + (rest ? rest + "|" : "") + "$)", "i");
    const m = item.match(re);
    return m ? m[1].replace(/\s+/g, " ").replace(/`/g, "").trim() : "";
  };
  const title = item.split("\n")[0].replace(/^- \[ \]\s*/, "").split(/evidencia:/i)[0].trim();
  const contract = {
    PROBLEMA: title,
    EVIDENCIA: sec("Evidencia"),
    HIPOTESIS: `Implementar el cambio mejora: ${title.slice(0, 80)}`,
    CAMBIO: sec("Cambio"),
    METRICA: sec("Metrica"),
    COMPROBACION: sec("Comprobacion"),
    REVERSION: "Revertir si rompe tests, canary o salud post-activacion",
  };
  const missing = Object.entries(contract).filter(([, v]) => !v).map(([k]) => k);
  return { contract, ok: missing.length === 0, missing };
}

function remember() {
  const last = memory.lastEvolutions(3).map((e) => `${e.date} [${e.status}] ${e.problem} -> ${e.result} (${e.version})`);
  return last.length ? last.join("\n") : "(sin evoluciones previas)";
}

const ALLOWED = "jobs/, platform/, lib/stock.mjs, lib/tts.mjs, n8n/workflows/virallab-*.json, dashboard/, state/niche.json, state/lessons.md";
const FORBIDDEN = "supervisor/, lib/schema.mjs, lib/config.mjs, test/acceptance/, package.json, scripts/, .env, credenciales, presupuesto";

function analyzePrompt(obs, mem) {
  const fmt = obs.formats || {};
  const q = fmt.quiz_reveal ? `${fmt.quiz_reveal.n}v med=${fmt.quiz_reveal.median}` : "0v";
  const r = fmt.ranking ? `${fmt.ranking.n}v med=${fmt.ranking.median}` : "0v";
  return `Responde de EXACTAMENTE una de estas 2 formas. Tu primera palabra debe ser SIN_CAMBIO: o PROBLEMA:. No escribas introduccion ni expliques tu razonamiento.

Si no hay evidencia suficiente para cambiar codigo hoy, responde exactamente:
SIN_CAMBIO: <motivo en 1 linea>

Si sí hay, responde exactamente estas 7 lineas (sin markdown, sin intro):
PROBLEMA: <1 linea>
EVIDENCIA: <1 linea, dato concreto de abajo>
HIPOTESIS: <1 linea>
CAMBIO: <archivos y que cambia>
METRICA: <que deberia moverse>
COMPROBACION: <como se verifica con npm test>
REVERSION: <cuando revertir>

Datos de hoy: videos=${obs.videos} quiz=[${q}] ranking=[${r}] fallosProd=${JSON.stringify(obs.prodFailures)} tts=${obs.tts}
Backlog operador: ${obs.backlog.length ? obs.backlog.join(" | ") : "(vacio)"}
REGLA: un item del backlog con evidencia concreta (archivos + verificacion) CUENTA como evidencia suficiente. Tomalo como candidato con su contrato en vez de responder SIN_CAMBIO. Solo responde SIN_CAMBIO si no hay backlog ni datos que justifiquen nada.
Fallos pasados: ${obs.failedPast.length ? obs.failedPast.join(" | ") : "(ninguno)"}
Memoria: ${mem.split("\n").slice(0, 3).join(" | ").slice(0, 400)}
Podes tocar: ${ALLOWED}
Prohibido: ${FORBIDDEN}`;
}

async function runTests(cwd) {
  try {
    const out = execSync(`node --test test/*.test.mjs`, { cwd, encoding: "utf8", timeout: 180000 });
    return { ok: /fail 0/.test(out), out: out.slice(-600) };
  } catch (e) {
    return { ok: false, out: String(e.message || e).slice(-600) };
  }
}

export async function runEvolution({ force = false } = {}) {
  const lock = acquire();
  const date = todayBA();
  if (!lock.ok && !force) return { status: "skipped", why: lock.why };
  if (force) console.log(JSON.stringify({ note: "force-override", prev: lock.why || "none" }));
  const mc = checkModel(MODEL);
  if (!mc.ok) {
    memory.logRun(date, "evolution", "blocked", mc.why);
    memory.recordEvolution({ date, problem: "-", evidence: "-", change: "-", metric: "-", result: mc.why, version: "-", status: "blocked" });
    release("blocked", mc.why);
    return { status: "blocked", why: mc.why };
  }
  const log = (status, detail = "") => {
    memory.logRun(date, "evolution", status, detail);
    console.log(JSON.stringify({ evolution: date, status, detail: detail.slice(0, 150) }));
  };
  try {
    // 1-2. observar + recordar
    const obs = observe();
    const mem = remember();
    // 3. contrato: backlog pendiente manda (deterministico); si no hay, analizar
    let pc = null;
    let sid = null;
    if (obs.backlog.length) {
      const bc = contractFromBacklog(obs.backlog[0]);
      if (!bc.ok) {
        memory.recordEvolution({ date, problem: "-", evidence: "-", change: "-", metric: "-", result: `backlog mal formado (falta ${bc.missing.join(",")})`, version: "-", status: "rejected" });
        release("rejected", "backlog mal formado");
        return { status: "rejected", why: "backlog mal formado" };
      }
      pc = bc;
      log("contract-backlog", pc.contract.PROBLEMA.slice(0, 100));
    } else {
      const a = await runTurn({ task: analyzePrompt(obs, mem), model: MODEL, cwd: ROOT, timeoutMs: Math.min(600000, timeLeft()) });
      sid = a.sessionId;
      const noChange = a.text.match(/SIN_CAMBIO:?\s*(.+)?/i);
      if (noChange) {
        const why = (noChange[1] || "").trim() || "sin evidencia";
        memory.recordEvolution({ date, problem: "-", evidence: JSON.stringify(obs.formats), change: "-", metric: "-", result: why, version: "-", status: "no-change" });
        release("no-change", why);
        log("no-change", why);
        return { status: "no-change", why };
      }
      pc = parseContract(a.text);
      if (!pc.ok) {
        const raw = a.text.slice(0, 400);
        memory.recordEvolution({ date, problem: "-", evidence: "-", change: "-", metric: "-", result: `contrato incompleto (falta ${pc.missing.join(",")})`, version: "-", status: "rejected" });
        release("rejected", "contrato incompleto");
        console.log(JSON.stringify({ debug_session: sid, debug_raw: raw }));
        return { status: "rejected", why: "contrato incompleto" };
      }
    }
    // 4. candidato en worktree aislado (sesion de implementacion)
    const dir = startCandidate(date);
    const implementTask =
      `CAMBIO A IMPLEMENTAR: ${pc.contract.CAMBIO}\n` +
      `EVIDENCIA: ${pc.contract.EVIDENCIA}\n` +
      `COMPROBACION: ${pc.contract.COMPROBACION}\n\n` +
      `Tu directorio de trabajo es ${dir}. EDITA los archivos ahi con tus herramientas (rutas relativas al directorio). No describas el cambio: implementalo archivo por archivo. Tambien agrega o extiende un test en test/ que verifique el cambio.\n` +
      `Prohibido tocar: ${FORBIDDEN}. No uses credenciales ni red.\n` +
      `Cuando termines responde: LISTO: <archivos que modificaste>`;
    console.log(JSON.stringify({ debug_task_len: implementTask.length, debug_task_head: implementTask.slice(0, 300) }));
    const t2 = await runTurn({
      sessionId: sid, model: MODEL, cwd: dir,
      task: implementTask,
      timeoutMs: Math.min(600000, timeLeft()),
    });
    sid = t2.sessionId || sid;
    console.log(JSON.stringify({ debug_implement: t2.text.slice(-300) }));
    // 5. probar: commitear PRIMERO, despues guards + tests sobre lo commiteado.
    // (Chequear el diff pre-commit ve el estado anterior y deja pasar violaciones.)
    let testRes = null;
    for (let attempt = 0; attempt <= 2; attempt++) {
      commitCandidate(date, attempt === 0 ? "candidato" : `reparacion ${attempt}`);
      const diff = candidateDiff(date);
      const g = checkDiff(diff);
      const ahead = aheadCount(date);
      if (!g.ok) {
        testRes = { ok: false, out: `AREA PROTEGIDA: ${g.why}. Reverti esos archivos con: git checkout main -- <archivo>. Despues trabaja solo en ${ALLOWED}.` };
      } else if (ahead === 0) {
        testRes = { ok: false, out: attempt === 2
          ? "sin cambios tras 3 intentos: el agente no implemento nada."
          : "sin cambios: no modificaste ningun archivo del worktree. EDITA los archivos indicados en el contrato, no los describas." };
      } else {
        testRes = await runTests(dir);
      }
      if (testRes.ok) break;
      if (attempt === 2) break;
      // 6. corregir con el fallo concreto (misma sesion)
      await runTurn({
        sessionId: sid, model: MODEL, cwd: dir,
        task: `Tu cambio fallo. Fallo concreto:\n${testRes.out}\nCorregilo tocando solo ${ALLOWED}. Responde LISTO cuando termines.`,
        timeoutMs: Math.min(600000, timeLeft()),
      });
    }
    if (!testRes.ok) {
      cleanup(date);
      memory.recordEvolution({ date, ...lower(pc.contract), result: `descartado: ${testRes.out.slice(0, 200)}`, version: "-", status: "discarded" });
      release("discarded", testRes.out.slice(0, 150));
      log("discarded", testRes.out.slice(0, 150));
      return { status: "discarded", why: testRes.out.slice(0, 200) };
    }
    // 7. activar
    commitCandidate(date, `${pc.contract.PROBLEMA} | ${pc.contract.METRICA}`);
    const act = activate(date);
    // canary: brief rapido sobre la version activa
    let canary = true;
    try {
      execSync(`node jobs/brief.mjs`, { cwd: ROOT, encoding: "utf8", timeout: 180000 });
    } catch { canary = false; }
    if (!canary) {
      const rb = rollback();
      cleanup(date);
      memory.recordEvolution({ date, ...lower(pc.contract), result: `canary fallo, rollback a ${rb.restored}`, version: act.sha, status: "rolledback" });
      release("rolledback", rb.restored);
      return { status: "rolledback", why: "canary fallo" };
    }
    cleanup(date);
    memory.recordEvolution({ date, ...lower(pc.contract), result: "activado + canary ok", version: act.sha, status: "activated" });
    release("activated", act.sha);
    log("activated", act.sha);
    return { status: "activated", version: act.sha, contract: pc.contract };
  } catch (e) {
    release("failed", String(e.message || e).slice(0, 150));
    log("failed", String(e.message || e).slice(0, 150));
    return { status: "failed", why: String(e.message || e).slice(0, 200) };
  }
}

const lower = (c) => ({ problem: c.PROBLEMA, evidence: c.EVIDENCIA, change: c.CAMBIO, metric: c.METRICA });

// main: node supervisor/cycle.mjs [--force]
import { isMain } from "../lib/config.mjs";
if (isMain(import.meta.url)) {
  const force = process.argv.includes("--force");
  console.log(JSON.stringify(await runEvolution({ force }), null, 2));
  memory.close();
  process.exit(0);
}
