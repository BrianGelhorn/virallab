// YouTube Shorts: upload resumable + publish + stats.
// Sin credenciales: {ok:false, reason}. PUBLISH_ENABLED=false: dry-run, no llama a la API.
import { readFileSync, statSync } from "node:fs";
import { config, loadEnv } from "../lib/config.mjs";
import { alreadyPublished, markPublished } from "../lib/publish-state.mjs";

const API = "https://www.googleapis.com/youtube/v3";
const UPLOAD = "https://www.googleapis.com/upload/youtube/v3/videos";
const ANALYTICS = "https://youtubeanalytics.googleapis.com/v2/reports";
const ENV = loadEnv();

let cached = null;
export async function accessToken() {
  if (cached && cached.exp > Date.now() + 60000) return cached.token;
  const { clientId, clientSecret } = { clientId: ENV.YT_CLIENT_ID, clientSecret: ENV.YT_CLIENT_SECRET };
  const refreshToken = ENV.YT_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken)
    throw new Error("YouTube no configurado: falta YT_CLIENT_ID/SECRET/REFRESH_TOKEN en .env (ver README fase F0)");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`youtube oauth ${r.status}: ${(await r.text()).slice(0, 150)}`);
  const j = await r.json();
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return cached.token;
}

async function api(path, { method = "GET", token, body, query = "" } = {}) {
  const r = await fetch(`${API}${path}${query}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`youtube ${path} ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  return j;
}

// Upload resumable en 3 pasos. privacy: private|unlisted|public.
// containsSyntheticMedia:true siempre: nuestro contenido es sintetico y YouTube lo exige.
export async function uploadShort({ file, title, description, privacy = "unlisted" }) {
  const token = await accessToken();
  const size = statSync(file).size;
  const meta = {
    snippet: { title: title.slice(0, 100), description: description.slice(0, 5000), categoryId: "27", defaultLanguage: "pt", defaultAudioLanguage: "pt-BR" },
    status: { privacyStatus: privacy, selfDeclaredMadeForKids: false, containsSyntheticMedia: true },
  };
  const init = await fetch(`${UPLOAD}?uploadType=resumable&part=snippet,status`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Length": String(size),
      "X-Upload-Content-Type": "video/mp4",
    },
    body: JSON.stringify(meta),
    signal: AbortSignal.timeout(30000),
  });
  if (!init.ok) throw new Error(`youtube init ${init.status}: ${(await init.text()).slice(0, 150)}`);
  const session = init.headers.get("location");
  const buf = readFileSync(file);
  const up = await fetch(session, {
    method: "PUT",
    headers: { "Content-Length": String(size), "Content-Type": "video/mp4" },
    body: buf,
    signal: AbortSignal.timeout(300000),
  });
  const j = await up.json().catch(() => ({}));
  if (!up.ok) throw new Error(`youtube upload ${up.status}: ${JSON.stringify(j).slice(0, 200)}`);
  return { videoId: j.id, url: `https://youtube.com/shorts/${j.id}` };
}

export async function setPublic(videoId) {
  const token = await accessToken();
  await api(`/videos?part=status`, {
    method: "PUT", token,
    body: { id: videoId, status: { privacyStatus: "public" } },
  });
  return true;
}

// Stats publicas + retencion (Analytics tiene 48-72h de delay: null si no hay datos aun).
export async function getStats(videoId) {
  const token = await accessToken();
  const v = await api(`/videos?part=statistics,contentDetails&id=${videoId}`, { token });
  const st = v.items?.[0]?.statistics || {};
  let avgViewPct = null;
  try {
    const end = new Date();
    end.setDate(end.getDate() - 2); // ultimo dia procesado
    const start = new Date(end);
    start.setDate(start.getDate() - 30);
    const fmt = (d) => d.toISOString().slice(0, 10);
    const r = await fetch(
      `${ANALYTICS}?ids=channel==MINE&startDate=${fmt(start)}&endDate=${fmt(end)}&metrics=views,averageViewPercentage,likes,comments,shares&dimensions=video&filters=video==${videoId}`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) }
    );
    if (r.ok) {
      const j = await r.json();
      const row = j.rows?.[0];
      if (row) avgViewPct = (row[1] ?? null) != null ? row[1] / 100 : null;
    }
  } catch {}
  return {
    views: Number(st.viewCount || 0),
    likes: Number(st.likeCount || 0),
    comments: Number(st.commentCount || 0),
    shares: 0, // Data API no da shares; se aproxima con Analytics si hay
    avgViewPct,
  };
}

export async function publish(videoId, file, { title, description }) {
  const prev = alreadyPublished(videoId, "youtube");
  if (prev) return { ok: true, cached: true, ...prev };
  if (!config.publishEnabled) return { ok: false, reason: "dry-run: PUBLISH_ENABLED=false" };
  const up = await uploadShort({ file, title, description, privacy: "unlisted" });
  markPublished(videoId, "youtube", { platformId: up.videoId, url: up.url });
  return { ok: true, platformId: up.videoId, url: up.url };
}
