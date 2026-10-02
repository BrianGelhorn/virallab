// Valida los exports n8n: JSON estricto, nodos, conexiones y comandos existen.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dir = resolve(ROOT, "n8n/workflows");
let fail = 0;
const bad = (m) => { fail++; console.error("FALLO:", m); };

for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
  let w;
  try { w = JSON.parse(readFileSync(resolve(dir, f), "utf8")); }
  catch (e) { bad(`${f}: JSON invalido`); continue; }
  if (!w.name || !Array.isArray(w.nodes) || !w.connections) { bad(`${f}: estructura`); continue; }
  const names = new Set(w.nodes.map((n) => n.name));
  // ids unicos
  const ids = w.nodes.map((n) => n.id);
  if (new Set(ids).size !== ids.length) bad(`${f}: ids duplicados`);
  for (const [from, outs] of Object.entries(w.connections)) {
    if (!names.has(from)) { bad(`${f}: conexion desde nodo inexistente ${from}`); continue; }
    for (const branch of Object.values(outs.main || {}))
      for (const t of branch || [])
        if (!names.has(t.node)) bad(`${f}: conexion a nodo inexistente ${t.node}`);
  }
  for (const n of w.nodes) {
    if (n.type === "n8n-nodes-base.executeCommand") {
      const m = (n.parameters?.command || "").match(/^node (.+\.mjs)/);
      if (!m) { bad(`${f}/${n.name}: comando no es node *.mjs`); continue; }
      const target = m[1].replace("C:\\dev\\virallab", ROOT).replaceAll("\\", "/");
      if (!existsSync(target)) bad(`${f}/${n.name}: no existe ${m[1]}`);
    }
    if (n.type === "n8n-nodes-base.scheduleTrigger" && !n.parameters?.rule?.interval?.length)
      bad(`${f}/${n.name}: sin regla de schedule`);
  }
  console.log(`OK ${f} (${w.nodes.length} nodos)`);
}
if (fail) { console.error(`${fail} fallos`); process.exit(1); }
console.log("workflows validos");
