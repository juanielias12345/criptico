'use strict';

// Acceso a la API de Claude para el Agente Autónomo de Biblioteca.
// Dos usos, con modelos distintos: el generador propone candidatos y el revisor
// hace la evaluación final independiente. Ninguno de los dos aprueba por sí
// solo: lo que proponen pasa antes por los controles deterministas del agente.
//
// El cliente se puede reemplazar (pruebas): cualquier objeto con
// `beta.messages.create(params)` que responda como la API.

const PROMPT_VERSION = 'agent-prompt-2.0';

// Errores que no se arreglan reintentando: credenciales, permisos o un pedido mal armado.
class CriticalLlmError extends Error {
  constructor(message, code) { super(message); this.code = code; this.critical = true; }
}

function createLlm({ apiKey = process.env.ANTHROPIC_API_KEY, client } = {}) {
  let sdk = null;
  if (!client && apiKey) {
    const Anthropic = require('@anthropic-ai/sdk').default;
    sdk = require('@anthropic-ai/sdk');
    client = new Anthropic({ apiKey, maxRetries: 2, timeout: 10 * 60 * 1000 });
  }
  return {
    available: Boolean(client),
    // Una llamada con salida JSON validada por esquema.
    async json({ model, system, user, schema, maxTokens = 16000, effort = 'medium' }) {
      if (!client) throw new CriticalLlmError('Falta ANTHROPIC_API_KEY', 'missing_credentials');
      let res;
      try {
        res = await client.beta.messages.create({
          model,
          max_tokens: maxTokens,
          system,
          messages: [{ role: 'user', content: user }],
          output_config: { effort, format: { type: 'json_schema', schema } },
          // Si el modelo declina, la API reintenta con otro modelo en la misma llamada.
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
        });
      } catch (e) {
        if (sdk && (e instanceof sdk.AuthenticationError || e instanceof sdk.PermissionDeniedError)) throw new CriticalLlmError(e.message, 'credentials_rejected');
        if (sdk && e instanceof sdk.BadRequestError) throw new CriticalLlmError(e.message, 'bad_request');
        if (e && (e.status === 401 || e.status === 403)) throw new CriticalLlmError(e.message, 'credentials_rejected');
        if (e && e.status === 400) throw new CriticalLlmError(e.message, 'bad_request');
        throw e;                                   // 429, 5xx, red: transitorio
      }
      const usage = { input_tokens: (res.usage && res.usage.input_tokens) || 0, output_tokens: (res.usage && res.usage.output_tokens) || 0,
        cache_read_input_tokens: (res.usage && res.usage.cache_read_input_tokens) || 0 };
      const served = res.model || model;
      if (res.stop_reason === 'refusal') return { data: null, usage, model: served, stop: 'refusal' };
      if (res.stop_reason === 'max_tokens') return { data: null, usage, model: served, stop: 'max_tokens' };
      const text = (res.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
      let data = null;
      try { data = JSON.parse(text); } catch { return { data: null, usage, model: served, stop: 'invalid_json' }; }
      return { data, usage, model: served, stop: res.stop_reason };
    },
  };
}

// Costo en dólares con la tabla de precios configurada. Sin precio para el
// modelo que respondió, devuelve null: el agente se detiene.
function costOf(prices, model, usage) {
  const p = prices && (prices[model] || prices[String(model).replace(/-\d{8}$/, '')]);
  if (!p) return null;
  return ((usage.input_tokens || 0) * p[0] + (usage.output_tokens || 0) * p[1]) / 1e6;
}

// Costo máximo posible de una llamada (para no pasarse del presupuesto).
function maxCostOf(prices, model, inputTokensEstimate, maxTokens) {
  const p = prices && prices[model];
  if (!p) return null;
  return (inputTokensEstimate * p[0] + maxTokens * p[1]) / 1e6;
}

// La forma de cada mecanismo y sus reglas las define su agente (src/lib/agent/mechanisms).
const MECH = require('./mechanisms');
const MECHANISM_HELP = Object.fromEntries(MECH.modules.map((m) => [m.code, `${m.label.toLowerCase()}: ${m.shape}`]));

// Instrucciones del agente de un mecanismo: las reglas comunes más las propias del mecanismo.
function generatorSystem(mechanism) {
  const m = mechanism ? MECH.get(mechanism) : null;
  const own = m ? ['', `Sos el agente especialista en ${m.label.toLowerCase()}. Solo escribís pistas de este mecanismo.`,
    `Forma del desglose: ${m.shape}`, 'Reglas del mecanismo (un control automático las comprueba y rechaza lo que no las cumple):',
    ...m.rules.map((x) => '- ' + x), 'Cómo trabajar:', ...m.guide.map((x) => '- ' + x),
    '- El desglose tiene que ser el procedimiento que realmente produce la respuesta: no inventes una regla para justificarla después.'] : [];
  return [
    'Sos el autor de crípticos de Play Crípticos. Escribís pistas crípticas originales en español, correctas y con superficie natural.',
    'Cada pista tiene una definición (al principio o al final) y un juego de palabras que produce exactamente la respuesta.',
    'Reglas obligatorias:',
    '- La pista termina con la longitud entre paréntesis, por ejemplo (5) o (4,3).',
    '- La definición tiene que ser, palabra por palabra, una de las definiciones que te doy para esa respuesta.',
    '- Los indicadores salen de la lista que te doy para cada mecanismo. Las abreviaturas, de la tabla que te doy.',
    '- Un sinónimo dentro del juego de palabras ("op":"syn") se escribe con "from" (las palabras de la pista) y "text" (la palabra que aporta, con tildes).',
    '- Toda palabra de la pista cumple una función: definición, indicador, material o una palabra de enlace corta (de, para, y, en, con...).',
    '- No uses la respuesta escrita en la pista. No copies pistas publicadas de otros autores: todo tiene que ser creación propia.',
    '- Escribí para la variante indicada. Si usás una palabra regional, ponela en "regional_words"; si no, dejá la lista vacía.',
    '- No traduzcas pistas de otro idioma ni fuerces un mecanismo: si para una respuesta el mecanismo pedido no sale natural, devolvé "skip": true.',
    '- "wordplay_json" es el árbol del juego de palabras en JSON (como texto). Nodos: lit {text}, syn {from,text}, abbr {from,text}, letter {from,text},',
    '  concat {parts}, anagram {of:[...],indicator}, reverse {of,indicator}, insert {outer,inner,indicator}, delete {of,remove,indicator},',
    '  hidden {in,indicator}, initials {in,indicator}, homophone {of,indicator}, double {definitions}.',
    ...own,
  ].join('\n');
}

function generatorUser({ variant, slots, indicators, abbreviations }) {
  const lines = [`Variante: ${variant.code} (${variant.name}).`, '', 'Pedidos (uno por línea, respondé uno por pedido con su número de "slot"):'];
  for (const s of slots) {
    lines.push(`- slot ${s.slot}: respuesta ${s.answer} (${s.enumeration}), mecanismo ${s.mechanism}, dificultad ${s.difficulty} de 5. Definiciones admitidas: ${s.definitions.map((d) => `«${d}»`).join(', ')}.`);
  }
  lines.push('', 'Forma de cada mecanismo pedido:');
  for (const m of [...new Set(slots.map((s) => s.mechanism))]) lines.push(`- ${MECHANISM_HELP[m] || m}`);
  lines.push('', 'Indicadores admitidos por mecanismo:');
  for (const [k, v] of Object.entries(indicators)) lines.push(`- ${k}: ${v.join(', ')}`);
  lines.push('', 'Abreviaturas admitidas: ' + Object.entries(abbreviations).map(([k, v]) => `${k}=${v.join('/')}`).join('; '));
  return lines.join('\n');
}

const GENERATOR_SCHEMA = {
  type: 'object',
  properties: {
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          slot: { type: 'integer' },
          skip: { type: 'boolean' },
          clue: { type: 'string' },
          definition: { type: 'string' },
          mechanism: { type: 'string' },
          wordplay_json: { type: 'string' },
          regional_words: { type: 'array', items: { type: 'string' } },
          notes: { type: 'string' },
        },
        required: ['slot', 'skip', 'clue', 'definition', 'mechanism', 'wordplay_json', 'regional_words', 'notes'],
        additionalProperties: false,
      },
    },
  },
  required: ['candidates'],
  additionalProperties: false,
};

