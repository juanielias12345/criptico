'use strict';

// Arma los pedidos para Metricool de uno o varios días del calendario, tal como
// los programaría el panel (mismo armado que src/services/social.js).
// Se usa con el plan Starter, que no trae API: quien programa a mano o con el
// conector de Metricool copia cada pedido. Uso: node scripts/social/metricool-day.js 0-6

const plan = require('../../data/social/plan.json');
const { metricoolBody } = require('../../src/services/social');

const [a, b] = String(process.argv[2] || '0').split('-').map(Number);
const out = [];
for (const d of plan.days.filter((x) => x.n >= a && x.n <= (Number.isNaN(b) || b === undefined ? a : b))) {
  for (const p of d.pieces) {
    const body = metricoolBody({ ...p, assets: JSON.stringify(p.assets) }, 'https://playcripticos.com');
    body.publicationDate.timezone = 'America/Buenos_Aires';
    out.push({ id: p.id, day: d.n, date: `${body.publicationDate.dateTime}-03:00`, info: body });
  }
}
console.log(JSON.stringify(out, null, 2));
