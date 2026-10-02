// Cerebro: Node da {topic, fact, format} -> LLM empaqueta -> Node valida.
// Patron probado 2026-10-02: fill-in en ingles, salida PT, 5 lineas, ~8s, $0.
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { config, loadState , isMain} from "../lib/config.mjs";
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

// Exploracion forzada: el formato con menos muestras hasta que ambos tengan >=8.
// Despues, explota por mediana. Pura (testeable): recibe conteos, devuelve formato.
export function chooseFormat(quizN, rankN) {
  if (quizN < 8 || rankN < 8) return rankN < quizN ? "ranking" : "quiz_reveal";
  return null; // null = usar bestFormat() con medianas
}

function formatCounts() {
  const hooks = loadState("hooks.json", { formats: {} });
  const f = hooks.formats || {};
  return { quiz: f.quiz_reveal?.n || 0, rank: f.ranking?.n || 0 };
}

// Ranking: 3 hechos VERDADEROS del banco, misma categoria. El LLM solo ordena y empaqueta.
function pickRankingFacts(category, excludeId) {
  const facts = JSON.parse(readFileSync(resolve(ROOT, "data/facts.json"), "utf8"));
  const usedPath = resolve(ROOT, "data/used.jsonl");
  const usedLines = existsSync(usedPath) ? readFileSync(usedPath, "utf8") : "";
  const used = new Set(
    usedLines.split("\n").filter(Boolean).map((l) => {
      try { return JSON.parse(l).factId; } catch { return ""; }
    })
  );
  used.add(excludeId);
  const pool = facts.filter((f) => f.category === category && !used.has(f.id));
  const list = pool.length >= 3 ? pool : facts.filter((f) => !used.has(f.id));
  const out = [];
  while (out.length < 3 && list.length) out.push(list.splice(Math.floor(Math.random() * list.length), 1)[0]);
  return out;
}

function promptFor(fact, format, lessonTxt) {
  const tip = lessonTxt ? `\nProven lesson from past videos (apply if relevant): ${lessonTxt.split("\n").filter(Boolean).slice(-3).join(" | ")}` : "";
  if (format === "ranking") {
    const items = fact.items.map((f, i) => `Fact ${i + 1} (keep true, shorten to 1 line): ${f.fact}`).join("\n");
    return `Fill this exact template. No questions. No intro. No markdown. No closing.
Topic: ${fact.topic} — rank these 3 TRUE facts from least to most surprising.
${items}
${tip}
Output EXACTLY these 7 lines in Brazilian Portuguese:
FORMAT: ranking
HOOK: <max 12 words, e.g. "3 coisas que voce nao sabia sobre X">
C3: <least surprising fact, 1 line>
C2: <middle fact, 1 line>
C1: <most surprising fact, 1 line>
PUNCH: <max 10 words, most shareable line>
CAPTION: <max 180 chars, ends with 1 question + 3 hashtags>
Portuguese of Brazil, not Portugal. Never invent or embellish facts.
Output only the 7 lines.`;
  }
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
  const counts = formatCounts();
  const forced = chooseFormat(counts.quiz, counts.rank);
  const format = forced || bestFormat();
  // ranking necesita 3 hechos; quiz usa el del brief
  const factForPrompt =
    format === "ranking"
      ? { topic: brief.fact.category, items: pickRankingFacts(brief.fact.category, brief.fact.id) }
      : brief.fact;
  if (format === "ranking" && (!factForPrompt.items || factForPrompt.items.length < 3))
    throw new Error("ranking sin 3 hechos disponibles");
  const task = promptFor(factForPrompt, format, lessons());

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

  const { FORMAT, ...lines } = script;
  const factIds = format === "ranking" ? factForPrompt.items.map((f) => f.id) : [brief.fact.id];
  const queue = {
    date: day,
    factId: factIds[0],
    factIds,
    category: brief.fact.category,
    model: usedModel,
    status: "draft",
    approvals: {},
    videos: [{ id: `${day}-01`, format: FORMAT || format, ...lines }],
  };
  mkdirSync(resolve(ROOT, "state/queue"), { recursive: true });
  writeFileSync(resolve(ROOT, `state/queue/${day}.json`), JSON.stringify(queue, null, 2));
  // marcar hechos como usados
  for (const fid of factIds)
    writeFileSync(resolve(ROOT, "data/used.jsonl"), JSON.stringify({ date: day, factId: fid }) + "\n", { flag: "a" });
  return queue;
}

if (isMain(import.meta.url)) {
  const q = await brain();
  console.log(JSON.stringify({ date: q.date, fact: q.factId, model: q.model, hook: q.videos[0].HOOK }, null, 2));
}
