import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseScriptText, validateScript, scoreVideo, significant, median,
} from "../lib/schema.mjs";

const GOOD = `FORMAT: quiz_reveal
HOOK: Por que nunca vemos o outro lado da Lua?
SETUP: A Lua gira sobre si mesma enquanto orbita a Terra.
REVEAL: A Lua completa uma rotação a cada 27,3 dias, igual ao período orbital.
PUNCH: Mesma velocidade, mesmo lado sempre.
CAPTION: Você sabia? Qual te surpreendeu mais? #Lua #Espaço #Curiosidades`;

test("parseScriptText extrae los 6 campos", () => {
  const s = parseScriptText(GOOD);
  assert.equal(s.FORMAT, "quiz_reveal");
  assert.match(s.HOOK, /Lua/);
  assert.match(s.CAPTION, /#/);
});

test("validateScript acepta guion bueno", () => {
  const v = validateScript(parseScriptText(GOOD));
  assert.equal(v.ok, true, JSON.stringify(v.errors));
});

test("validateScript rechaza guion incompleto", () => {
  const v = validateScript(parseScriptText("HOOK: hola"));
  assert.equal(v.ok, false);
  assert.ok(v.errors.length >= 4);
});

test("validateScript rechaza caption sin hashtags", () => {
  const s = parseScriptText(GOOD.replace(/#Lua #Espaço #Curiosidades/, "sin tags"));
  assert.equal(validateScript(s).ok, false);
});

test("validateScript rechaza formato desconocido", () => {
  const s = { ...parseScriptText(GOOD), FORMAT: "invento" };
  assert.equal(validateScript(s).ok, false);
});

test("scoreVideo pondera retencion > interaccion > follows", () => {
  const base = { views: 1000, shares: 10, saves: 20, comments: 5, likes: 100, follows: 5 };
  const hi = scoreVideo({ ...base, avgViewPct: 0.9 });
  const lo = scoreVideo({ ...base, avgViewPct: 0.2 });
  assert.ok(hi > lo, `${hi} deberia > ${lo}`);
  assert.ok(hi >= 0 && hi <= 1);
});

test("scoreVideo con 0 views no explota", () => {
  assert.equal(scoreVideo({ views: 0 }), 0);
});

test("significant exige n>=8", () => {
  assert.equal(significant({ n: 3, median: 0.2 }, { n: 3, median: 0.9 }).change, false);
});

test("significant exige gap>30%", () => {
  assert.equal(significant({ n: 10, median: 0.5 }, { n: 10, median: 0.6 }).change, false);
  assert.equal(significant({ n: 10, median: 0.5 }, { n: 10, median: 0.8 }).change, true);
});

test("median par e impar", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), 0);
});
