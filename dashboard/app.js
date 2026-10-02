// Dashboard: lee /api/* del server.mjs. Sin dependencias, canvas puro.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function get(path) {
  try {
    const r = await fetch(path);
    if (!r.ok) throw new Error(r.status);
    return await r.json();
  } catch (e) {
    return { _error: String(e.message || e) };
  }
}

function line(canvas, series, opts = {}) {
  const c = canvas, ctx = c.getContext("2d");
  const W = (c.width = c.offsetWidth * 2), H = (c.height = 360);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#8b949e";
  ctx.font = "22px system-ui";
  if (!series.length) {
    ctx.fillText("sin datos aún — el primer video genera el primer punto", 24, H / 2);
    return;
  }
  const max = Math.max(...series.map((s) => s.y), 1);
  const px = (i) => 50 + (i * (W - 70)) / Math.max(1, series.length - 1);
  const py = (v) => H - 30 - (v / max) * (H - 70);
  ctx.strokeStyle = "#2a3340";
  ctx.beginPath(); ctx.moveTo(50, 10); ctx.lineTo(50, H - 30); ctx.lineTo(W - 20, H - 30); ctx.stroke();
  ctx.strokeStyle = opts.color || "#ffd166";
  ctx.lineWidth = 4;
  ctx.beginPath();
  series.forEach((s, i) => (i ? ctx.lineTo(px(i), py(s.y)) : ctx.moveTo(px(i), py(s.y))));
  ctx.stroke();
  ctx.fillStyle = opts.color || "#ffd166";
  series.forEach((s, i) => { ctx.beginPath(); ctx.arc(px(i), py(s.y), 7, 0, 7); ctx.fill(); });
  ctx.fillStyle = "#8b949e";
  series.forEach((s, i) => { if (i % Math.ceil(series.length / 8) === 0) ctx.fillText(s.x, px(i) - 10, H - 8); });
}

function bars(canvas, groups) {
  const c = canvas, ctx = c.getContext("2d");
  const W = (c.width = c.offsetWidth * 2), H = (c.height = 360);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#8b949e";
  ctx.font = "22px system-ui";
  if (!groups.length) {
    ctx.fillText("sin datos aún", 24, H / 2);
    return;
  }
  const colors = { youtube: "#f85149", instagram: "#d946ef", facebook: "#4493f8" };
  const max = Math.max(...groups.flatMap((g) => Object.values(g.v)), 1);
  const bw = (W - 60) / groups.length;
  groups.forEach((g, i) => {
    let y = H - 30;
    for (const [p, val] of Object.entries(g.v)) {
      const h = (val / max) * (H - 70);
      ctx.fillStyle = colors[p] || "#8b949e";
      ctx.fillRect(50 + i * bw + 6, y - h, bw / 3.4, h);
      y -= h;
    }
    ctx.fillStyle = "#8b949e";
    ctx.fillText(g.x.slice(5), 50 + i * bw + 6, H - 8);
  });
  let lx = 60;
  for (const [p, col] of Object.entries(colors)) {
    ctx.fillStyle = col; ctx.fillRect(lx, 16, 22, 22);
    ctx.fillStyle = "#8b949e"; ctx.fillText(p, lx + 28, 34);
    lx += 150;
  }
}

function rankTable(id, obj) {
  const t = $(id);
  const rows = Object.entries(obj || {}).sort((a, b) => b[1].median - a[1].median);
  if (!rows.length) {
    t.innerHTML += `<tr><td colspan="3" class="note">sin datos</td></tr>`;
    return;
  }
  for (const [k, v] of rows)
    t.innerHTML += `<tr class="${v.n >= 8 ? "evidence" : ""}"><td>${esc(k)}</td><td>${v.n}</td><td>${v.median}</td></tr>`;
}

async function main() {
  const [status, queue, metrics] = await Promise.all([get("/api/status"), get("/api/queue"), get("/api/metrics")]);
  $("sub").textContent = `modelo: ${status.model || "?"} · zona BR · ${new Date().toLocaleString("es-UY")}`;

  const rows = Array.isArray(metrics) ? metrics : [];
  const last7 = rows.filter((r) => Date.now() - new Date(r.date).getTime() < 7 * 864e5);
  const avg = last7.length ? (last7.reduce((a, r) => a + r.score, 0) / last7.length).toFixed(3) : "—";
  $("status").innerHTML = `
    <div class="card"><b><span class="badge ${status.publishEnabled ? "on" : "off"}">${status.publishEnabled ? "PUBLICANDO" : "MODO SECO"}</span></b><span>publicación</span></div>
    <div class="card"><b>${status.hooks?.totalVideos ?? 0}</b><span>videos medidos</span></div>
    <div class="card"><b>${avg}</b><span>score medio 7d</span></div>
    <div class="card"><b>${(Array.isArray(queue) ? queue : []).filter((q) => q.videos?.[0]?.status === "draft").length}</b><span>pendientes de aprobar</span></div>`;

  line($("ch-score"), rows.map((r) => ({ x: (r.date || "").slice(0, 10), y: r.score })));
  bars($("ch-views"), rows.map((r) => ({
    x: (r.date || "").slice(0, 10),
    v: {
      youtube: r.platforms?.youtube?.views || 0,
      instagram: r.platforms?.instagram?.views || 0,
      facebook: r.platforms?.facebook?.views || 0,
    },
  })));

  rankTable("rank-fmt", status.hooks?.formats);
  rankTable("rank-cat", status.hooks?.categories);

  const q = $("queue");
  const list = Array.isArray(queue) ? queue.slice().reverse() : [];
  if (!list.length) q.innerHTML += `<tr><td colspan="7" class="note">sin cola aún — corre el daily</td></tr>`;
  for (const day of list) {
    const v = day.videos?.[0] || {};
    const plat = ["youtube", "instagram", "facebook"]
      .map((p) => {
        const s = v.published?.[p];
        if (!s) return `${p}: —`;
        if (s.ok) return `${p}: <span class="ok">ok</span>`;
        return `${p}: <span class="err" title="${esc(s.error || s.reason || "")}">fallo</span>`;
      })
      .join("<br>");
    const meta = v.duration != null
      ? `${Number(v.duration).toFixed(1)}s · ${v.tts ? '<span class="ok">tts</span>' : '<span class="err">sin tts</span>'}`
      : "—";
    q.innerHTML += `<tr><td>${esc(day.date)}</td><td>${esc((v.HOOK || "").slice(0, 70))}</td><td>${esc(v.format || "")}</td><td>${esc(day.category || "")}</td><td class="st st-${v.status || "draft"}">${esc(v.status || "draft")}</td><td class="meta">${meta}</td><td class="plat">${plat}</td></tr>`;
  }
  for (const e of [status, queue, metrics])
    if (e && e._error) $("sub").innerHTML += ` <span class="err-box">[api: ${esc(e._error)}]</span>`;
}
main();
