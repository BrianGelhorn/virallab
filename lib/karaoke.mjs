// Karaoke ASS palabra-por-palabra (formato nativo de shorts virales).
// words: [{w, start, end}] en segundos (de ElevenLabs with-timestamps).
// Puro y testeable: buildAss() no toca disco ni red.

export function fmtAss(t) {
  const ms = Math.max(0, Math.round(t * 1000));
  const cs = Math.floor((ms % 1000) / 10);
  const s = Math.floor(ms / 1000) % 60;
  const m = Math.floor(ms / 60000) % 60;
  const h = Math.floor(ms / 3600000);
  const p = (n, l = 2) => String(n).padStart(l, "0");
  return `${h}:${p(m)}:${p(s)}.${p(cs)}`;
}

// Agrupa palabras en lineas cortas (max 20 chars: a 68px entran ~720px de 1080).
export function groupLines(words, maxChars = 20, maxSpan = 2.8) {
  const lines = [];
  let cur = [];
  for (const w of words) {
    cur.push(w);
    const span = cur.length > 1 ? cur[cur.length - 1].end - cur[0].start : 0;
    const len = cur.map((x) => x.w).join(" ").length;
    if (len >= maxChars || span >= maxSpan) {
      lines.push(cur);
      cur = [];
    }
  }
  if (cur.length) lines.push(cur);
  return lines;
}

export function buildAss(words, { fontSize = 68 } = {}) {
  const lines = groupLines(words);
  const ev = lines.map((line) => {
    const start = fmtAss(line[0].start);
    const end = fmtAss(line[line.length - 1].end + 0.12);
    const text = line.map((w) => `{\\k${Math.max(5, Math.round((w.end - w.start) * 100))}}${w.w}`).join(" ");
    return `Dialogue: 0,${start},${end},Default,,0,0,0,,${text}`;
  });
  return `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,${fontSize},&H00FFFFFF,&H0000C8FF,&H00000000,&HFF000000,-1,0,0,0,100,100,0,0,1,3,0,8,60,60,980,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${ev.join("\n")}
`;
}
