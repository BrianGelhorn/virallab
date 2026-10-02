// Muestra tu chat_id: 1) escribile /start a tu bot 2) node scripts/telegram-id.mjs
import { loadEnv } from "../lib/config.mjs";

const ENV = loadEnv();
if (!ENV.TELEGRAM_BOT_TOKEN) {
  console.log("Falta TELEGRAM_BOT_TOKEN en .env (pedilo a @BotFather con /newbot)");
  process.exit(1);
}
const r = await fetch(`https://api.telegram.org/bot${ENV.TELEGRAM_BOT_TOKEN}/getUpdates`, { signal: AbortSignal.timeout(20000) });
const j = await r.json();
if (!j.ok) {
  console.log("Token invalido:", j.description);
  process.exit(1);
}
const seen = new Map();
for (const u of j.result || []) {
  const c = u.message?.chat || u.callback_query?.message?.chat;
  if (c && !seen.has(c.id)) seen.set(c.id, c);
}
if (!seen.size) {
  console.log("El bot no recibio mensajes aun. Escribile /start en Telegram y corre de nuevo.");
  process.exit(0);
}
for (const [id, c] of seen) {
  console.log(`chat_id: ${id}  (${[c.first_name, c.last_name].filter(Boolean).join(" ") || c.title || c.type})`);
}
console.log("\nPegalo en .env como TELEGRAM_CHAT_ID=<numero>");
