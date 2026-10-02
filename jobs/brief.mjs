// Brief diario: senales de tendencia -> categoria caliente -> hecho verificado.
// Node investiga (red + banco). El LLM solo empaqueta. Nunca inventa hechos.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "../lib/config.mjs";

const ROOT = config.root;
const today = () => new Date().toISOString().slice(0, 10);

// Articulos de Wikipedia PT mapeados a categoria. Keyless, cache-friendly.
const WATCH = {
  espaco: ["Lua", "Vénus", "Saturno"],
  corpo: ["Corpo_humano", "Cérebro"],
  animais: ["Polvo", "Tardígrado", "Corvo"],
  oceano: ["Oceano", "Fossa_das_Marianas"],
  historia: ["Cleópatra", "Pirâmides_de_Gizé", "Torre_Eiffel"],
  comida: ["Mel", "Banana"],
};

const TREND_KEYS = {
  espaco: ["lua", "marte", "nasa", "eclipse", "planeta", "universo", "astronom", "foguete", "spacex", "satelite"],
  corpo: ["saude", "cerebro", "coracao", "sono", "exercicio", "dieta", "medico", "dor"],
  animais: ["cachorro", "gato", "onca", "baleia", "tubarao", "animal", "pet", "cobra"],
  oceano: ["praia", "mar", "oceano", "tsunami", "navio", "pesca", "onda"],
  historia: ["egito", "piramide", "guerra", "imperio", "romano", "cleopatra", "historia", "nasa"],
  comida: ["receita", "bolo", "chocolate", "cafe", "pizza", "comida", "cozinha", "lanche"],
};

async function wikiViews(article) {
  const end = new Date();
  end.setDate(end.getDate() - 1);
  const start = new Date(end);
  start.setDate(start.getDate() - 7);
  const fmt = (d) => d.toISOString().slice(0, 10).replaceAll("-", "");
  const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/pt.wikipedia/all-access/user/${encodeURIComponent(article)}/daily/${fmt(start)}/${fmt(end)}`;
  const r = await fetch(url, {
    headers: { "User-Agent": "virallab-brief/0.1 (contacto: repo personal)" },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`wiki ${r.status}`);
  const j = await r.json();
  return (j.items || []).reduce((a, i) => a + (i.views || 0), 0);
}

async function trendsBR() {
  const r = await fetch("https://trends.google.com/trending/rss?geo=BR", {
    headers: { "User-Agent": "virallab-brief/0.1" },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`trends ${r.status}`);
  const xml = await r.text();
  const titles = [...xml.matchAll(/<title><!\[CDATA\[(.+?)\]\]><\/title>|<title>(.+?)<\/title>/g)]
    .map((m) => (m[1] || m[2] || "").toLowerCase())
    .filter((t) => t && !t.includes("google"));
  return titles;
}

function usedIds() {
  const p = resolve(ROOT, "data/used.jsonl");
  if (!existsSync(p)) return new Set();
  return new Set(
    readFileSync(p, "utf8").split("\n").filter(Boolean).slice(-60).map((l) => {
      try { return JSON.parse(l).factId; } catch { return ""; }
    })
  );
}

function pickWeighted(facts, scores, used) {
  const pool = facts.filter((f) => !used.has(f.id));
  const list = pool.length ? pool : facts; // si se agota, reciclar
  const weights = list.map((f) => scores[f.category] || 1);
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < list.length; i++) {
    r -= weights[i];
    if (r <= 0) return list[i];
  }
  return list[list.length - 1];
}

export async function buildBrief() {
  const facts = JSON.parse(readFileSync(resolve(ROOT, "data/facts.json"), "utf8"));
  const scores = { espaco: 1, corpo: 1, animais: 1, oceano: 1, historia: 1, comida: 1 };
  const signals = { wiki: {}, trends: [] };

  // 1) Wikipedia PT: volumen de curiosidad por categoria
  try {
    for (const [cat, articles] of Object.entries(WATCH)) {
      let sum = 0;
      for (const a of articles) {
        try { sum += await wikiViews(a); } catch {}
      }
      signals.wiki[cat] = sum;
      if (sum > 20000) scores[cat] += 0.5;
      if (sum > 80000) scores[cat] += 0.5;
    }
  } catch { /* offline: base scores */ }

  // 2) Google Trends BR: hits por keyword
  try {
    const titles = await trendsBR();
    signals.trends = titles.slice(0, 10);
    for (const [cat, keys] of Object.entries(TREND_KEYS)) {
      const hits = titles.filter((t) => keys.some((k) => t.includes(k))).length;
      if (hits > 0) scores[cat] += 0.5 * hits;
    }
  } catch { /* offline: base scores */ }

  // 3) Elegir hecho: ponderado por categoria, sin repetir recientes
  const fact = pickWeighted(facts, scores, usedIds());
  const brief = { date: today(), lang: config.lang, regionCode: config.regionCode, scores, signals, fact };
  mkdirSync(resolve(ROOT, "data"), { recursive: true });
  writeFileSync(resolve(ROOT, `data/brief-${brief.date}.json`), JSON.stringify(brief, null, 2));
  // append al log de tendencias (fuente de verdad append-only)
  writeFileSync(resolve(ROOT, "data/trends.jsonl"), JSON.stringify({ date: brief.date, scores, trends: signals.trends }) + "\n", { flag: "a" });
  return brief;
}

if (import.meta.url === `file://${process.argv[1].replaceAll("\\", "/")}`) {
  const b = await buildBrief();
  console.log(JSON.stringify({ date: b.date, scores: b.scores, fact: b.fact.id }, null, 2));
}
