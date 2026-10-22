'use strict';

// Efectos de sonido propios para los videos (sintetizados acá, sin muestras ni
// derechos de terceros). Recibe la duración de cada cuadro y devuelve un WAV
// estéreo de 44,1 kHz alineado con el video:
//   entrada    → barrido suave y un reloj bajito mientras se lee la pista
//   3, 2, 1    → tic de reloj (el último, más agudo)
//   respuesta  → campanita de acierto (do–mi–sol)
//   explicación→ «pop» suave
//   cierre     → dos notas de despedida

const RATE = 44100;

function soundtrack(durations) {
  const total = durations.reduce((s, d) => s + d, 0);
  const n = Math.ceil(total * RATE);
  const buf = new Float32Array(n);
  const starts = []; let t = 0;
  for (const d of durations) { starts.push(t); t += d; }

  // Suma una nota con ataque corto y caída exponencial.
  const tone = (at, freq, { len = 0.6, vol = 0.25, decay = 6, attack = 0.005, glide = 0, harmonics = [1] } = {}) => {
    const s0 = Math.floor(at * RATE); const len0 = Math.floor(len * RATE);
    let phase = harmonics.map(() => 0);
    for (let i = 0; i < len0 && s0 + i < n; i++) {
      const x = i / RATE;
      const env = Math.min(1, x / attack) * Math.exp(-decay * x);
      const f = freq * (1 + glide * x);
      let v = 0;
      harmonics.forEach((h, k) => { phase[k] += (2 * Math.PI * f * h) / RATE; v += Math.sin(phase[k]) / (k + 1); });
      buf[s0 + i] += v * env * vol;
    }
  };
  // Ruido filtrado que sube y baja: un barrido.
  const sweep = (at, len, vol) => {
    const s0 = Math.floor(at * RATE); const len0 = Math.floor(len * RATE);
    let seed = 7; let lp = 0;
    for (let i = 0; i < len0 && s0 + i < n; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const white = (seed / 0x7fffffff) * 2 - 1;
      const p = i / len0;
      const cut = 0.02 + 0.25 * Math.sin(Math.PI * p);
      lp += cut * (white - lp);
      buf[s0 + i] += lp * Math.sin(Math.PI * p) * vol;
    }
  };

  const [intro, c3, c2, c1, answer, why, end] = starts;
  sweep(intro, 0.7, 0.5);
  tone(intro + 0.15, 392, { len: 0.5, vol: 0.12, decay: 7, harmonics: [1, 2] });
  // Mientras se lee la pista, un reloj muy bajito.
  for (let k = intro + 1; k < c3 - 0.2; k += 0.5) tone(k, 900, { len: 0.06, vol: 0.06, decay: 60 });
  for (const [at, f] of [[c3, 1200], [c2, 1200], [c1, 1600]]) {
    tone(at, f, { len: 0.12, vol: 0.28, decay: 40, harmonics: [1, 2.7] });
    tone(at + 0.5, f * 0.75, { len: 0.08, vol: 0.12, decay: 50 });
  }
  // Acierto: arpegio do–mi–sol (C6, E6, G6) y un do agudo.
  [1046.5, 1318.5, 1568, 2093].forEach((f, i) => tone(answer + i * 0.09, f, { len: 1.6, vol: 0.16, decay: 3, harmonics: [1, 2, 3] }));
  tone(why, 320, { len: 0.12, vol: 0.3, decay: 30, glide: -2.5 });
  tone(end, 784, { len: 1.2, vol: 0.15, decay: 3.5, harmonics: [1, 2] });
  tone(end + 0.22, 1046.5, { len: 1.8, vol: 0.15, decay: 2.5, harmonics: [1, 2] });

  // Límite suave y WAV de 16 bits estéreo.
  const out = Buffer.alloc(44 + n * 4);
  out.write('RIFF', 0); out.writeUInt32LE(36 + n * 4, 4); out.write('WAVE', 8);
  out.write('fmt ', 12); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(2, 22);
  out.writeUInt32LE(RATE, 24); out.writeUInt32LE(RATE * 4, 28); out.writeUInt16LE(4, 32); out.writeUInt16LE(16, 34);
  out.write('data', 36); out.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.round(Math.tanh(buf[i] * 1.2) * 0.9 * 32767);
    out.writeInt16LE(v, 44 + i * 4); out.writeInt16LE(v, 46 + i * 4);
  }
  return out;
}

module.exports = { soundtrack };
