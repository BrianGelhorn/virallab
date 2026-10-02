---
name: virallab-render
description: Lecciones de ffmpeg 9 para el renderer de shorts 1080x1920 (filtergraph, fuentes, UTF-8, tiempos).
---

# virallab-render

Usar cuando haya que tocar `jobs/render.mjs`.

## Reglas del filtergraph (ganadas a mano)

1. **Este build NO tiene `-filter_complex_script`.** Pasar `-filter_complex` como argv via `spawn` (nunca via shell: PowerShell mutila el escaping).
2. **El parser rechaza `:` de rutas Windows dentro del filtro.** Ni `\:` escapado ni `'...'` quoteado funcionan. Solucion: copiar la fuente al proyecto (`ensureFont()` -> `out/tmp/font.ttf`) y usar `textfile` con rutas relativas. Dentro del filtro no hay ningun `C:`.
3. **Ventanas `enable` quoteadas SIN escapes de comas:** `enable='between(t,1.20,3.40)'`. Con `\,` falla.
4. **Textos por `textfile=` (UTF-8), nunca `text=`.** Acentos PT-BR renderizan bien con Arial Bold. Pre-wrapear lineas en Node (`wrap()`: ~15 chars/linea para 88px, ~20 para 64px).
5. **Fondo con movimiento:** `gradients` lavfi -> `scale=2160:3840,zoompan=z='1+0.04*on/N':d=N:s=1080x1920:fps=30`. Fondo estatico = peor retencion.
6. **Barra de progreso:** `drawbox=x=60:y=1800:w='960*t/DUR':h=10:color=#ffd166:t=fill`. Barata y sube completion.
7. **Paleta por categoria** (`PALETTES`): fondo distinto por video = anti-repeticion visual (politica Meta "original content").

## Salida canonica

MP4 H.264 `yuv420p` 1080x1920 30fps `+faststart`, AAC 128k (o `-an` si no hay TTS). Thumbnail `-ss 2` jpg para Telegram. Verificar con `ffprobe` (ver smoke test en `.tmp/smoke-render.mjs`).

## Tiempos

Tarjetas proporcionales a caracteres; total 22s mudo o `audioDur+1.5s` con TTS (`lib/tts.mjs`, presupuesto mensual duro en `data/tts-usage.jsonl`).
