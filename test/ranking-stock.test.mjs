import { test } from "node:test";
import assert from "node:assert/strict";
import { pickVideoFile, QUERIES } from "../lib/stock.mjs";
import { sfxPromptFor } from "../lib/sfx.mjs";
import { parseScriptText, validateScript } from "../lib/schema.mjs";
import { chooseFormat } from "../jobs/brain.mjs";

test("pickVideoFile prefiere vertical", () => {
  const v = { video_files: [
    { link: "h", width: 1920, height: 1080 },
    { link: "v", width: 1080, height: 1920 },
  ]};
  assert.equal(pickVideoFile(v).url, "v");
});

test("pickVideoFile sin archivos -> null", () => {
  assert.equal(pickVideoFile({ video_files: [] }), null);
  assert.equal(pickVideoFile({}), null);
});

test("QUERIES cubre las 6 categorias", () => {
  for (const c of ["espaco", "corpo", "animais", "oceano", "historia", "comida"]) {
    assert.ok((QUERIES[c] || []).length >= 2, c);
  }
});

test("sfxPromptFor: sin voz ni musica, por formato", () => {
  for (const f of ["quiz_reveal", "ranking", "otro"]) {
    const p = sfxPromptFor(f);
    assert.match(p, /no voice, no music/);
    assert.ok(p.length < 120);
  }
  assert.notEqual(sfxPromptFor("ranking"), sfxPromptFor("quiz_reveal"));
});

const RANK = `FORMAT: ranking
HOOK: 3 coisas que você não sabia sobre o oceano
C3: O som viaja 4,5 vezes mais rápido na água do que no ar.
C2: A Fossa das Marianas é mais funda que o Everest é alto.
C1: O fitoplâncton produz metade do oxigênio que você respira.
PUNCH: O mar te mantém vivo.
CAPTION: Qual te surpreendeu? #Oceano #Top3 #Curiosidades`;

test("ranking parsea C1/C2/C3", () => {
  const s = parseScriptText(RANK);
  assert.equal(s.FORMAT, "ranking");
  assert.match(s.C1, /fitoplâncton/);
});

test("ranking valido pasa", () => {
  assert.equal(validateScript(parseScriptText(RANK)).ok, true);
});

test("ranking incompleto falla", () => {
  const s = parseScriptText(RANK);
  delete s.C2;
  assert.equal(validateScript(s).ok, false);
});

test("chooseFormat: exploracion forzada al rezagado", () => {
  assert.equal(chooseFormat(0, 0), "quiz_reveal"); // empate -> quiz primero
  assert.equal(chooseFormat(5, 2), "ranking");
  assert.equal(chooseFormat(2, 5), "quiz_reveal");
  assert.equal(chooseFormat(8, 8), null); // evidencia suficiente -> bestFormat decide
  assert.equal(chooseFormat(12, 3), "ranking");
});
