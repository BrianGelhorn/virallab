// Render del dia: lee state/queue/<hoy>.json, renderiza videos pendientes a out/drafts/.
// Uso: node jobs/render-day.mjs [YYYY-MM-DD]
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import { config , isMain} from "../lib/config.mjs";
import { renderVideo } from "./render.mjs";

const ROOT = config.root;

export async function renderDay(day) {
  const qp = resolve(ROOT, `state/queue/${day}.json`);
  if (!existsSync(qp)) throw new Error(`sin cola para ${day} (corre brain primero)`);
  const q = JSON.parse(readFileSync(qp, "utf8"));
  const outDir = resolve(ROOT, "out/drafts");
  mkdirSync(outDir, { recursive: true });
  const out = [];
  for (const v of q.videos) {
    const dest = resolve(outDir, `${v.id}.mp4`);
    if (existsSync(dest)) {
      out.push({ id: v.id, cached: true });
      continue;
    }
    const r = await renderVideo(q, v, outDir);
    if (r.video !== dest) renameSync(r.video, dest);
    const thumbDest = resolve(outDir, `${v.id}.jpg`);
    if (r.thumb !== thumbDest) renameSync(r.thumb, thumbDest);
    out.push({ id: v.id, duration: r.duration, tts: r.tts });
  }
  return out;
}

if (isMain(import.meta.url)) {
  const day = process.argv[2] || new Date().toISOString().slice(0, 10);
  console.log(JSON.stringify(await renderDay(day), null, 2));
}
