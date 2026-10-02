// Stock Pexels: video real vertical como fondo. Sin key: {ok:false} y el render usa gradiente.
// Regla anti-repeticion: no reutilizar un clip en 30 dias (politica Meta "original content").
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { config, loadEnv } from "./config.mjs";

const ROOT = config.root;
const ENV = loadEnv();
const API = "https://api.pexels.com";

// Queries en ingles (el search de Pexels rinde mejor). Por categoria, en orden de intento.
export const QUERIES = {
  espaco: ["galaxy stars night", "nebula space", "moon night sky"],
  corpo: ["human eye macro", "human hands", "running sport"],
  animais: ["octopus underwater", "wild animals", "birds flying"],
  oceano: ["ocean waves underwater", "sea turtle diving", "ocean surface"],
  historia: ["egypt pyramids", "ancient rome", "eiffel tower paris"],
  comida: ["honey dripping", "cooking food", "fruits market"],
};
const FALLBACK_QUERY = "dark abstract background";

async function searchVideos(query, perPage = 5) {
  const r = await fetch(`${API}/videos/search?query=${encodeURIComponent(query)}&orientation=portrait&per_page=${perPage}`, {
    headers: { Authorization: ENV.PEXELS_API_KEY || "" },
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`pexels videos ${r.status}`);
  return (await r.json()).videos || [];
}

async function searchPhotos(query, perPage = 3) {
  const r = await fetch(`${API}/v1/search?query=${encodeURIComponent(query)}&orientation=portrait&per_page=${perPage}`, {
    headers: { Authorization: ENV.PEXELS_API_KEY || "" },
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`pexels photos ${r.status}`);
  return (await r.json()).photos || [];
}

// Elige el mejor archivo: prefiere vertical real, si no el de mayor altura.
export function pickVideoFile(video) {
  const files = (video.video_files || []).filter((f) => f.link);
  if (!files.length) return null;
  const portrait = files.filter((f) => f.height > f.width).sort((a, b) => b.height - a.height);
  const best = portrait[0] || [...files].sort((a, b) => b.height - a.height)[0];
  return { url: best.link, width: best.width, height: best.height };
}

function usedIds(days = 30) {
  const p = resolve(ROOT, "data/stock-used.jsonl");
  if (!existsSync(p)) return new Set();
  const cutoff = Date.now() - days * 864e5;
  const ids = new Set();
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (new Date(e.date).getTime() >= cutoff && e.pexelsId) ids.add(String(e.pexelsId));
    } catch {}
  }
  return ids;
}

function logUse(pexelsId, query, kind) {
  mkdirSync(resolve(ROOT, "data"), { recursive: true });
  writeFileSync(
    resolve(ROOT, "data/stock-used.jsonl"),
    JSON.stringify({ date: new Date().toISOString().slice(0, 10), pexelsId: String(pexelsId), query, kind }) + "\n",
    { flag: "a" }
  );
}

async function download(url, dest) {
  const r = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!r.ok) throw new Error(`descarga stock ${r.status}`);
  mkdirSync(resolve(dest, ".."), { recursive: true });
  writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
  return dest;
}

// Punto de entrada: devuelve {ok, kind:'video'|'photo', path} o {ok:false, reason}.
export async function fetchBackground(category) {
  if (!ENV.PEXELS_API_KEY) return { ok: false, reason: "sin PEXELS_API_KEY" };
  const used = usedIds();
  const queries = [...(QUERIES[category] || []), FALLBACK_QUERY];
  // 1) video vertical no usado
  for (const q of queries) {
    try {
      const videos = await searchVideos(q);
      const fresh = videos.filter((v) => !used.has(String(v.id)) && pickVideoFile(v));
      const pick = fresh[0] || videos.filter((v) => pickVideoFile(v))[0];
      if (!pick) continue;
      const file = pickVideoFile(pick);
      const dest = resolve(ROOT, `out/tmp/stock-${pick.id}.mp4`);
      if (!existsSync(dest)) await download(file.url, dest);
      logUse(pick.id, q, "video");
      return { ok: true, kind: "video", path: dest, pexelsId: pick.id };
    } catch {}
  }
  // 2) foto con movimiento (Ken Burns en render)
  for (const q of queries) {
    try {
      const photos = await searchPhotos(q);
      const fresh = photos.filter((p) => !used.has(String(p.id)));
      const pick = fresh[0] || photos[0];
      if (!pick) continue;
      const url = pick.src?.large || pick.src?.original;
      if (!url) continue;
      const dest = resolve(ROOT, `out/tmp/stock-${pick.id}.jpg`);
      if (!existsSync(dest)) await download(url, dest);
      logUse(pick.id, q, "photo");
      return { ok: true, kind: "photo", path: dest, pexelsId: pick.id };
    } catch {}
  }
  return { ok: false, reason: "pexels sin resultados" };
}
