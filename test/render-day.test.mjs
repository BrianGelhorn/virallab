import { test } from "node:test";
import assert from "node:assert/strict";
import { attachRenderMeta } from "../jobs/render-day.mjs";

const queue = () => ({
  date: "2026-10-02",
  videos: [
    { id: "2026-10-02-01", HOOK: "hola" },
    { id: "2026-10-02-02", HOOK: "chao" },
  ],
});

test("pega duration/tts por id y no muta la cola", () => {
  const q = queue();
  const before = JSON.stringify(q);
  const out = attachRenderMeta(q, [{ id: "2026-10-02-01", duration: 21.4, tts: true }]);
  assert.equal(JSON.stringify(q), before, "la cola de entrada cambio");
  assert.notEqual(out, q, "devuelve copia, no la misma referencia");
  assert.equal(out.videos[0].duration, 21.4);
  assert.equal(out.videos[0].tts, true);
  assert.ok(!("duration" in out.videos[1]), "sin resultado no se toca el video");
});

test("resultado cached (sin duration) conserva la meta previa", () => {
  const once = attachRenderMeta(queue(), [{ id: "2026-10-02-01", duration: 21.4, tts: true }]);
  const twice = attachRenderMeta(once, [{ id: "2026-10-02-01", cached: true }]);
  assert.equal(twice.videos[0].duration, 21.4);
  assert.equal(twice.videos[0].tts, true);
});

test("tts false queda booleano y videos desconocidos quedan igual", () => {
  const out = attachRenderMeta(queue(), [
    { id: "2026-10-02-02", duration: 22, tts: false },
    { id: "fantasma", duration: 5, tts: true },
  ]);
  assert.equal(out.videos[1].tts, false);
  assert.equal(out.videos.length, 2);
  assert.ok(!("duration" in out.videos[0]));
});