function reviewerSystem() {
  return [
    'Sos el editor final de crípticos de Play Crípticos. Revisás pistas crípticas en español que ya pasaron controles automáticos de letras.',
    'Tu trabajo es detectar lo que una máquina no ve. Sé estricto: ante la duda, "doubt".',
    'Para cada pista respondé:',
    '- solves: la respuesta resuelve la pista con la explicación dada, sin saltos.',
    '- fair: los indicadores y abreviaturas se entienden en contexto y la pista es justa para quien la resuelve.',
    '- natural: la superficie es español correcto y natural, no una frase forzada para encajar la solución.',
    '- variant_ok: el vocabulario y los usos son naturales en la variante indicada y ninguna palabra regional se asigna a la región equivocada.',
    '- alternative_answer: otra respuesta igual de válida, o "" si no hay.',
    '- copied_suspect: true si la reconocés como una pista publicada de otro autor.',
    '- verdict: "ok" solo si todo lo anterior está bien; "doubt" si algo no te convence; "bad" si hay un error.',
  ].join('\n');
}

function reviewerUser(items) {
  return items.map((x) => [
    `id ${x.id} · variante ${x.variant} (${x.variantName})`,
    `Pista: ${x.clue}`,
    `Respuesta: ${x.answer}`,
    `Definición: ${x.definition || '(doble definición)'}`,
    `Explicación: ${x.explanation.join(' ')}`,
  ].join('\n')).join('\n\n');
}

const REVIEWER_SCHEMA = {
  type: 'object',
  properties: {
    reviews: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          solves: { type: 'boolean' },
          fair: { type: 'boolean' },
          natural: { type: 'boolean' },
          variant_ok: { type: 'boolean' },
          alternative_answer: { type: 'string' },
          copied_suspect: { type: 'boolean' },
          verdict: { type: 'string', enum: ['ok', 'doubt', 'bad'] },
          issues: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'solves', 'fair', 'natural', 'variant_ok', 'alternative_answer', 'copied_suspect', 'verdict', 'issues'],
        additionalProperties: false,
      },
    },
  },
  required: ['reviews'],
  additionalProperties: false,
};

module.exports = { createLlm, costOf, maxCostOf, CriticalLlmError, PROMPT_VERSION, generatorSystem, generatorUser, GENERATOR_SCHEMA,
  reviewerSystem, reviewerUser, REVIEWER_SCHEMA, MECHANISM_HELP };
