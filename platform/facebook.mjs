// Facebook Reels via Page: POST /{page-id}/video_reels (start -> upload -> finish PUBLISHED).
import { readFileSync, statSync } from "node:fs";
import { config, loadEnv } from "../lib/config.mjs";
import { alreadyPublished, markPublished } from "../lib/publish-state.mjs";

const G = "https://graph.facebook.com/v21.0";
const ENV = loadEnv();

function creds() {
  const token = ENV.FB_PAGE_TOKEN;
  const pageId = ENV.FB_PAGE_ID;
  if (!token || !pageId)
    throw new Error("Facebook no configurado: falta FB_PAGE_TOKEN/FB_PAGE_ID en .env (ver README fase F0)");
  return { token, pageId };
}

async function call(path, params, method = "POST") {
  const { token } = creds();
  const body = new URLSearchParams({ access_token: token, ...params });
  const r = await fetch(`${G}${path}`, { method, body, signal: AbortSignal.timeout(120000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(`facebook ${path}: ${j.error?.message || r.status}`);
  return j;
}

export async function publish(videoId, file, { description }) {
  const prev = alreadyPublished(videoId, "facebook");
  if (prev) return { ok: true, cached: true, ...prev };
  if (!config.publishEnabled) return { ok: false, reason: "dry-run: PUBLISH_ENABLED=false" };
  const { pageId } = creds();
  const size = statSync(file).size;
  const start = await call(`/${pageId}/video_reels`, { upload_phase: "start", file_size: String(size) });
  // subida binaria a upload_url con offsets
  const buf = readFileSync(file);
  let offset = 0;
  while (offset < size) {
    const chunk = buf.subarray(offset, Math.min(offset + 8 * 1024 * 1024, size));
    const r = await fetch(start.upload_url, {
      method: "POST",
      headers: {
        Authorization: `OAuth ${creds().token}`,
        "Content-Range": `bytes ${offset}-${offset + chunk.length - 1}/${size}`,
        "Content-Type": "application/octet-stream",
      },
      body: chunk,
      signal: AbortSignal.timeout(180000),
    });
    if (!r.ok) throw new Error(`facebook upload chunk ${r.status}`);
    offset += chunk.length;
  }
  const fin = await call(`/${pageId}/video_reels`, {
    upload_phase: "finish",
    video_id: start.video_id,
    video_state: "PUBLISHED",
    description: (description || "").slice(0, 2000),
  });
  const info = { platformId: fin.id || start.video_id, url: `https://facebook.com/reel/${fin.id || start.video_id}` };
  markPublished(videoId, "facebook", info);
  return { ok: true, ...info };
}

export async function getStats() {
  // FB Reels insights via Page son limitados por API; se registra lo disponible.
  return { views: 0, likes: 0, comments: 0, shares: 0, avgViewPct: null, note: "insights FB limitados por API" };
}
