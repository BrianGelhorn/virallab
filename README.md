# ViralLab

Cuenta de shorts desatendida y automejorable (PT-BR, Brasil): **brief → cerebro → render → aprobar → publicar → medir → evolucionar.**

- **Cero dependencias npm.** Solo Node ≥20 + ffmpeg 9 + `opencode run` con un modelo gratis.
- Costo: $0/mes (modelos gratis de opencode, render local, ElevenLabs opcional con cap mensual).

## El loop

```
04:00  jobs/daily.mjs  = brief (tendencias) + brain (LLM empaqueta) + render (ffmpeg)
05:05  Telegram: video + ✅ / ⏭   (sin respuesta en 24h → auto-aprueba)
c/15m  jobs/publish.mjs + jobs/metrics.mjs (YouTube/IG/FB, idempotente)
23:00  jobs/evolve.mjs (ranking determinista + lessons.md)
```

Dashboard: `node server.mjs` → http://localhost:3100

## Regla de oro

El LLM **solo empaqueta** un hecho verificado en guion. Nunca investiga, nunca decide formato, nunca toca `jobs/`, `platform/` ni `n8n/`. El aprendizaje es aritmética en Node (`significant()`: n≥8 por lado y gap >30%, si no a explorar). Detalles en `.opencode/skills/virallab-*/SKILL.md`.

## Puesta en marcha

```bash
cp .env.example .env   # completar a medida que se aprueban las fases
npm test                # 14 tests, 0 deps
node jobs/brief.mjs     # prueba señales (Wikipedia + Trends BR)
node jobs/daily.mjs     # loop completo en modo seco
```

## F0 — Papeleo (camino crítico, en paralelo, lo hacés vos)

1. **ffmpeg**: `winget install Gyan.FFmpeg` (en esta PC ya está).
2. **YouTube**: proyecto en Google Cloud → OAuth installed-app → scopes `youtube.upload` + `yt-analytics.readonly` + `youtube.readonly` → completar el **compliance audit** (proyectos nuevos suben en privado hasta pasarlo). Guardar `YT_CLIENT_ID/SECRET/REFRESH_TOKEN` en `.env`.
3. **Meta**: app en developers.facebook.com, producto **Instagram Login** → pedir `instagram_business_content_publish` + `instagram_business_manage_insights`. Crear **FB Page** → `pages_manage_posts`. **Business verification**. IG a **Creator/Business** (una personal no sirve). Sin SLA: planificar semanas.
4. **Telegram**: BotFather → bot + chat_id → `TELEGRAM_*` en `.env` → webhook `https://tu-host:3100/telegram` (o polling manual en F1).
5. **ElevenLabs** (opcional): voice PT-BR → `ELEVENLABS_*`. Sin key el video sale mudo igual.

## Fases

| Fase | Condición | Qué pasa |
|---|---|---|
| F1 | hoy | Loop en `PUBLISH_ENABLED=false`: renderiza, notifica, no publica. Calibrar formato. |
| F2 | Google aprueba | YouTube Shorts en vivo (unlisted→public al aprobar). Métricas reales. |
| F3 | Meta aprueba | IG Reels + FB Reels (1/día). |
| F4 | retención estable | 2/día. Nuevo nicho = cuenta aparte, nunca mezclado. |

## n8n (host, sin Docker)

`npm i -g n8n` → importar `n8n/workflows/*.json` → activar. `scripts/start.ps1` en Programador de tareas (al iniciar sesión) levanta server + n8n. Validar con `node n8n/validate-workflows.mjs`.
