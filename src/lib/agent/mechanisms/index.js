'use strict';

// Agentes especializados por mecanismo (ver docs/AGENTE.md, «Agentes por mecanismo»).
// Cada módulo define sus reglas formales, la forma del desglose, las instrucciones
// para el generador, los indicadores admitidos y su validador propio, que corre
// sobre el árbol ya resuelto por el validador general (que rearma la respuesta
// letra por letra). Un mecanismo entra en producción solo con status 'production'.

const modules = [
  require('./anagram'), require('./hidden'), require('./reversal'), require('./container'), require('./deletion'),
  require('./charade'), require('./homophone'), require('./double-definition'), require('./initials'), require('./combination'),
];
const BY_CODE = Object.fromEntries(modules.map((m) => [m.code, m]));
const NOT_AUTOMATED = require('./not-automated');

const get = (code) => BY_CODE[code] || null;
const production = () => modules.filter((m) => m.status === 'production').map((m) => m.code);

// Taxonomía para el panel: todos los mecanismos evaluados, con su estado y sus reglas.
function taxonomy() {
  return [
    ...modules.map((m) => ({ code: m.code, label: m.label, status: m.status, rules: m.rules })),
    ...NOT_AUTOMATED.map((m) => ({ code: m.code, label: m.label, status: m.status, rules: [m.why] })),
  ];
}

module.exports = { modules, get, production, taxonomy, NOT_AUTOMATED };
