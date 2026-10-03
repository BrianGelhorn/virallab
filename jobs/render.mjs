// Renderer: guion JSON -> MP4 1080x1920 H.264 + AAC.
// ffmpeg puro, sin dependencias. Fondo con movimiento + tipografia por tarjetas
// + barra de progreso + voiceover (o mudo si no hay TTS).
import { spawn } from "node:child_process";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "../lib/config.mjs";
import { synthesizeTimed } from "../lib/tts.mjs";
import { buildAss } from "../lib/karaoke.mjs";
import { QUERIES } from "../lib/stock.mjs";

const ROOT = config.root;
const W = 1080,
  H = 1920,
  FPS = 30;

const FONT_FILE = "out/tmp/font.ttf";
const FONT_CANDIDATES = [
  "C:/Windows/Fonts/arialbd.ttf",
  "C:/Windows/Fonts/arial.ttf",
  "C:/Windows/Fonts/calibri.ttf",
];

// La fuente se copia a ruta relativa: el parser de filtros de ffmpeg
// no acepta : de C:\ dentro del filtergraph (ni escapado ni quoteado).
function ensureFont(tmp) {
  const dest = `${tmp}/font.ttf`;
  if (existsSync(dest)) return FONT_FILE;
  for (const src of FONT_CANDIDATES) {
    try {
      writeFileSync(dest, readFileSync(src));
      return FONT_FILE;
    } catch {}
  }
  throw new Error("sin fuente del sistema (arial/calibri)");
}

// Gradiente de fallback (solo si no hay Pexels ni foto). Cacheado por categoria.
async function gradientBg(category, tmp) {
  const [c1, c2] = PALETTES[category] || DEFAULT_PALETTE;
  const bgPath = resolve(tmp, `bg-${category}.png`);
  if (!existsSync(bgPath)) {
    await run(config.ffmpegBin, [
      "-y", "-f", "lavfi", "-i", `gradients=size=${W}x${H}:c0=${c1}:c1=${c2}:speed=0.08`,
      "-frames:v", "1", bgPath,
    ]);
  }
  return bgPath;
}

// Paletas por categoria (fondo distinto por video = anti-repeticion)
const PALETTES = {
  espaco: ["#0b1026", "#1b2a5e"],
  corpo: ["#1a0f1e", "#5e1b3a"],
  animais: ["#0d2318", "#1d5c38"],
  oceano: ["#062033", "#0b5e7a"],
  historia: ["#221503", "#6e4a0b"],
  comida: ["#260b06", "#7a2a0b"],
};
const DEFAULT_PALETTE = ["#101018", "#2a2a3e"];

function wrap(text, perLine) {
  const words = text.split(/\s+/);
  const lines = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > perLine && cur) {
      lines.push(cur.trim());
      cur = w;
    } else cur += " " + w;
  }
  if (cur.trim()) lines.push(cur.trim());
  return lines.join("\n");
}

function run(cmd, args) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => resolve({ code, err: err.slice(-800) }));
  });
}

// obtiene duracion con stdout capturado
function runOut(cmd, args) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let out = "",
      err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => resolve({ code, out: out.trim(), err: err.slice(-400) }));
  });
}

