// Idempotencia: nunca publicar dos veces el mismo video en la misma plataforma.
// state/published.json local (gitignored). Estructura: { "<videoId>:<platform>": {platformId, url, at} }
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "./config.mjs";

const P = resolve(config.root, "state/published.json");

function load() {
  if (!existsSync(P)) return {};
  try { return JSON.parse(readFileSync(P, "utf8")); } catch { return {}; }
}
function save(d) {
  mkdirSync(resolve(config.root, "state"), { recursive: true });
  writeFileSync(P, JSON.stringify(d, null, 2));
}

export function alreadyPublished(videoId, platform) {
  return load()[`${videoId}:${platform}`] || null;
}

export function markPublished(videoId, platform, info) {
  const d = load();
  d[`${videoId}:${platform}`] = { ...info, at: new Date().toISOString() };
  save(d);
}
