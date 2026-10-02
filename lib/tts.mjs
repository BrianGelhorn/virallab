// TTS ElevenLabs con presupuesto mensual duro y seleccion de modelo con fallback.
// Modelo: ELEVENLABS_TTS_MODEL (default eleven_v4). Si la API rechaza el model_id,
// cae a eleven_multilingual_v2 y lo deja registrado. Sin key o sin saldo: {ok:false}.
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { config, loadEnv } from "../lib/config.mjs";

const ROOT = config.root;
const ENV = loadEnv();
const FALLBACK_MODEL = "eleven_multilingual_v2";

export function monthKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Pool compartido de creditos mensuales (TTS ~1 credito/char, SFX 40/seg).
// Lee tts-usage.jsonl: {month, chars, sfxSeconds}
export function creditsUsedThisMonth() {
  const p = resolve(ROOT, "data/tts-usage.jsonl");
  if (!existsSync(p)) return { chars: 0, sfxSeconds: 0, credits: 0 };
  const mk = monthKey();
  let chars = 0,
    sfxSeconds = 0;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (e.month !== mk) continue;
      chars += e.chars || 0;
      sfxSeconds += e.sfxSeconds || 0;
    } catch {}
  }
  return { chars, sfxSeconds, credits: chars + 40 * sfxSeconds };
}

export function logUsage(entry) {
  mkdirSync(resolve(ROOT, "data"), { recursive: true });
  writeFileSync(
    resolve(ROOT, "data/tts-usage.jsonl"),
    JSON.stringify({ month: monthKey(), date: new Date().toISOString().slice(0, 10), ...entry }) + "\n",
    { flag: "a" }
  );
}

// Elige modelo: el configurado si la API lo acepta, si no el fallback probado.
// Cachea la decision del mes en memoria (no en disco: re-verifica cada boot).
let verifiedModel = null;
export async function pickModel() {
  if (verifiedModel) return verifiedModel;
  const want = ENV.ELEVENLABS_TTS_MODEL || "eleven_v4";
  // prueba barata: convertir 5 chars; si el modelo no existe, la API lo dice
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ENV.ELEVENLABS_VOICE_ID || "test"}`, {
    method: "POST",
    headers: { "xi-api-key": ENV.ELEVENLABS_API_KEY || "", "Content-Type": "application/json" },
    body: JSON.stringify({ text: "Oi.", model_id: want }),
    signal: AbortSignal.timeout(30000),
  });
  const t = await r.text();
  if (r.ok || !/model/i.test(t)) {
    verifiedModel = want; // ok, o el error es otro (voice/quota) no el modelo
  } else {
    verifiedModel = FALLBACK_MODEL;
  }
  return verifiedModel;
}

export async function synthesize(text, outPath) {
  const chars = [...text].length;
  if (!ENV.ELEVENLABS_API_KEY) return { ok: false, reason: "sin ELEVENLABS_API_KEY" };
  if (!ENV.ELEVENLABS_VOICE_ID) return { ok: false, reason: "sin ELEVENLABS_VOICE_ID" };
  const used = creditsUsedThisMonth();
  if (used.credits + chars > config.elevenLabsCharsPerMonth)
    return { ok: false, reason: `presupuesto mensual agotado (${used.credits}/${config.elevenLabsCharsPerMonth} creditos)` };

  const model = await pickModel();
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${ENV.ELEVENLABS_VOICE_ID}`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": ENV.ELEVENLABS_API_KEY,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: model,
      voice_settings: { stability: 0.55, similarity_boost: 0.8, style: 0.4 },
    }),
    signal: AbortSignal.timeout(90000),
  });
  if (!r.ok) return { ok: false, reason: `elevenlabs ${r.status}: ${(await r.text()).slice(0, 150)}` };
  mkdirSync(resolve(outPath, ".."), { recursive: true });
  writeFileSync(outPath, Buffer.from(await r.arrayBuffer()));
  logUsage({ chars, voice: ENV.ELEVENLABS_VOICE_ID, model });
  return { ok: true, path: outPath, chars, model };
}
