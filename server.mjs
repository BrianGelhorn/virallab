// server.mjs: webhook Telegram (aprobar con 1 toque) + API JSON para el dashboard.
// Sin TELEGRAM_BOT_TOKEN: la API del dashboard sigue funcionando, Telegram no.
// Uso: node server.mjs [puerto=3100]
import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, join, extname } from "node:path";
import { config , isMain} from "./lib/config.mjs";

const ROOT = config.root;
const PORT = Number(process.argv[2] || 3100);
const TG = config.telegramBotToken
  ? `https://api.telegram.org/bot${config.telegramBotToken}`
  : "";
const CHAT = config.telegramChatId;

async function tg(method, body, isForm = false) {
  if (!TG) throw new Error("telegram no configurado");
  const r = await fetch(`${TG}/${method}`, isForm ? { method: "POST", body } : {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(`telegram ${method}: ${j.description || r.status}`);
  return j.result;
}

function loadQueue(day) {
  const p = resolve(ROOT, `state/queue/${day}.json`);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
}
function saveQueue(day, q) {
  writeFileSync(resolve(ROOT, `state/queue/${day}.json`), JSON.stringify(q, null, 2));
}

// Manda el video + botones. Guarda telegramFileUrl (URL publica para Instagram).
export async function notify(day) {
  const q = loadQueue(day);
  if (!q) throw new Error(`sin cola ${day}`);
  const v = q.videos[0];
  const form = new FormData();
  form.set("chat_id", CHAT);
  form.set("caption", `🎬 ${day} · ${q.category}\n\n${v.HOOK}\n\n${v.CAPTION}`.slice(0, 1000));
  form.set(
    "reply_markup",
    JSON.stringify({ inline_keyboard: [[{ text: "✅ Aprobar", callback_data: `ok:${day}` }, { text: "⏭ Saltar", callback_data: `no:${day}` }]] })
  );
  form.set("video", new Blob([readFileSync(resolve(ROOT, `out/drafts/${v.id}.mp4`))], { type: "video/mp4" }), `${v.id}.mp4`);
  const sent = await tg("sendVideo", form, true);
  const fileId = sent.video?.file_id;
  if (fileId) {
    const f = await tg("getFile", { file_id: fileId });
    v.telegramFileUrl = `https://api.telegram.org/file/bot${config.telegramBotToken}/${f.file_path}`;
    saveQueue(day, q);
  }
  return { ok: true, fileId: fileId || null };
}

async function onCallback(q, day, approve) {
  const v = q.videos[0];
  if (approve) {
    v.status = "approved";
    v.approvals.telegram = true;
  } else {
    v.status = "skipped";
  }
  saveQueue(day, q);
  await tg("sendMessage", {
    chat_id: CHAT,
    text: approve ? `✅ ${day} aprobado. Se publica en la próxima pasada.` : `⏭ ${day} saltado.`,
  });
}

function json(res, obj, code = 200) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

function dashboardApi(path) {
  if (path === "/api/status")
    return {
      publishEnabled: config.publishEnabled,
      postsPerDay: config.postsPerDay,
      model: config.brainModel,
      hooks: existsSync(resolve(ROOT, "state/hooks.json"))
        ? JSON.parse(readFileSync(resolve(ROOT, "state/hooks.json"), "utf8"))
        : null,
    };
  if (path === "/api/queue") {
    const qdir = resolve(ROOT, "state/queue");
    if (!existsSync(qdir)) return [];
    return readdirSync(qdir)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .slice(-14)
      .map((f) => JSON.parse(readFileSync(resolve(ROOT, "state/queue", f), "utf8")));
  }
  if (path === "/api/metrics") {
    const p = resolve(ROOT, "data/metrics.jsonl");
    if (!existsSync(p)) return [];
    return readFileSync(p, "utf8")
      .split("\n").filter(Boolean).slice(-100)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  }
  return null;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    // webhook telegram
    if (req.method === "POST" && url.pathname === "/telegram") {
      let raw = "";
      for await (const c of req) raw += c;
      const upd = JSON.parse(raw);
      const cb = upd.callback_query;
      if (cb) {
        const [action, day] = (cb.data || "").split(":");
        const q = loadQueue(day);
        if (q) await onCallback(q, day, action === "ok");
        await tg("answerCallbackQuery", { callback_query_id: cb.id });
      }
      const msg = upd.message?.text?.trim() || "";
      if (msg === "/status" && CHAT)
        await tg("sendMessage", { chat_id: CHAT, text: JSON.stringify(dashboardApi("/api/status"), null, 1).slice(0, 900) });
      return json(res, { ok: true });
    }
    // notificar (lo llama n8n tras daily)
    if (req.method === "POST" && url.pathname === "/notify") {
      let raw = "";
      for await (const c of req) raw += c;
      const { day } = JSON.parse(raw);
      return json(res, await notify(day));
    }
    // api dashboard
    if (url.pathname.startsWith("/api/")) {
      const d = dashboardApi(url.pathname);
      return d ? json(res, d) : json(res, { error: "not found" }, 404);
    }
    // estaticos del dashboard
    let fp = join(ROOT, "dashboard", url.pathname === "/" ? "index.html" : url.pathname.slice(1));
    if (!fp.startsWith(join(ROOT, "dashboard")) || !existsSync(fp) || !extname(fp))
      return json(res, { error: "not found" }, 404);
    const ct = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" }[extname(fp)] || "text/plain";
    res.writeHead(200, { "Content-Type": ct });
    res.end(readFileSync(fp));
  } catch (e) {
    json(res, { ok: false, error: String(e.message || e).slice(0, 200) }, 500);
  }
});

if (isMain(import.meta.url)) {
  server.listen(PORT, () => console.log(`virallab server en :${PORT}`));
}
export { server };
