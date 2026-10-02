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
5. **Fondo con movimiento:** gradiente lavfi o foto stock con `scale=2160:3840,zoompan=...`. Video stock (Pexels, `lib/stock.mjs`): `scale+crop` 9:16 + `eq=brightness=-0.4` para texto, con `-stream_loop 4`. Fondo estatico = peor retencion.
6. **Chain de fondos:** Pexels video (si hay key) > NASA keyless (espaco/oceano) > Commons keyless (general) > gradiente (`fetchBackground()` en `lib/stock.mjs` con tracking anti-repeticion 30d en `data/stock-used.jsonl`). Commons/NASA son landscape: el crop 9:16 + `eq=brightness=-0.4` los deja legibles; si el clip es oscuro en bordes es el espacio real, no un bug.
6. **Barra de progreso:** `drawbox=x=60:y=1800:w='960*t/DUR':h=10:color=#ffd166:t=fill`. Barata y sube completion.
7. **Paleta por categoria** (`PALETTES`): fondo distinto por video = anti-repeticion visual (politica Meta "original content").

## Salida canonica

MP4 H.264 `yuv420p` 1080x1920 30fps `+faststart`, AAC 128k (o `-an` si no hay TTS). Thumbnail `-ss 2` jpg para Telegram. Verificar con `ffprobe` (ver smoke test en `.tmp/smoke-render.mjs`).

## Audio: voz + sfx (ElevenLabs)

- TTS: `lib/tts.mjs` con `ELEVENLABS_TTS_MODEL` (default `eleven_v4`, fallback automatico a `eleven_multilingual_v2` si la API lo rechaza). Voz por `ELEVENLABS_VOICE_ID` (default Liam, joven social_media). Narracion = HOOK+SETUP+REVEAL+PUNCH (~320 chars/video); las tarjetas se sincronizan a la duracion real del audio (`audioDur+1.5s`), sin audio son 22s fijos.
- SFX: `lib/sfx.mjs` genera 1 efecto/video (`eleven_text_to_sound_v2`, 1.5s, ~60 creditos) mezclado con `adelay` al inicio del payoff (REVEAL quiz / Nº1 ranking) a volumen 0.25 via `amix`. Prompts por formato en `sfxPromptFor()` (siempre "no voice, no music").
- Presupuesto: pool mensual compartido en `data/tts-usage.jsonl` (`ELEVENLABS_CHARS_PER_MONTH`, default 40000). Sin key/saldo: video mudo sin SFX, nunca falla el render.
