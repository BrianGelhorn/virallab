// Evolucion: Node calcula (ranking determinista), el LLM solo recibe el digest.
// Regla: un knob cambia solo con n>=8 por lado y gap>30%. Si no, explorar.
// Actualiza state/hooks.json y agrega a state/lessons.md (cap 200 lineas) solo si hay cambio real.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { config, loadState , isMain} from "../lib/config.mjs";
import { significant, median } from "../lib/schema.mjs";

const ROOT = config.root;

function loadMetrics() {
  const p = resolve(ROOT, "data/metrics.jsonl");
  if (!existsSync(p)) return [];
  // un row por video por dia; quedarse con el ultimo por videoId
  const byId = new Map();
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (typeof r.score === "number") byId.set(r.videoId, r);
    } catch {}
  }
  return [...byId.values()];
}

function groupStats(rows, key) {
  const g = {};
  for (const r of rows) {
    const k = r[key] || "unknown";
    (g[k] = g[k] || []).push(r.score);
  }
  return Object.fromEntries(
    Object.entries(g).map(([k, xs]) => [k, { n: xs.length, median: Math.round(median(xs) * 1000) / 1000 }])
  );
}

function capLessons(lines, max = 200) {
  return lines.slice(-max);
}

export function evolve() {
  const rows = loadMetrics();
  const hooks = loadState("hooks.json", { formats: {}, categories: {}, updated: null });
  const prev = JSON.parse(JSON.stringify(hooks));
  hooks.formats = groupStats(rows, "format");
  hooks.categories = groupStats(rows, "category");
  hooks.updated = new Date().toISOString().slice(0, 10);
  hooks.totalVideos = rows.length;

  // detectar cambios significativos vs ranking previo (solo con evidencia)
  const changes = [];
  for (const [kind, cur] of [["formats", hooks.formats], ["categories", hooks.categories]]) {
    const old = prev[kind] || {};
    const keys = new Set([...Object.keys(cur), ...Object.keys(old)]);
    for (const k of keys) {
      const a = old[k] || { n: 0, median: 0 };
      const b = cur[k] || { n: 0, median: 0 };
      const s = significant(a, b);
      if (s.change) changes.push(`${kind}/${k}: ${a.median}->${b.median} (${s.why})`);
    }
  }

  mkdirSync(resolve(ROOT, "state"), { recursive: true });
  writeFileSync(resolve(ROOT, "state/hooks.json"), JSON.stringify(hooks, null, 2));

  let lesson = "";
  if (changes.length) {
    lesson = `${hooks.updated}: ${changes.join("; ")}`;
    const lp = resolve(ROOT, "state/lessons.md");
    const cur = existsSync(lp) ? readFileSync(lp, "utf8").split("\n").filter(Boolean) : [];
    writeFileSync(lp, capLessons([...cur, lesson]).join("\n") + "\n");
  }
  return { totalVideos: rows.length, formats: hooks.formats, categories: hooks.categories, changes, lesson };
}

if (isMain(import.meta.url)) {
  console.log(JSON.stringify(evolve(), null, 2));
}
