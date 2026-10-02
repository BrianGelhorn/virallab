---
name: virallab-brain
description: Patron probado para que un modelo gratis de opencode empaquete un hecho en guion de short (fill-in, sin recall, con validacion en Node).
---

# virallab-brain

Usar cuando haya que generar o depurar guiones con `jobs/brain.mjs`.

## El patron (probado 2026-10-02: 5/5 campos, ~8s, $0)

1. **Node investiga, el LLM empaqueta.** `jobs/brief.mjs` entrega `{topic, fact, category}` verificado. El LLM nunca recuerda hechos: los modelos debiles divagan o preguntan cuando se les pide recall.
2. **Instrucciones en ingles, salida en portugues.** Llamada exacta:
   `opencode run --model <free> --format json "<task>"`
   Modelo default: `opencode/mimo-v2.6-flash-free` (config `BRAIN_MODEL` en `.env`).
3. **Plantilla fill-in, 6 lineas, sin markdown ni role-play:**
   `FORMAT / HOOK (max 12 palabras) / SETUP (max 15) / REVEAL (1 frase, el hecho intacto) / PUNCH (max 10) / CAPTION (max 180 chars, 1 pregunta + 3 hashtags)`.
4. **Parsear el ULTIMO evento `text` del stream `--format json`.** Ver `runModel()` en `jobs/brain.mjs`.
5. **Node valida con `validateScript()` (`lib/schema.mjs`) y reintenta una vez con el siguiente modelo fallback.** El formato lo impone Node (`bestFormat()`), el LLM no decide formato.
6. **Los tips de `state/lessons.md` entran como max 3 lineas al final del prompt**, nunca el archivo entero (costo de tokens).

## Lo que NO funciona (verificado)

- Flag `--agent` con tier gratis: el proveedor responde `free tier can only be used from within OpenCode`.
- Pedir JSON: los modelos conversan en vez de emitir JSON. Por eso el output es `K: valor` plano y lo parsea `parseScriptText()`.
- Role-play (`voce e um redator...`): el modelo pide aclaraciones en vez de producir. Imperativo fill-in en su lugar.
