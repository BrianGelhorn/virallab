// TTS ElevenLabs con presupuesto mensual duro. Sin key o sin saldo: {ok:false}, el video sale mudo.
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "../lib/config.mjs";

const ROOT = config.root;

export function monthKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function charsUsedThisMonth() {
  const p = resolve(ROOT, "data/tts-usage.jsonl");
  if (!existsSync(p)) return 0;
  const mk = monthKey();
  let sum = 0;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (e.month === mk) sum += e.chars || 0;
    } catch {}
  }
  return sum;
}

function logUsage(chars, voice) {
  mkdirSync(resolve(ROOT, "data"), { recursive: true });
  writeFileSync(
    resolve(ROOT, "data/tts-usage.jsonl"),
    JSON.stringify({ month: monthKey(), date: new Date().toISOString().slice(0, 10), chars, voice }) + "\n",
    { flag: "a" }
  );
}

export async function synthesize(text, outPath) {
  const chars = [...text].length;
  if (!config.elevenLabsKey)
    return { ok: false, reason: "sin ELEVENLABS_API_KEY" };
  if (!config.elevenLabsVoice)
    return { ok: false, reason: "sin ELEVENLABS_VOICE_ID" };
  const used = charsUsedThisMonth();
  if (used + chars > config.elevenLabsCharsPerMonth)
    return { ok: false, reason: `presupuesto mensual agotado (${used}/${config.elevenLabsCharsPerMonth} chars)` };

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${config.elevenLabsVoice}`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": config.elevenLabsKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.6, similarity_boost: 0.8 },
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) return { ok: false, reason: `elevenlabs ${r.status}: ${(await r.text()).slice(0, 120)}` };
  const buf = Buffer.from(await r.arrayBuffer());
  mkdirSync(resolve(outPath, ".."), { recursive: true });
  writeFileSync(outPath, buf);
  logUsage(chars, config.elevenLabsVoice);
  return { ok: true, path: outPath, chars };
}
