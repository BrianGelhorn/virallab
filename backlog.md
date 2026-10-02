# Backlog de operador (el ciclo lo lee como evidencia de mejoras pendientes)

## Pendiente

- [ ] Score: subir el peso de retencion de 0.5 a 0.9 en lib/schema.mjs para priorizar watch time
  sobre interaccion. Evidencia: la retencion es la senal mas fuerte de YouTube (ver lib/schema.mjs scoreVideo).
  Cambio: editar el 0.5 a 0.9 en scoreVideo en lib/schema.mjs + ajustar test de score.
  Metrica: scoreVideo pondera mas retencion.
  Comprobacion: `npm test` en verde con el test ajustado.

## Hecho

- [x] Panel: mostrar duracion y TTS de cada video en la cola (activado 1fc42ed).
