// Publicar: lee la cola, respeta aprobacion (o auto-aprueba a las 24h), publica idempotente.
// Uso: node jobs/publish.mjs [YYYY-MM-DD]
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { config , isMain} from "../lib/config.mjs";
import * as yt from "../platform/youtube.mjs";
import * as ig from "../platform/instagram.mjs";
import * as fb from "../platform/facebook.mjs";

const ROOT = config.root;

function loadQueue(day) {
  const p = resolve(ROOT, `state/queue/${day}.json`);
  if (!existsSync(p)) throw new Error(`sin cola para ${day}`);
  return JSON.parse(readFileSync(p, "utf8"));
}
function saveQueue(day, q) {
  writeFileSync(resolve(ROOT, `state/queue/${day}.json`), JSON.stringify(q, null, 2));
}

function isApproved(video, queueDate) {
  if (video.status === "approved" || video.status === "published") return true;
  if (video.status === "skipped") return false;
  // auto-aprobacion por silencio
  const ageH = (Date.now() - new Date(queueDate + "T05:00:00Z").getTime()) / 36e5;
  if (ageH >= config.autoPublishAfterHours) {
    video.approvals.auto = true;
    return true;
  }
  return false;
}

export async function publishDay(day) {
  const q = loadQueue(day);
  const out = [];
  for (const v of q.videos) {
    if (!isApproved(v, q.date)) {
      out.push({ id: v.id, skipped: "sin aprobacion aun" });
      continue;
    }
    if (v.id !== `${day}-01`) continue; // v1: 1 video/dia
    const file = resolve(ROOT, `out/drafts/${v.id}.mp4`);
    if (!existsSync(file)) {
      out.push({ id: v.id, error: "sin render" });
      continue;
    }
    const caption = `${v.PUNCH}\n\n${v.CAPTION}`;
    const title = v.HOOK.slice(0, 100);
    v.published = v.published || {};

    // YouTube: subir unlisted, luego hacer publico (asi el approve tiene efecto real)
    try {
      if (!v.published.youtube) {
        const r = await yt.publish(v.id, file, { title, description: caption });
        v.published.youtube = r;
        if (r.ok && !r.cached && r.platformId) await yt.setPublic(r.platformId);
      }
    } catch (e) { v.published.youtube = { ok: false, error: String(e.message || e).slice(0, 150) }; }

    // Instagram: necesita URL publica (viene del flujo de Telegram)
    try {
      if (!v.published.instagram) {
        const r = await ig.publish(v.id, { videoUrl: v.telegramFileUrl || "", caption });
        v.published.instagram = r;
      }
    } catch (e) { v.published.instagram = { ok: false, error: String(e.message || e).slice(0, 150) }; }

    // Facebook
    try {
      if (!v.published.facebook) {
        const r = await fb.publish(v.id, file, { description: caption });
        v.published.facebook = r;
      }
    } catch (e) { v.published.facebook = { ok: false, error: String(e.message || e).slice(0, 150) }; }

    v.status = Object.values(v.published).some((p) => p && p.ok && p.platformId)
      ? "published"
      : "approved"; // en seco queda approved: metrics lo saltea hasta publicar de verdad
    out.push({ id: v.id, published: v.published });
  }
  saveQueue(day, q);
  return out;
}

if (isMain(import.meta.url)) {
  const day = process.argv[2] || new Date().toISOString().slice(0, 10);
  console.log(JSON.stringify(await publishDay(day), null, 2));
}
