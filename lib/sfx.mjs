// Sound effects ElevenLabs: 1 efecto por video en el momento del reveal.
// POST /v1/sound-generation (eleven_text_to_sound_v2). Costo: 40 creditos/seg.
// Comparte el pool mensual con TTS (ver lib/tts.mjs creditsUsedThisMonth).
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { config, loadEnv } from "../lib/config.mjs";
import { creditsUsedThisMonth, logUsage } from "./tts.mjs";

const ROOT = config.root;
const ENV = loadEnv();

// Prompt por formato. Corto, cinematico, sin voz ni musica (solo diseno sonoro).
export function sfxPromptFor(format) {
  if (format === "ranking") return "soft cinematic impact thud with subtle riser, no voice, no music";
  return "subtle cinematic whoosh swell into soft shimmer, no voice, no music";
}

export async function generateSfx(format, outPath, seconds = 1.5) {
  if (!ENV.ELEVENLABS_API_KEY) return { ok: false, reason: "sin ELEVENLABS_API_KEY" };
  const cost = Math.ceil(40 * seconds);
  const used = creditsUsedThisMonth();
  if (used.credits + cost > config.elevenLabsCharsPerMonth)
    return { ok: false, reason: `presupuesto mensual agotado (${used.credits}/${config.elevenLabsCharsPerMonth})` };
  const r = await fetch("https://api.elevenlabs.io/v1/sound-generation", {
    method: "POST",
    headers: { "xi-api-key": ENV.ELEVENLABS_API_KEY, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({
      text: sfxPromptFor(format),
      model_id: "eleven_text_to_sound_v2",
      duration_seconds: seconds,
      prompt_influence: 0.4,
    }),
    signal: AbortSignal.timeout(90000),
  });
  if (!r.ok) return { ok: false, reason: `sfx ${r.status}: ${(await r.text()).slice(0, 150)}` };
  mkdirSync(resolve(outPath, ".."), { recursive: true });
  writeFileSync(outPath, Buffer.from(await r.arrayBuffer()));
  logUsage({ chars: 0, sfxSeconds: seconds, prompt: sfxPromptFor(format) });
  return { ok: true, path: outPath, seconds, cost };
}
