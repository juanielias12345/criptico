'use strict';

// Generador y revisor simulados para las pruebas del agente. El generador
// «escribe» con el motor determinista del banco (pistas que se pueden
// verificar); el revisor responde lo que la prueba le pida. Cuentan tokens
// como la API para probar el control de costos.

const { engine } = require('../../src/lib/bank/generate');
const { mechanismClass } = require('../../src/services/library-agent');
const L = () => require('../../src/lib/bank/lexicon').load('es');

function slotsOf(user) {
  const out = [];
  for (const m of user.matchAll(/- slot (\d+): respuesta (\S+) \([^)]*\), mecanismo (\w+), dificultad (\d)/g)) out.push({ slot: Number(m[1]), answer: m[2], mechanism: m[3] });
  return out;
}

function fakeLlm({ verdict = () => 'ok', mutate = (c) => c, fail = null, generatorModel, reviewerModel, usage = { input_tokens: 2000, output_tokens: 1500 } } = {}) {
  const calls = { generator: 0, reviewer: 0 };
  return {
    available: true,
    calls,
    async json({ model, user, schema }) {
      if (fail) { const e = fail(calls); if (e) throw e; }
      if (schema.properties.candidates) {
        calls.generator++;
        const E = engine('es');
        const candidates = slotsOf(user).map((s) => {
          const i = L().byText.get(s.answer.toLowerCase());
          const c = i === undefined ? null : E.candidates(i).find((x) => mechanismClass(x.wordplay) === s.mechanism && !x.variant_code);
          if (!c) return { slot: s.slot, skip: true, clue: '', definition: '', mechanism: s.mechanism, wordplay_json: '{}', regional_words: [], notes: '' };
          return mutate({ slot: s.slot, skip: false, clue: c.clue_text, definition: c.definition || '', mechanism: s.mechanism, wordplay_json: JSON.stringify(c.wordplay), regional_words: [], notes: '' }, s);
        });
        return { data: { candidates }, usage, model: generatorModel || model, stop: 'end_turn' };
      }
      calls.reviewer++;
      const ids = [...user.matchAll(/^id (\d+) /gm)].map((m) => m[1]);
      const reviews = ids.map((id) => {
        const v = verdict(id, user);
        return { id, solves: v !== 'bad', fair: true, natural: true, variant_ok: true, alternative_answer: '', copied_suspect: false, verdict: v, issues: v === 'ok' ? [] : ['dudoso'] };
      });
      return { data: { reviews }, usage: { input_tokens: 1500, output_tokens: 600 }, model: reviewerModel || model, stop: 'end_turn' };
    },
  };
}

module.exports = { fakeLlm, slotsOf };
