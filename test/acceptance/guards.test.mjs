// Tests de aceptacion PROTEGIDOS: la evolucion puede anadir pruebas aqui,
// pero nunca eliminar ni debilitar las condiciones que autorizan un despliegue.
// (supervisor/guards.mjs -> PROTECTED incluye este directorio)
import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { checkDiff, checkModel, parseContract, PROTECTED } from "../../supervisor/guards.mjs";
import { acquire } from "../../supervisor/lock.mjs";
import { alreadyPublished } from "../../lib/publish-state.mjs";
import { significant, scoreVideo } from "../../lib/schema.mjs";
import { dedupeLatest } from "../../jobs/evolve.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test("bloquea modificar area protegida", () => {
  for (const p of ["supervisor/cycle.mjs", "lib/schema.mjs", "test/acceptance/x.mjs", "package.json", ".env"]) {
    assert.equal(checkDiff([p]).ok, false, p);
  }
});

test("permite area modificable", () => {
  assert.equal(checkDiff(["jobs/brief.mjs", "platform/youtube.mjs", "dashboard/app.js", "state/lessons.md"]).ok, true);
});

test("solo modelos gratis confirmados", () => {
  assert.equal(checkModel("opencode/mimo-v2.6-flash-free").ok, true);
  assert.equal(checkModel("openai/gpt-5.4").ok, false);
  assert.equal(checkModel("").ok, false);
  assert.equal(checkModel("opencode/grok-code").ok, false); // gratis pero sin sufijo -free = no confirmado
});

test("contrato incompleto se rechaza", () => {
  const full = "PROBLEMA: x\nEVIDENCIA: y\nHIPOTESIS: h\nCAMBIO: c\nMETRICA: m\nCOMPROBACION: t\nREVERSION: r";
  assert.equal(parseContract(full).ok, true);
  const bad = parseContract("PROBLEMA: x\nCAMBIO: c");
  assert.equal(bad.ok, false);
  assert.ok(bad.missing.includes("EVIDENCIA"));
});

test("contrato tolera markdown y acentos", () => {
  const md = "**PROBLEMA:** x\n- EVIDENCIA: y\n## HIPÓTESIS: h\nCAMBIO: c\nMETRICA: m\nCOMPROBACION: t\nREVERSION: r";
  const p = parseContract(md);
  assert.equal(p.ok, true, `falta ${p.missing}`);
});

test("lock: segundo acquire el mismo dia falla (tmp, no el real)", () => {
  const tmp = join(tmpdir(), `vl-lock-${Date.now()}.json`);
  const first = acquire(tmp);
  const second = acquire(tmp);
  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.match(second.why, /ya corrio hoy/);
});

test("rollback restaura version previa (repo temporal)", () => {
  const d = mkdtempSync(join(tmpdir(), "vl-rb-"));
  execSync(`git init -b main --quiet`, { cwd: d });
  execSync(`git config user.email t@t`, { cwd: d });
  execSync(`git config user.name t`, { cwd: d });
  writeFileSync(join(d, "a.txt"), "v1");
  execSync(`git add -A && git commit -qm v1`, { cwd: d });
  execSync(`git tag vl-prev`, { cwd: d });
  writeFileSync(join(d, "a.txt"), "ROTO");
  execSync(`git add -A && git commit -qm roto`, { cwd: d });
  // rollback = reset al tag previo
  execSync(`git reset --hard vl-prev --quiet`, { cwd: d });
  assert.equal(readFileSync(join(d, "a.txt"), "utf8"), "v1");
});

test("no republica: id ya publicado se detecta", () => {
  assert.equal(alreadyPublished("video-que-no-existe-xyz", "youtube"), null);
});

test("datos tardios no generan conclusiones falsas", () => {
  const rows = [
    { videoId: "a", score: 0.9 }, // outlier temprano
    { videoId: "a", score: 0.2 }, // dato tardio corregido: gana el ultimo
    { videoId: "b", score: 0.25 },
  ];
  const latest = dedupeLatest(rows);
  assert.equal(latest.length, 2);
  assert.equal(latest.find((r) => r.videoId === "a").score, 0.2);
  // y con n=1 por lado no hay cambio significativo aunque el numero impresione
  assert.equal(significant({ n: 1, median: 0.9 }, { n: 1, median: 0.2 }).change, false);
});

test("flujos n8n: JSON valido, ids unicos, conexiones resuelven", () => {
  const dir = resolve(ROOT, "n8n/workflows");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    const w = JSON.parse(readFileSync(join(dir, f), "utf8"));
    assert.ok(w.id, `${f} sin id (lo exige import:workflow)`);
    const names = new Set(w.nodes.map((n) => n.name));
    for (const [from, outs] of Object.entries(w.connections || {})) {
      assert.ok(names.has(from), `${f}: origen ${from} inexistente`);
      for (const branch of Object.values(outs.main || {}))
        for (const t of branch || []) assert.ok(names.has(t.node), `${f}: destino ${t.node} inexistente`);
    }
  }
});

test("lista de protegidos cubre lo critico", () => {
  for (const p of ["supervisor/", "lib/schema.mjs", "test/acceptance/", "package.json", ".env"]) {
    assert.ok(PROTECTED.includes(p), `falta ${p} en PROTECTED`);
  }
});

test("invariante: score siempre en [0,1] (ningun peso puede romperlo)", () => {
  const max = scoreVideo({ views: 100, avgViewPct: 1, likes: 1e9, comments: 1e9, shares: 1e9, saves: 1e9, follows: 1e9 });
  assert.ok(max <= 1, `score maximo ${max} > 1: pesos rotos`);
  assert.ok(scoreVideo({ views: 1000, avgViewPct: 0 }) >= 0);
});

test("invariante: mas retencion = mas score (con todo lo demas igual)", () => {
  const base = { views: 1000, likes: 10, comments: 2, shares: 1, saves: 1, follows: 0 };
  assert.ok(scoreVideo({ ...base, avgViewPct: 0.9 }) > scoreVideo({ ...base, avgViewPct: 0.1 }));
});
