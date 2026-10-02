// Cerebro: Node da {topic, fact, format} -> LLM empaqueta -> Node valida.
// Patron probado 2026-10-02: fill-in en ingles, salida PT, 5 lineas, ~8s, $0.
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { config, loadState } from "../lib/config.mjs";
import { parseScriptText, validateScript } from "../lib/schema.mjs";
import { buildBrief } from "./brief.mjs";

const ROOT = config.root;
// Orden de intento: gratis primero. El knob BRAIN_MODEL manda.
const MODELS = [config.brainModel, "opencode/space-bunny-free", "opencode/nemotron-3.5-lightning-free"].filter(
  (m, i, a) => m && a.indexOf(m) === i
);

function lessons(maxChars = 1500) {
  const p = resolve(ROOT, "state/lessons.md");
  if (!existsSync(p)) return "";
  const t = readFileSync(p, "utf8");
  return t.length > maxChars ? t.slice(-maxChars) : t;
}

function bestFormat() {
  const hooks = loadState("hooks.json", { formats: {} });
  const f = hooks.formats || {};
  let best = "quiz_reveal",
    bestScore = -1;
  for (const [k, v] of Object.entries(f)) {
    if (v.n >= 3 && v.median > bestScore) {
      best = k;
      bestScore = v.median;
    }
  }
  return best; // default quiz_reveal hasta tener evidencia
}

function promptFor(fact, format, lessonTxt) {
  const tip = lessonTxt ? `\nProven lesson from past videos (apply if relevant): ${lessonTxt.split("\n").filter(Boolean).slice(-3).join(" | ")}` : "";
  return `Fill this exact template. No questions. No intro. No markdown. No closing.
Topic: ${fact.topic}
Fact (must stay true, do not embellish): ${fact.fact}
${tip}
Output EXACTLY these 6 lines in Brazilian Portuguese:
FORMAT: ${format}
HOOK: <max 12 words, creates curiosity in 1 second>
SETUP: <max 15 words>
REVEAL: <1 sentence, states the fact>
PUNCH: <max 10 words, most shareable line>
CAPTION: <max 180 chars, ends with 1 question + 3 hashtags>
Portuguese of Brazil, not Portugal. The REVEAL must be a true verifiable fact.
Output only the 6 lines.`;
}

function runModel(model, task, timeoutMs = 120000) {
  return new Promise((resolve) => {
    const p = spawn("opencode", ["run", "--model", model, "--format", "json", task], {
      shell: true,
      cwd: ROOT,
    });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    const kill = setTimeout(() => p.kill(), timeoutMs);
    p.on("close", (code) => {
      clearTimeout(kill);
      // extraer el ultimo evento text del stream JSON
      let text = "";
      for (const line of out.split("\n")) {
        const s = line.trim();
        if (!s.startsWith("{")) continue;
        try {
          const ev = JSON.parse(s);
          const c = ev.part?.text ?? ev.text ?? "";
          if (typeof c === "string" && c) text = c; // quedarse con el ultimo
        } catch {}
      }
      resolve({ code, text: text.trim() });
    });
  });
}

export async function brain(date) {
  const day = date || new Date().toISOString().slice(0, 10);
  const briefPath = resolve(ROOT, `data/brief-${day}.json`);
  const brief = existsSync(briefPath)
    ? JSON.parse(readFileSync(briefPath, "utf8"))
    : await buildBrief();
  const format = bestFormat();
  const task = promptFor(brief.fact, format, lessons());

  let script = null,
    usedModel = "";
  const attempts = [];
  for (const m of MODELS) {
    const r = await runModel(m, task);
    const s = parseScriptText(r.text);
    // forzar el formato elegido por Node (el LLM no decide formato)
    s.FORMAT = format;
    const v = validateScript(s);
    attempts.push({ model: m, ok: v.ok, errors: v.errors });
    if (v.ok) {
      script = s;
      usedModel = m;
      break;
    }
  }
  if (!script) throw new Error(`cerebro fallo en todos los modelos: ${JSON.stringify(attempts)}`);

  const queue = {
    date: day,
    factId: brief.fact.id,
    category: brief.fact.category,
    model: usedModel,
    status: "draft",
    approvals: {},
    videos: [{ id: `${day}-01`, format, ...script }],
  };
  mkdirSync(resolve(ROOT, "state/queue"), { recursive: true });
  writeFileSync(resolve(ROOT, `state/queue/${day}.json`), JSON.stringify(queue, null, 2));
  // marcar hecho como usado
  writeFileSync(resolve(ROOT, "data/used.jsonl"), JSON.stringify({ date: day, factId: brief.fact.id }) + "\n", { flag: "a" });
  return queue;
}

if (import.meta.url === `file://${process.argv[1].replaceAll("\\", "/")}`) {
  const q = await brain();
  console.log(JSON.stringify({ date: q.date, fact: q.factId, model: q.model, hook: q.videos[0].HOOK }, null, 2));
}
