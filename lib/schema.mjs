// Contrato del guion: lo unico que el cerebro (LLM) produce.
// Todo lo demas (render, publish, metricas) consume este schema validado.

export const FIELDS = ["HOOK", "SETUP", "REVEAL", "PUNCH", "CAPTION"];
export const RANK_FIELDS = ["HOOK", "C3", "C2", "C1", "PUNCH", "CAPTION"];
export const FORMATS = ["quiz_reveal", "fact_twist", "ranking"];

const LIMITS = { HOOK: 70, SETUP: 100, REVEAL: 110, C3: 100, C2: 100, C1: 100, PUNCH: 70, CAPTION: 220 };

// Aperturas muertas: el operador las veta. Un hook que empieza asi se rechaza y reintenta.
const BANNED_OPENINGS = [
  "voce sabia",
  "você sabia",
  "sabias que",
  "sabías que",
  "fato curioso",
  "curiosidade:",
  "oi ",
  "olá",
  "ola ",
];

export function hookAlive(hook) {
  const h = hook.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  return !BANNED_OPENINGS.some((b) => h.startsWith(b));
}

// Anti-deriva: el guion debe compartir palabras significativas con el hecho fuente.
// Sin esto el modelo a veces cambia de tema (recibio Luna, escribio del pulpo).
const words = (t) =>
  new Set(
    (t || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((w) => w.length >= 4)
  );

export function factOverlap(scriptText, factText, minShared = 2) {
  const a = words(scriptText);
  const b = words(factText);
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared >= minShared;
}

export function parseScriptText(text) {
  const pick = (k) => {
    const m = text.match(new RegExp(`^${k}:\\s*(.+)$`, "im"));
    return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
  };
  const out = { FORMAT: (pick("FORMAT") || "quiz_reveal").trim() };
  for (const f of [...new Set([...FIELDS, ...RANK_FIELDS])]) out[f] = pick(f);
  return out;
}

export function validateScript(s) {
  const errors = [];
  if (!FORMATS.includes(s.FORMAT)) errors.push(`FORMAT invalido: ${s.FORMAT}`);
  const need = s.FORMAT === "ranking" ? RANK_FIELDS : FIELDS;
  for (const f of need) {
    if (!s[f]) errors.push(`${f} vacio`);
    else if (s[f].length > LIMITS[f]) errors.push(`${f} excede ${LIMITS[f]} chars (${s[f].length})`);
  }
  // CAPTION debe terminar con pregunta + hashtags (contrato de distribucion)
  if (s.CAPTION && !/#\w/.test(s.CAPTION)) errors.push("CAPTION sin hashtags");
  if (s.HOOK && !hookAlive(s.HOOK)) errors.push("HOOK muerto (apertura baneada)");
  return { ok: errors.length === 0, errors };
}

// Score unificado por video. Pondera retencion (solo YouTube la da real),
// interaccion y conversion a follows. Todo lo calcula Node, nunca el LLM.
export function scoreVideo(m) {
  const views = Math.max(1, m.views || 0);
  const retention = clamp01(m.avgViewPct ?? m.watchRatio ?? 0);
  const engage =
    ((m.shares || 0) + 0.5 * (m.saves || 0) + 0.25 * (m.comments || 0) + 0.1 * (m.likes || 0)) /
    views;
  const followRate = (m.follows || 0) / views;
  return round3(0.5 * retention + 0.3 * Math.min(1, engage * 4) + 0.2 * Math.min(1, followRate * 40));
}

const clamp01 = (x) => Math.min(1, Math.max(0, Number(x) || 0));
const round3 = (x) => Math.round(x * 1000) / 1000;

// Regla anti-autoengano: un knob solo cambia con evidencia suficiente.
// n>=8 por lado y diferencia >30%. Si no, seguir explorando.
export function significant(a, b, minN = 8, minGap = 0.3) {
  if (a.n < minN || b.n < minN) return { change: false, why: `muestras insuficientes (${a.n},${b.n}<${minN})` };
  if (a.n === 0 || b.n === 0) return { change: false, why: "sin datos" };
  const gap = (b.median - a.median) / Math.max(1e-9, Math.abs(a.median));
  if (Math.abs(gap) <= minGap)
    return { change: false, why: `diferencia ${(gap * 100).toFixed(0)}% <= ${(minGap * 100).toFixed(0)}%` };
  return { change: true, why: `diferencia ${(gap * 100).toFixed(0)}% con n=${a.n},${b.n}` };
}

export function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