export async function renderVideo(queue, video, outDir) {
  const day = queue.date;
  mkdirSync(outDir, { recursive: true });
  const tmp = resolve(ROOT, "out/tmp");
  mkdirSync(tmp, { recursive: true });
  const font = ensureFont(tmp);

  // 1) Voiceover con timestamps (una sola llamada: vale para v1 y v2)
  const narration =
    video.format === "ranking" || video.C1
      ? `${video.HOOK} Número 3: ${video.C3} Número 2: ${video.C2} Número 1: ${video.C1} ${video.PUNCH}`
      : `${video.HOOK} ${video.SETUP} ${video.REVEAL} ${video.PUNCH}`;
  const audioPath = resolve(tmp, `${day}-01.mp3`);
  const tts = await synthesizeTimed(narration, audioPath);
  let audioDur = 0;
  if (tts.ok) {
    const r = await runOut(config.ffprobeBin, [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", audioPath,
    ]);
    audioDur = Number(r.out) || 0;
  }

  // v2 (karaoke + 4 beats) si hay voz con palabras; si no, v1 tarjetas (fallback probado)
  if (tts.ok && audioDur > 5 && (tts.words || []).length > 5) {
    return renderV2(queue, video, outDir, { tmp, font, narration, tts, audioDur, audioPath, day });
  }

  // 2) Tarjetas con duracion proporcional a caracteres (o al audio).
  // Quiz: HOOK > SETUP > REVEAL > PUNCH. Ranking: HOOK > Nº3 > Nº2 > Nº1 > PUNCH.
  const isRank = video.format === "ranking" || video.C1;
  const cards = isRank
    ? [
        { text: video.HOOK, size: 88, y: 760, w: 15 },
        { text: `Nº 3:\n${video.C3}`, size: 72, y: 780, w: 18 },
        { text: `Nº 2:\n${video.C2}`, size: 72, y: 780, w: 18 },
        { text: `Nº 1:\n${video.C1}`, size: 80, y: 760, w: 16 },
        { text: `${video.PUNCH}\n\nSegue para mais 👆`, size: 64, y: 800, w: 20 },
      ]
    : [
        { text: video.HOOK, size: 88, y: 760, w: 15 },
        { text: video.SETUP, size: 64, y: 820, w: 20 },
        { text: video.REVEAL, size: 72, y: 780, w: 18 },
        { text: `${video.PUNCH}\n\nSegue para mais 👆`, size: 64, y: 800, w: 20 },
      ];
  const totalChars = cards.reduce((a, c) => a + c.text.length, 0);
  const total = tts.ok && audioDur > 8 ? audioDur + 1.5 : 22;
  let t = 0;
  for (const c of cards) {
    c.dur = Math.max(3, (c.text.length / totalChars) * total);
    c.start = t;
    c.end = Math.min(total, t + c.dur);
    t = c.end;
    const fp = resolve(tmp, `card-${cards.indexOf(c)}.txt`);
    writeFileSync(fp, wrap(c.text, c.w), "utf8");
    c.file = fp;
  }

  // 2b) SFX en el payoff (reveal quiz / Nº1 ranking). Opcional, no rompe nada.
  const payoffIdx = isRank ? 3 : 2;
  let sfx = { ok: false };
  let sfxDelayMs = 0;
  if (tts.ok) {
    const { generateSfx } = await import("../lib/sfx.mjs");
    sfxDelayMs = Math.round(cards[payoffIdx].start * 1000);
    sfx = await generateSfx(video.format || "quiz_reveal", resolve(tmp, `${day}-01-sfx.mp3`)).catch(() => ({ ok: false }));
  }

  // 3) Fondo: query exacta del dato > stock categoria > foto > gradiente
  const { fetchBackground } = await import("../lib/stock.mjs");
  const bg = await fetchBackground(queue.category, video.stock || "").catch(() => ({ ok: false }));
  let bgInput, bgFilter;
  if (bg.ok && bg.kind === "video") {
    // loop para cubrir el total + recorte 9:16 + oscurecido para texto
    bgInput = ["-stream_loop", "4", "-i", bg.path];
    bgFilter = "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,eq=brightness=-0.4:saturation=0.9";
  } else {
    const still = bg.ok && bg.kind === "photo" ? bg.path : await gradientBg(queue.category, tmp);
    bgInput = ["-loop", "1", "-i", still];
    bgFilter = `scale=2160:3840,zoompan=z='1+0.04*on/${Math.round(total * FPS)}':d=${Math.round(total * FPS)}:s=${W}x${H}:fps=${FPS}`;
  }

  // 4) Filtros: fondo + textos + barra de progreso
  const filters = [bgFilter];
  for (const c of cards) {
    filters.push(
      `drawtext=fontfile=${font}:textfile='out/tmp/card-${cards.indexOf(c)}.txt':fontsize=${c.size}:fontcolor=white:borderw=3:bordercolor=black:x=(w-text_w)/2:y=${c.y}:line_spacing=12:enable='between(t,${c.start.toFixed(2)},${c.end.toFixed(2)})'`
    );
  }
  // etiqueta de categoria arriba + barra de progreso abajo
  const kicker = isRank ? "TOP 3" : "SABIA QUE?";
  filters.push(
    `drawtext=fontfile=${font}:text='${(queue.category || "").toUpperCase()} - ${kicker}':fontsize=44:fontcolor=#ffd166:x=(w-text_w)/2:y=240:enable='lt(t,${cards[0].end.toFixed(2)})'`,
    `drawbox=x=60:y=${H - 120}:w='960*t/${total.toFixed(2)}':h=10:color=#ffd166:t=fill`
  );

  const outPath = resolve(outDir, `${day}-01.mp4`);
  // audio: voz + sfx (retrasado al payoff, bajo) mezclados; sin voz -> mudo
  const audioInputs = [];
  if (tts.ok) audioInputs.push("-i", audioPath);
  if (sfx.ok) audioInputs.push("-i", resolve(tmp, `${day}-01-sfx.mp3`));
  let audioFilter = "";
  let audioMap = [];
  if (tts.ok && sfx.ok) {
    audioFilter = `;[1:a]adelay=0|0[voice];[2:a]adelay=${sfxDelayMs}|${sfxDelayMs},volume=0.25[fx];[voice][fx]amix=inputs=2:duration=first[aout]`;
    audioMap = ["-map", "[aout]"];
  } else if (tts.ok) {
    audioMap = ["-map", "1:a"];
  }
  const args = [
    "-y", ...bgInput,
    ...audioInputs,
    "-filter_complex", filters.join(",") + audioFilter,
    "-t", total.toFixed(2),
    "-r", String(FPS),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    ...audioMap,
    ...(tts.ok ? ["-c:a", "aac", "-b:a", "128k", "-shortest"] : ["-an"]),
    outPath,
  ];
  const r = await run(config.ffmpegBin, args);
  if (r.code !== 0) throw new Error(`ffmpeg fallo: ${r.err}`);

  // thumbnail para Telegram
  const thumb = resolve(outDir, `${day}-01.jpg`);
  await run(config.ffmpegBin, ["-y", "-ss", "2", "-i", outPath, "-frames:v", "1", "-q:v", "4", thumb]);

  return { video: outPath, thumb, duration: total, tts: tts.ok, ttsReason: tts.reason || "", ttsModel: tts.model || "", sfx: sfx.ok || false };
}

