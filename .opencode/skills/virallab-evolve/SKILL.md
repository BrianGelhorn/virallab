---
name: virallab-evolve
description: Reglas anti-autoengano del loop de aprendizaje (score, gates estadisticos, YouTube como rueda de entrenamiento).
---

# virallab-evolve

Usar cuando haya que tocar `jobs/evolve.mjs`, `jobs/metrics.mjs` o `lib/schema.mjs`.

## Score (solo lo calcula Node, nunca el LLM)

`scoreVideo()`: `0.5*retencion + 0.3*min(1,engage*4) + 0.2*min(1,follows*40)`, donde `engage=(shares+0.5*saves+0.25*comments+0.1*likes)/views`. Rango 0-1.

## Gate de cambio (`significant()`)

Un formato/hook/categoria cambia de peso SOLO si `n>=8` por lado Y gap de mediana `>30%`. Si no: seguir explorando (70/30 explore/exploit). Sin este gate, con 1 video/dia, todo "hallazgo" antes del dia ~20 es ruido.

## YouTube es la rueda de entrenamiento

Unica plataforma con retencion real (`averageViewPercentage` + curva `elapsedVideoTimeRatio` via Analytics API, delay 48-72h). IG/FB dan proxies (plays/reach/shares/saves). El formato se aprende en YouTube y se aplica a las otras dos. `metrics.mjs` agrega `youtube + instagram` con esa prioridad.

## Nicho y memoria

- Nicho: max 1 cambio/mes, tras 14 dias de probation por encima del umbral (o 21 por debajo).
- `state/hooks.json`: ranking `{formats, categories}` con `{n, median}`. Lo escribe `evolve()`.
- `state/lessons.md`: append-only, cap 200 lineas, solo cuando hay cambio significativo. El LLM lee el digest, nunca recomputa.
- `data/metrics.jsonl` y `data/trends.jsonl`: append-only, fuente de verdad. `evolve()` usa el ultimo row por videoId.
