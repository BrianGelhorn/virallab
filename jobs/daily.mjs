// Orquestador diario: brief -> brain -> render. Lo llama n8n (o Task Scheduler).
// No publica ni mide: eso va en publish.mjs / metrics.mjs por separado.
// Uso: node jobs/daily.mjs [YYYY-MM-DD]
import { buildBrief } from "./brief.mjs";
import { brain } from "./brain.mjs";
import { renderDay } from "./render-day.mjs";
import { isMain } from "../lib/config.mjs";

export async function daily(day) {
  const d = day || new Date().toISOString().slice(0, 10);
  const brief = await buildBrief();
  const queue = await brain(d);
  const rendered = await renderDay(d);
  return {
    date: d,
    category: brief.fact.category,
    fact: brief.fact.id,
    model: queue.model,
    hook: queue.videos[0].HOOK,
    rendered,
  };
}

if (isMain(import.meta.url)) {
  const day = process.argv[2];
  console.log(JSON.stringify(await daily(day), null, 2));
}