// Render v2: karaoke palabra-por-palabra + 4 clips (un beat cada cuarto) + grano.
// Requiere voz con timestamps. Sin eso, renderVideo usa v1 (tarjetas).
async function renderV2(queue, video, outDir, { tmp, font, narration, tts, audioDur, audioPath, day }) {
  const isRank = video.format === "ranking" || video.C1;
  const parts = isRank
    ? [video.HOOK, `Número 3: ${video.C3}`, `Número 2: ${video.C2}`, `Número 1: ${video.C1} ${video.PUNCH}`]
    : [video.HOOK, video.SETUP, video.REVEAL, video.PUNCH];
  // beats por conteo de palabras (las partes concatenadas forman la narracion)
  const words = tts.words;
  const counts = [];
  let acc = 0;
  for (const p of parts) {
    const n = p.split(/\s+/).filter(Boolean).length;
    counts.push([acc, acc + n]);
    acc += n;
  }
  const total = audioDur + 1.0;
  const tAt = (idx) => (idx >= words.length ? total : Math.min(total, words[Math.min(idx, words.length - 1)].start));
  const beats = counts.map(([a, b], i) => ({ t0: i === 0 ? 0 : tAt(a), t1: i === 3 ? total : tAt(b) }));

  // 4 clips: query exacta + categoria (usados se excluyen 30d)
  const { fetchBackground } = await import("../lib/stock.mjs");
  const queries = [video.stock, ...((QUERIES[queue.category] || []).slice(0, 3))].filter(Boolean);
  const clips = [];
  for (let i = 0; i < 4; i++) {
    const bg = await fetchBackground(queue.category, queries[i % Math.max(1, queries.length)] || "").catch(() => ({ ok: false }));
    clips.push(bg.ok ? bg : null);
  }
  if (!clips[0]) {
    clips[0] = { kind: "gradient" };
  }
  const inputs = [];
  const vchains = [];
  const cat = queue.category || "";
  let vi = 0; // indice de input de video actual
  for (let i = 0; i < 4; i++) {
    const dur = Math.max(2, beats[i].t1 - beats[i].t0).toFixed(2);
    const c = clips[i] || clips[0];
    if (c.kind === "video") {
      inputs.push("-ss", String((i * 7) % 20), "-i", c.path);
      vchains.push(`[${vi}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,eq=brightness=-0.35:saturation=0.95,trim=0:${dur},setpts=PTS-STARTPTS,fps=${FPS}[b${i}]`);
    } else {
      const still = c.kind === "photo" ? c.path : await gradientBg(cat, tmp);
      const frames = Math.round(Number(dur) * FPS);
      inputs.push("-loop", "1", "-i", still);
      vchains.push(`[${vi}:v]scale=2160:3840,zoompan=z='1+0.05*on/${frames}':d=${frames}:s=${W}x${H}:fps=${FPS},trim=0:${dur},setpts=PTS-STARTPTS[b${i}]`);
    }
    vi++;
  }
  // SFX en el payoff (beat 2)
  const { generateSfx } = await import("../lib/sfx.mjs");
  const sfx = await generateSfx(video.format || "quiz_reveal", resolve(tmp, `${day}-01-sfx.mp3`)).catch(() => ({ ok: false }));
  const sfxDelayMs = Math.round(beats[2].t0 * 1000);
  const vIdx = vi; // primer input de audio (voz)
  inputs.push("-i", audioPath);
  if (sfx.ok) inputs.push("-i", resolve(tmp, `${day}-01-sfx.mp3`));

  // karaoke ASS
  const assPath = resolve(tmp, `cap-${day}.ass`);
  writeFileSync(assPath, buildAss(words), "utf8");

  const kicker = isRank ? "TOP 3" : "SABIA QUE?";
  const graph = [
    ...vchains,
    `[b0][b1][b2][b3]concat=n=4:v=1:a=0[vcat]`,
    `[vcat]subtitles='out/tmp/cap-${day}.ass':fontsdir='out/tmp'[vsub]`,
    `[vsub]noise=alls=5:allf=t,vignette=PI/5,drawtext=fontfile=${font}:text='${cat.toUpperCase()} - ${kicker}':fontsize=44:fontcolor=#ffd166:x=(w-text_w)/2:y=240,drawbox=x=60:y=${H - 120}:w='960*t/${total.toFixed(2)}':h=10:color=#ffd166:t=fill[vout]`,
  ];
  let audioTail = "";
  const maps = ["-map", "[vout]"];
  if (sfx.ok) {
    audioTail = `;[${vIdx}:a]adelay=0|0[voice];[${vIdx + 1}:a]adelay=${sfxDelayMs}|${sfxDelayMs},volume=0.25[fx];[voice][fx]amix=inputs=2:duration=first[aout]`;
    maps.push("-map", "[aout]");
  } else {
    maps.push("-map", `${vIdx}:a`);
  }
  const outPath = resolve(outDir, `${day}-01.mp4`);
  const args = [
    "-y", ...inputs,
    "-filter_complex", graph.join(",") + audioTail,
    "-t", total.toFixed(2),
    "-r", String(FPS),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-maxrate", "10M", "-bufsize", "20M",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    ...maps,
    "-c:a", "aac", "-b:a", "128k", "-shortest",
    outPath,
  ];
  const r = await run(config.ffmpegBin, args);
  if (r.code !== 0) throw new Error(`ffmpeg v2 fallo: ${r.err}`);
  const thumb = resolve(outDir, `${day}-01.jpg`);
  await run(config.ffmpegBin, ["-y", "-ss", "2", "-i", outPath, "-frames:v", "1", "-q:v", "4", thumb]);
  return { video: outPath, thumb, duration: total, tts: true, ttsReason: "", ttsModel: tts.model || "", sfx: sfx.ok || false, renderer: "v2" };
}
