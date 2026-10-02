import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// facts.json: el banco nunca puede tener hechos vacios, ids duplicados ni categorias huesped
const facts = JSON.parse(readFileSync(resolve("data/facts.json"), "utf8"));
const CATS = new Set(["espaco", "corpo", "animais", "oceano", "historia", "comida"]);

test("30 hechos con id unico", () => {
  assert.equal(facts.length, 30);
  assert.equal(new Set(facts.map((f) => f.id)).size, 30);
});

test("todo hecho tiene topic+fact+source y categoria valida", () => {
  for (const f of facts) {
    assert.ok(f.topic && f.topic.length > 5, f.id);
    assert.ok(f.fact && f.fact.length > 20, f.id);
    assert.ok(f.source, f.id);
    assert.ok(CATS.has(f.category), `${f.id}: ${f.category}`);
  }
});

test("cobertura minima: >=4 hechos por categoria", () => {
  const n = {};
  for (const f of facts) n[f.category] = (n[f.category] || 0) + 1;
  for (const c of CATS) assert.ok((n[c] || 0) >= 4, c);
});

test("hechos caben en tarjetas (fact <= 160 chars)", () => {
  for (const f of facts) assert.ok(f.fact.length <= 160, `${f.id}: ${f.fact.length}`);
});
