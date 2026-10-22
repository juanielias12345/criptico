'use strict';

// Convierte el texto de un documento legal (Markdown simple: títulos, listas,
// tablas, negritas) en HTML seguro. Todo se escapa antes de dar formato.

const { esc } = require('./layout');

const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

function legalHtml(text, { skipTitle = true } = {}) {
  const lines = String(text).split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    let m;
    if ((m = line.match(/^(#{1,3})\s+(.*)$/))) {
      if (!(skipTitle && m[1] === '#')) out.push(`<h${m[1].length + 1}>${inline(m[2])}</h${m[1].length + 1}>`);
      i++; continue;
    }
    if (/^\|/.test(line)) {
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) { rows.push(lines[i]); i++; }
      const cells = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const body = rows.filter((r) => !/^\|\s*-/.test(r));
      const [head, ...rest] = body;
      out.push(`<div class="table-wrap"><table class="legal-table"><thead><tr>${cells(head).map((c) => `<th scope="col">${inline(c)}</th>`).join('')}</tr></thead><tbody>${rest.map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if ((m = line.match(/^(\s*)(-|\d+\.)\s+/))) {
      const ordered = /\d/.test(m[2]);
      const items = [];
      while (i < lines.length && /^(-|\d+\.)\s+/.test(lines[i].trim())) { items.push(lines[i].trim().replace(/^(-|\d+\.)\s+/, '')); i++; }
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.map((x) => `<li>${inline(x)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#|\||-\s|\d+\.\s)/.test(lines[i].trim())) { para.push(lines[i].trim()); i++; }
    out.push(`<p>${inline(para.join(' '))}</p>`);
  }
  return out.join('\n');
}

// Título del documento: la primera línea «# …».
const legalTitle = (text) => ((String(text).match(/^#\s+(.+)$/m) || [])[1] || '').trim();

module.exports = { legalHtml, legalTitle };
