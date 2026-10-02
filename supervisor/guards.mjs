// Guards: lo protegido no se toca, solo modelos gratis, contrato completo.
// El chequeo es sobre el diff git real, no sobre promesas del modelo.

// Nunca modificables por evolucion (ni por prompt ni por diff)
export const PROTECTED = [
  "supervisor/",
  "lib/schema.mjs",
  "lib/config.mjs",
  "lib/publish-state.mjs",
  "test/acceptance/",
  "package.json",
  "package-lock.json",
  "scripts/",
  ".env",
  ".env.example",
  "n8n/validate-workflows.mjs",
];

export function checkDiff(files) {
  const hit = files.filter((f) => PROTECTED.some((p) => f === p || f.startsWith(p)));
  return hit.length
    ? { ok: false, why: `area protegida: ${hit.join(", ")}` }
    : { ok: true };
}

// Solo modelos gratuitos confirmados. Todo lo demas (incluido vacio) se rechaza.
export function checkModel(model) {
  const m = String(model || "");
  return /^opencode\/[a-z0-9.-]+-free$/.test(m)
    ? { ok: true }
    : { ok: false, why: `modelo no autorizado: ${m || "(vacio)"} (solo opencode/*-free)` };
}

// Contrato de propuesta: 7 campos. Tolera markdown (**CAMPO:**, ## CAMPO, - CAMPO:)
// y acentos (HIPOTESIS/HIPÓTESIS). Lo estricto es el contenido, no la tipografia.
export const CONTRACT_FIELDS = ["PROBLEMA", "EVIDENCIA", "HIPOTESIS", "CAMBIO", "METRICA", "COMPROBACION", "REVERSION"];

const norm = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

export function parseContract(text) {
  const out = {};
  for (const line of norm(String(text)).split("\n")) {
    const m = line.match(/^[#*\-\s>]*([A-ZÑ]{4,})\s*[:*]?\s*(.+)$/);
    if (!m) continue;
    const key = m[1].replace(/[^A-Z]/g, "");
    if (CONTRACT_FIELDS.includes(key) && !out[key]) out[key] = m[2].replace(/^[*: \t]+/, "").trim();
  }
  const missing = CONTRACT_FIELDS.filter((f) => !out[f]);
  return { contract: out, ok: missing.length === 0, missing };
}
