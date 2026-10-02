// Renderer: guion JSON -> MP4 1080x1920 H.264 + AAC.
// ffmpeg puro, sin dependencias. Fondo con movimiento + tipografia por tarjetas
// + barra de progreso + voiceover (o mudo si no hay TTS).
import { spawn } from "node:child_process";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "../lib/config.mjs";
import { synthesize } from "../lib/tts.mjs";

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

  // 1) Voiceover (o mudo)
  const narration =
    video.format === "ranking" || video.C1
      ? `${video.HOOK} Número 3: ${video.C3} Número 2: ${video.C2} Número 1: ${video.C1} ${video.PUNCH}`
      : `${video.HOOK} ${video.SETUP} ${video.REVEAL} ${video.PUNCH}`;
  const audioPath = resolve(tmp, `${day}-01.mp3`);
  const tts = await synthesize(narration, audioPath);
  let audioDur = 0;
  if (tts.ok) {
    const r = await runOut(config.ffprobeBin, [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", audioPath,
    ]);
    audioDur = Number(r.out) || 0;
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

  // 3) Fondo: stock real > foto con movimiento > gradiente (fallback chain)
  const { fetchBackground } = await import("../lib/stock.mjs");
  const bg = await fetchBackground(queue.category).catch(() => ({ ok: false }));
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
  const kicker = isRank ? "TOP 3" : "SABIAS QUE?";
  filters.push(
    `drawtext=fontfile=${font}:text='${(queue.category || "").toUpperCase()} - ${kicker}':fontsize=44:fontcolor=#ffd166:x=(w-text_w)/2:y=240:enable='lt(t,${cards[0].end.toFixed(2)})'`,
    `drawbox=x=60:y=${H - 120}:w='960*t/${total.toFixed(2)}':h=10:color=#ffd166:t=fill`
  );

  const outPath = resolve(outDir, `${day}-01.mp4`);
  const args = [
    "-y", ...bgInput,
    ...(tts.ok ? ["-i", audioPath] : []),
    "-filter_complex", filters.join(","),
    "-t", total.toFixed(2),
    "-r", String(FPS),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    ...(tts.ok ? ["-c:a", "aac", "-b:a", "128k", "-shortest"] : ["-an"]),
    outPath,
  ];
  const r = await run(config.ffmpegBin, args);
  if (r.code !== 0) throw new Error(`ffmpeg fallo: ${r.err}`);

  // thumbnail para Telegram
  const thumb = resolve(outDir, `${day}-01.jpg`);
  await run(config.ffmpegBin, ["-y", "-ss", "2", "-i", outPath, "-frames:v", "1", "-q:v", "4", thumb]);

  return { video: outPath, thumb, duration: total, tts: tts.ok, ttsReason: tts.reason || "" };
}
