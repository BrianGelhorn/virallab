// Metricas: lee publicados, jala stats por plataforma, calcula score, append a metrics.jsonl.
// YouTube Analytics tarda 48-72h: avgViewPct null es normal en videos jovenes.
// Uso: node jobs/metrics.mjs [YYYY-MM-DD]
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { config , isMain} from "../lib/config.mjs";
import { scoreVideo } from "../lib/schema.mjs";
import * as yt from "../platform/youtube.mjs";
import * as ig from "../platform/instagram.mjs";
import * as fb from "../platform/facebook.mjs";

const ROOT = config.root;

export async function collectDay(day) {
  const qp = resolve(ROOT, `state/queue/${day}.json`);
  if (!existsSync(qp)) return { day, skipped: "sin cola" };
  const q = JSON.parse(readFileSync(qp, "utf8"));
  const rows = [];
  for (const v of q.videos) {
    if (v.status !== "published" || !v.published) continue;
    const m = { date: new Date().toISOString(), videoId: v.id, format: v.format, category: q.category, platforms: {} };
    if (v.published.youtube?.platformId) {
      try { m.platforms.youtube = await yt.getStats(v.published.youtube.platformId); }
      catch (e) { m.platforms.youtube = { error: String(e.message || e).slice(0, 120) }; }
    }
    if (v.published.instagram?.platformId) {
      try { m.platforms.instagram = await ig.getStats(v.published.instagram.platformId); }
      catch (e) { m.platforms.instagram = { error: String(e.message || e).slice(0, 120) }; }
    }
    if (v.published.facebook?.platformId) {
      try { m.platforms.facebook = await fb.getStats(v.published.facebook.platformId); }
      catch (e) { m.platforms.facebook = { error: String(e.message || e).slice(0, 120) }; }
    }
    // score agregado: YouTube manda (unica retencion real); si no hay, proxies de IG
    const y = m.platforms.youtube || {};
    const i = m.platforms.instagram || {};
    m.score = scoreVideo({
      views: (y.views || 0) + (i.views || 0),
      avgViewPct: y.avgViewPct ?? (i.views && i.reach ? Math.min(1, i.views / Math.max(1, i.reach)) : 0),
      likes: (y.likes || 0) + (i.likes || 0),
      comments: (y.comments || 0) + (i.comments || 0),
      shares: (i.shares || 0),
      saves: (i.saves || 0),
      follows: 0,
    });
    rows.push(m);
  }
  if (rows.length) {
    writeFileSync(
      resolve(ROOT, "data/metrics.jsonl"),
      rows.map((r) => JSON.stringify(r)).join("\n") + "\n",
      { flag: "a" }
    );
  }
  return { day, rows: rows.length, scores: rows.map((r) => ({ id: r.videoId, score: r.score })) };
}

if (isMain(import.meta.url)) {
  const day = process.argv[2] || new Date().toISOString().slice(0, 10);
  console.log(JSON.stringify(await collectDay(day), null, 2));
}
