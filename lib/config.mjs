import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadJson(path, fallback) {
  const p = resolve(ROOT, path);
  if (!existsSync(p)) return fallback;
  return JSON.parse(readFileSync(p, "utf8"));
}

// .env manual: sin dependencias, parseo de KEY=VALUE con # comentarios
export function loadEnv() {
  const p = resolve(ROOT, ".env");
  if (!existsSync(p)) return {};
  const out = {};
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

const env = loadEnv();

export const config = {
  root: ROOT,
  lang: "pt-BR",
  regionCode: "BR",
  // Un solo knob para el modelo gratis. Probado 2026-10-02: mimo fill-in 5/5 en ~8s.
  brainModel: env.BRAIN_MODEL || "opencode/mimo-v2.6-flash-free",
  postsPerDay: Number(env.POSTS_PER_DAY || 1),
  publishEnabled: env.PUBLISH_ENABLED === "true",
  autoPublishAfterHours: Number(env.AUTO_PUBLISH_AFTER_HOURS || 24),
  elevenLabsKey: env.ELEVENLABS_API_KEY || "",
  elevenLabsVoice: env.ELEVENLABS_VOICE_ID || "",
  elevenLabsCharsPerMonth: Number(env.ELEVENLABS_CHARS_PER_MONTH || 10000),
  telegramBotToken: env.TELEGRAM_BOT_TOKEN || "",
  telegramChatId: env.TELEGRAM_CHAT_ID || "",
  ffmpegBin: env.FFMPEG_BIN || "ffmpeg",
  ffprobeBin: env.FFPROBE_BIN || "ffprobe",
};

export function loadState(name, fallback) {
  return loadJson(`state/${name}`, fallback);
}
