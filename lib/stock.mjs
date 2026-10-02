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

// Wikimedia Commons: keyless, licencia CC (se registra autor para credito).
// filetype:video en namespace 6. ogv/webm: ffmpeg los lee, se re-encodea a H.264.
async function searchCommons(query, perPage = 5) {
  const H = { "User-Agent": "virallab-stock/0.1" };
  const s = await fetch(
    `https://commons.wikimedia.org/w/api.php?action=query&format=json&list=search&srsearch=${encodeURIComponent(query + " filetype:video")}&srnamespace=6&srlimit=${perPage}`,
    { headers: H, signal: AbortSignal.timeout(20000) }
  );
  if (!s.ok) throw new Error(`commons search ${s.status}`);
  const hits = ((await s.json()).query?.search || []).map((x) => x.title);
  const out = [];
  for (const t of hits.slice(0, 3)) {
    try {
      const q = await fetch(
        `https://commons.wikimedia.org/w/api.php?action=query&format=json&titles=${encodeURIComponent(t)}&prop=imageinfo&iiprop=url%7Csize%7Cmime%7Cextmetadata`,
        { headers: H, signal: AbortSignal.timeout(20000) }
      );
      if (!q.ok) continue;
      const pg = Object.values((await q.json()).query?.pages || {})[0];
      const ii = pg?.imageinfo?.[0];
      if (!ii?.url || !/^video\//.test(ii.mime || "") || (ii.size || 0) > 120 * 1024 * 1024) continue;
      out.push({
        id: `commons:${t.replace(/^File:/, "")}`,
        url: ii.url,
        title: t,
        artist: ii.extmetadata?.Artist?.value?.replace(/<[^>]+>/g, "").slice(0, 120) || "",
        license: ii.extmetadata?.LicenseShortName?.value || "",
      });
    } catch {}
  }
  return out;
}

// NASA Image/Video Library: keyless, ideal para espaco (y oceano visto desde orbita).
async function searchNasa(query) {
  const s = await fetch(`https://images-api.nasa.gov/search?q=${encodeURIComponent(query)}&media_type=video&page_size=4`, {
    signal: AbortSignal.timeout(20000),
  });
  if (!s.ok) throw new Error(`nasa search ${s.status}`);
  const items = (await s.json()).collection?.items || [];
  const out = [];
  for (const it of items.slice(0, 2)) {
    try {
      if (!it.href) continue;
      const col = await fetch(it.href, { signal: AbortSignal.timeout(20000) }).then((r) => r.json());
      const mp4 = (Array.isArray(col) ? col : []).find((u) => /~large\.mp4$/i.test(u)) || (Array.isArray(col) ? col : []).find((u) => /\.mp4$/i.test(u));
      if (!mp4) continue;
      out.push({ id: `nasa:${it.data?.[0]?.nasa_id || it.href}`, url: mp4.replace(/^http:/, "https:"), title: it.data?.[0]?.title || "" });
    } catch {}
  }
  return out;
}

const NASA_CATS = { espaco: ["galaxy stars", "earth from space"], oceano: ["ocean earth space"] };

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
      const id = e.source || (e.pexelsId != null ? `pexels:${e.pexelsId}` : "");
      if (new Date(e.date).getTime() >= cutoff && id) ids.add(String(id));
    } catch {}
  }
  return ids;
}

function logUse(source, query, kind, credit = "") {
  mkdirSync(resolve(ROOT, "data"), { recursive: true });
  writeFileSync(
    resolve(ROOT, "data/stock-used.jsonl"),
    JSON.stringify({ date: new Date().toISOString().slice(0, 10), source: String(source), query, kind, credit }) + "\n",
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
// Orden: Pexels (si hay key) -> NASA (espaco/oceano, keyless) -> Commons (keyless) -> gradiente.
export async function fetchBackground(category) {
  const used = usedIds();
  if (ENV.PEXELS_API_KEY) {
    const queries = [...(QUERIES[category] || []), FALLBACK_QUERY];
    // 1) video vertical no usado
    for (const q of queries) {
      try {
        const videos = await searchVideos(q);
        const fresh = videos.filter((v) => !used.has(`pexels:${v.id}`) && pickVideoFile(v));
        const pick = fresh[0] || videos.filter((v) => pickVideoFile(v))[0];
        if (!pick) continue;
        const file = pickVideoFile(pick);
        const dest = resolve(ROOT, `out/tmp/stock-pexels-${pick.id}.mp4`);
        if (!existsSync(dest)) await download(file.url, dest);
        logUse(`pexels:${pick.id}`, q, "video");
        return { ok: true, kind: "video", path: dest, source: `pexels:${pick.id}` };
      } catch {}
    }
    // 2) foto con movimiento (Ken Burns en render)
    for (const q of queries) {
      try {
        const photos = await searchPhotos(q);
        const fresh = photos.filter((p) => !used.has(`pexels:${p.id}`));
        const pick = fresh[0] || photos[0];
        if (!pick) continue;
        const url = pick.src?.large || pick.src?.original;
        if (!url) continue;
        const dest = resolve(ROOT, `out/tmp/stock-pexels-${pick.id}.jpg`);
        if (!existsSync(dest)) await download(url, dest);
        logUse(`pexels:${pick.id}`, q, "photo");
        return { ok: true, kind: "photo", path: dest, source: `pexels:${pick.id}` };
      } catch {}
    }
  }
  // 3) NASA keyless (espaco/oceano)
  for (const q of NASA_CATS[category] || []) {
    try {
      const vids = await searchNasa(q);
      const fresh = vids.filter((v) => !used.has(v.id));
      const pick = fresh[0] || vids[0];
      if (!pick) continue;
      const dest = resolve(ROOT, `out/tmp/stock-${pick.id.replace(/[:/]/g, "_")}.mp4`);
      if (!existsSync(dest)) await download(pick.url, dest);
      logUse(pick.id, q, "video");
      return { ok: true, kind: "video", path: dest, source: pick.id };
    } catch {}
  }
  // 4) Commons keyless (general)
  for (const q of [...(QUERIES[category] || []), FALLBACK_QUERY]) {
    try {
      const vids = await searchCommons(q);
      const fresh = vids.filter((v) => !used.has(v.id));
      const pick = fresh[0] || vids[0];
      if (!pick) continue;
      const dest = resolve(ROOT, `out/tmp/stock-${pick.id.replace(/[:/]/g, "_")}.mp4`);
      if (!existsSync(dest)) await download(pick.url, dest);
      logUse(pick.id, q, "video", pick.artist ? `${pick.artist} [${pick.license}]` : "");
      return { ok: true, kind: "video", path: dest, source: pick.id, credit: pick.artist };
    } catch {}
  }
  return { ok: false, reason: "sin stock disponible" };
}
