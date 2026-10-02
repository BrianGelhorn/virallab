// Instagram Reels via Instagram Login (sin Facebook Page).
// video_url debe ser publico: se reutiliza el file_id de Telegram (getFile -> URL directa).
// Container expira en 24h: publicar = crear + esperar FINISHED + media_publish en una pasada.
import { config, loadEnv } from "../lib/config.mjs";
import { alreadyPublished, markPublished } from "../lib/publish-state.mjs";

const G = "https://graph.instagram.com/v21.0";
const ENV = loadEnv();

function creds() {
  const token = ENV.IG_ACCESS_TOKEN;
  const userId = ENV.IG_USER_ID;
  if (!token || !userId)
    throw new Error("Instagram no configurado: falta IG_ACCESS_TOKEN/IG_USER_ID en .env (ver README fase F0)");
  return { token, userId };
}

async function g(path, { method = "GET", params = {} } = {}) {
  const { token } = creds();
  const url = new URL(`${G}${path}`);
  url.searchParams.set("access_token", token);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url, { method, signal: AbortSignal.timeout(60000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(`instagram ${path}: ${j.error?.message || r.status}`);
  return j;
}

async function waitFinished(containerId, tries = 20) {
  for (let i = 0; i < tries; i++) {
    const s = await g(`/${containerId}`, { params: { fields: "status_code" } });
    if (s.status_code === "FINISHED") return true;
    if (s.status_code === "ERROR") throw new Error("instagram: container ERROR (video rechazado)");
    await new Promise((r) => setTimeout(r, 15000));
  }
  throw new Error("instagram: container no llego a FINISHED en 5min");
}

export async function publish(videoId, { videoUrl, caption }) {
  const prev = alreadyPublished(videoId, "instagram");
  if (prev) return { ok: true, cached: true, ...prev };
  if (!config.publishEnabled) return { ok: false, reason: "dry-run: PUBLISH_ENABLED=false" };
  if (!videoUrl) return { ok: false, reason: "instagram necesita videoUrl publico (Telegram file)" };
  const { userId } = creds();
  const c = await g(`/${userId}/media`, {
    method: "POST",
    params: { media_type: "REELS", video_url: videoUrl, caption: caption.slice(0, 2200), share_to_feed: "true" },
  });
  await waitFinished(c.id);
  const p = await g(`/${userId}/media_publish`, { method: "POST", params: { creation_id: c.id } });
  const info = { platformId: p.id, url: `https://instagram.com/reel/${p.id}/` };
  markPublished(videoId, "instagram", info);
  return { ok: true, ...info };
}

export async function getStats(mediaId) {
  const j = await g(`/${mediaId}/insights`, {
    params: { metric: "plays,reach,likes,comments,saves,shares,total_interactions" },
  });
  const m = Object.fromEntries((j.data || []).map((d) => [d.name, d.values?.[0]?.value ?? 0]));
  return {
    views: m.plays || 0,
    reach: m.reach || 0,
    likes: m.likes || 0,
    comments: m.comments || 0,
    saves: m.saves || 0,
    shares: m.shares || 0,
    avgViewPct: null, // IG no expone retencion por API: se aproxima con plays/reach
  };
}
