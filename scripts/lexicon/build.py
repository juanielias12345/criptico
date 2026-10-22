#!/usr/bin/env python3
"""Construye el léxico del generador de crípticos (data/lexicon/<lang>.json.gz).

Se ejecuta a mano, fuera de la aplicación, y su resultado se guarda en el
repositorio. Ninguna partida ni ningún despliegue consulta estas fuentes.

Fuentes (todas de licencia abierta; ver docs/BANCO.md):
  - Princeton WordNet 3.0 (licencia WordNet 3.0, permisiva).
      https://raw.githubusercontent.com/nltk/nltk_data/gh-pages/packages/corpora/wordnet.zip
  - Multilingual Central Repository 3.0, wordnet en español (CC BY 3.0),
    distribuido por Open Multilingual Wordnet.
      https://raw.githubusercontent.com/omwn/omw-data/main/wns/mcr/wn-data-spa.tab
  - CMU Pronouncing Dictionary 0.7a (BSD), solo para homófonos en inglés.
      https://raw.githubusercontent.com/nltk/nltk_data/gh-pages/packages/corpora/cmudict.zip
  - wordfreq 3.1 (frecuencias de uso; datos CC BY-SA 4.0). Solo se guarda una
    frecuencia redondeada por palabra para ordenar por uso.
  - OpenThesaurus español 2012 (LGPL 2.1), solo como segunda fuente: en español
    una sinonimia se acepta cuando la confirman el wordnet y el tesauro a la vez.
      https://raw.githubusercontent.com/LibreOffice/dictionaries/master/es/th_es_v2.dat

Uso:
  python3 -m venv venv && venv/bin/pip install wordfreq
  venv/bin/python scripts/lexicon/build.py --src <carpeta con wordnet/, cmudict/ y wn-data-spa.tab> --out data/lexicon
"""

import argparse
import collections
import gzip
import json
import os
import re
import unicodedata

import wordfreq

# Marcas de uso de WordNet que excluyen un sentido: marcas comerciales,
# argot, arcaísmos, términos despectivos u obscenos.
BLOCKED_USAGE = {
    '06845599n',  # trade_name
    '06851742n',  # trademark
    '07157273n',  # slang
    '07073447n',  # archaism
    '06717170n',  # disparagement
    '06718862n',  # ethnic_slur
    '07124340n',  # obscenity
}
REGION = {'08860123n': 'GB', '09044862n': 'US'}

# Palabras que nunca deben aparecer en una pista ni como respuesta, aunque el
# diccionario no las marque. Lista conservadora; se amplía desde el panel.
BLOCKLIST = {
    'es': set('''puta puto marica maricón mierda coño joder polla cojón cojones verga pija concha culo follar
    culear pendejo pendeja cabrón cabrona gilipollas mamón mamada zorra perra hijueputa negro negra indio
    india gitano gitana moro mora sudaca judío judía chino china retrasado retrasada mongólico subnormal
    tullido lisiado enano enana gordo gorda feo fea idiota imbécil estúpido estúpida tarado tarada bastardo
    bastarda prostituta ramera violación violar violador asesinar asesino genocidio nazi suicidio suicidar
    cocaína heroína droga drogas porno pornografía sexo sexual pene vagina teta tetas nalga pedo orinar
    cagar cagada vomitar hostia boludo boluda pelotudo pelotuda forro ojete mamar pajero paja chingar chingada
    pinche cojudo huevón huevon carajo culiar garchar orto pito chota choto poronga pete petear coger cogida
    mamado trolo puto putear concha conchudo'''.split()),
    'en': set('''fuck shit cunt cock dick prick pussy bitch bastard slut whore wanker twat arse ass asshole piss
    crap damn nigger nigga negro coon spic chink gook kike wop dago fag faggot dyke queer tranny retard
    retarded spastic cripple midget gypsy jap paki honky cracker redneck hooker prostitute rape rapist
    murder murderer genocide nazi suicide cocaine heroin porn porno sex sexual penis vagina tit tits boob
    boobs fart vomit idiot moron imbecile stupid ugly fat bollocks bloody bugger sod tosser bonk shag
    screw bum turd wank knob slag tart'''.split()),
}


def strip(s):
    return ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn')


def clean(lemma):
    return lemma.replace('_', ' ').strip()


def valid_text(t, lang):
    allowed = r"a-záéíóúüñ" if lang == 'es' else r"a-z"
    return re.fullmatch(rf"[{allowed}]+( [{allowed}]+){{0,2}}", t) is not None


def read_wordnet(src):
    synsets = {}
    for pos in ['noun', 'verb', 'adj', 'adv']:
        with open(os.path.join(src, 'wordnet', 'data.' + pos), encoding='latin-1') as f:
            for line in f:
                if line.startswith('  '):
                    continue
                head = line.split(' | ')[0].split()
                off, lexfile, ss = head[0], int(head[1]), head[2]
                p = 'a' if ss in ('a', 's') else ss
                n = int(head[3], 16)
                words = [head[4 + 2 * i] for i in range(n)]
                i = 4 + 2 * n
                m = int(head[i]); i += 1
                hyper, usage, region, instance = [], False, None, False
                for _ in range(m):
                    sym, to, tp = head[i], head[i + 1], head[i + 2]
                    i += 4
                    key = to + ('a' if tp in ('a', 's') else tp)
                    if sym in ('@',):
                        hyper.append(key)
                    if sym == '@i':
                        instance = True
                    if sym == ';u' and key in BLOCKED_USAGE:
                        usage = True
                    if sym == ';r' and key in REGION:
                        region = REGION[key]
                synsets[off + p] = {'pos': p, 'lex': lexfile, 'en': words, 'hyper': hyper,
                                    'blocked': usage, 'region': region, 'instance': instance}
    # Peso de cada sentido según el corpus etiquetado de WordNet (cntlist).
    weight = collections.Counter()
    sense_off = {}
    with open(os.path.join(src, 'wordnet', 'index.sense'), encoding='latin-1') as f:
        for line in f:
            key, off, _num, cnt = line.split()
            ss = int(key.split('%')[1].split(':')[0])
            p = {1: 'n', 2: 'v', 3: 'a', 4: 'r', 5: 'a'}[ss]
            weight[off + p] += int(cnt)
            sense_off[key] = off + p
    # Orden de sentidos por palabra en inglés (index.<pos> los lista por frecuencia).
    order = {}
    for pos, p in [('noun', 'n'), ('verb', 'v'), ('adj', 'a'), ('adv', 'r')]:
        with open(os.path.join(src, 'wordnet', 'index.' + pos), encoding='latin-1') as f:
            for line in f:
                if line.startswith('  '):
                    continue
                parts = line.split()
                lemma = parts[0]
                synset_cnt = int(parts[2])
                offs = parts[-synset_cnt:]
                order.setdefault(lemma, []).extend(o + p for o in offs)
    return synsets, weight, order


def read_mcr(src):
    lemmas = collections.defaultdict(list)
    with open(os.path.join(src, 'wn-data-spa.tab'), encoding='utf-8') as f:
        for line in f:
            if line.startswith('#'):
                continue
            parts = line.rstrip('\n').split('\t')
            if len(parts) < 3:
                continue
            sid, kind, val = parts[:3]
            if kind != 'spa:lemma':
                continue
            off, p = sid.split('-')
            lemmas[off + ('a' if p == 's' else p)].append(val)
    return lemmas


def read_cmudict(src):
    pron = collections.defaultdict(list)
    with open(os.path.join(src, 'cmudict', 'cmudict'), encoding='latin-1') as f:
        for line in f:
            parts = line.split()
            if len(parts) < 3:
                continue
            word = parts[0]
            if not re.fullmatch(r"[A-Z]+", word):
                continue
            # sin acentos de intensidad: dos palabras son homófonas si coinciden los fonemas
            pron[word].append(' '.join(re.sub(r'\d', '', x) for x in parts[2:]))
    return pron


def read_thesaurus(src):
    path = os.path.join(src, 'lo_th_es_v2.dat')
    pairs = collections.defaultdict(set)
    with open(path, encoding='latin-1') as f:
        f.readline()
        head = None
        for line in f:
            line = line.rstrip('\n')
            if not line.startswith('-|') and '|' in line:
                head = line.split('|')[0].strip().lower()
                continue
            if head is None:
                continue
            for w in line.split('|')[1:]:
                w = re.sub(r'\s*\(.*?\)\s*', ' ', w).strip().lower()
                if w and w != head:
                    pairs[head].add(w)
                    pairs[w].add(head)
    return pairs


ES_ACCENT = str.maketrans('áéíóú', 'aeiou')
ES_ADD_ACCENT = {'a': 'á', 'e': 'é', 'i': 'í', 'o': 'ó', 'u': 'ú'}


def plural_candidates(t, lang):
    """Formas de plural posibles de un sustantivo; se elige la que el corpus registra."""
    if lang == 'en':
        out = [t + 's']
        if re.search(r'(s|x|z|ch|sh)$', t):
            out.append(t + 'es')
        if re.search(r'[^aeiou]y$', t):
            out.append(t[:-1] + 'ies')
        if t.endswith('f'):
            out.append(t[:-1] + 'ves')
        if t.endswith('fe'):
            out.append(t[:-2] + 'ves')
        if re.search(r'[^aeiou]o$', t):
            out.append(t + 'es')
        return out
    out = []
    if re.search(r'[aeiouáéó]$', t):
        out.append(t + 's')
    elif re.search(r'[íú]$', t):
        out += [t + 'es', t + 's']
    elif t.endswith('z'):
        out.append(t[:-1] + 'ces')
    elif re.search(r'[^aeiouáéíóú][s]$', t) or t.endswith('x'):
        return []
    else:
        base = t + 'es'
        out.append(base)
        # camión → camiones (pierde la tilde); joven → jóvenes (la gana)
        out.append(base.translate(ES_ACCENT) if re.search(r'[áéíóú]', t[-3:]) else base)
        vowels = [k for k, ch in enumerate(t) if ch in 'aeiou']
        if len(vowels) >= 2 and not re.search(r'[áéíóú]', t):
            k = vowels[-2]
            out.append(t[:k] + ES_ADD_ACCENT[t[k]] + t[k + 1:] + 'es')
    return out


def plural_of(t, lang, exceptions):
    if t in exceptions:
        return exceptions[t]
    best, bz = None, 0.0
    for c in dict.fromkeys(plural_candidates(t, lang)):
        z = wordfreq.zipf_frequency(c, lang)
        if z > bz:
            best, bz = c, z
    return best if bz >= 1.5 else None


def read_noun_exceptions(src):
    # noun.exc de WordNet: plural irregular → singular
    out = {}
    with open(os.path.join(src, 'wordnet', 'noun.exc'), encoding='latin-1') as f:
        for line in f:
            parts = line.split()
            if len(parts) >= 2 and '_' not in parts[0]:
                out.setdefault(parts[1], parts[0])
    return out


def build(lang, synsets, weight, order, mcr, pron, min_zipf, thes=None, exceptions=None):
    words = {}            # texto → {z, senses: [(rank, sid)]}

    def add(text, sid, rank):
        if text in BLOCKLIST[lang] or any(w in BLOCKLIST[lang] for w in text.split()):
            return
        if text not in words:
            z = wordfreq.zipf_frequency(text, lang)
            if z < min_zipf:
                return
            words[text] = {'z': round(z, 2), 'senses': []}
        words[text]['senses'].append((rank, sid))

    for sid, s in synsets.items():
        if s['blocked'] or s['instance']:
            continue
        if lang == 'en':
            for raw in s['en']:
                raw = re.sub(r'\(.*\)$', '', raw)        # marcas sintácticas de adjetivos: (a), (p)
                if raw != raw.lower():
                    continue                              # nombres propios y siglas
                text = clean(raw)
                if not valid_text(text, 'en'):
                    continue
                ranks = order.get(raw.lower(), [])
                rank = ranks.index(sid) if sid in ranks else 99
                add(text, sid, rank)
        else:
            for raw in mcr.get(sid, []):
                if raw != raw.lower():
                    continue
                text = clean(raw)
                if not valid_text(text, 'es'):
                    continue
                add(text, sid, None)

    if lang == 'es':
        # Sin orden de sentidos propio: se ordenan por el peso del sentido en el corpus de WordNet.
        for w in words.values():
            ranked = sorted(w['senses'], key=lambda rs: -weight[rs[1]])
            w['senses'] = [(i, sid) for i, (_, sid) in enumerate(ranked)]
    else:
        for w in words.values():
            w['senses'].sort()

    used = sorted({sid for w in words.values() for _, sid in w['senses']})
    index = {sid: i for i, sid in enumerate(used)}
    members = collections.defaultdict(list)
    word_list = sorted(words)
    widx = {t: i for i, t in enumerate(word_list)}
    for t in word_list:
        for _, sid in words[t]['senses']:
            members[sid].append(widx[t])
    syn_out = []
    for sid in used:
        s = synsets[sid]
        syn_out.append({
            'id': sid, 'p': s['pos'], 'x': s['lex'],
            'w': members[sid],
            'h': [index[h] for h in s['hyper'] if h in index],
            **({'r': s['region']} if s['region'] else {}),
        })
    word_out = [[t, words[t]['z'], [index[sid] for _, sid in words[t]['senses']]] for t in word_list]
    out = {
        'lang': lang,
        'sources': SOURCES[lang],
        'words': word_out,       # [texto, frecuencia zipf, [synsets por orden de uso]]
        'synsets': syn_out,      # {id WordNet 3.0, p: categoría, x: archivo léxico, w: palabras, h: hiperónimos, r: región}
    }
    if lang == 'en':
        out['pron'] = {t: pron[t.upper()] for t in word_list if ' ' not in t and t.upper() in pron}
    # Plural de los sustantivos de una palabra (y de la cabeza de los de varias),
    # verificado contra el corpus de frecuencias: el generador lo usa para
    # respuestas y definiciones en plural, que concuerdan entre sí.
    plurals = {}
    for t in word_list:
        senses = words[t]['senses']
        if not senses or synsets[senses[0][1]]['pos'] != 'n':
            continue
        parts = t.split(' ')
        head = 0 if lang == 'es' else len(parts) - 1
        p = plural_of(parts[head], lang, exceptions or {})
        if p and p != parts[head]:
            parts[head] = p
            plurals[t] = ' '.join(parts)
    out['plural'] = plurals
    if thes is not None:
        # Solo pares entre palabras del léxico: es la confirmación, no una lista nueva.
        out['thes'] = {t: sorted(widx[x] for x in thes.get(t, ()) if x in widx) for t in word_list}
        out['thes'] = {t: v for t, v in out['thes'].items() if v}
    return out


SOURCES = {
    'es': [
        {'name': 'Multilingual Central Repository 3.0 (wordnet en español)', 'license': 'CC BY 3.0',
         'url': 'https://adimen.si.ehu.es/web/MCR/',
         'attribution': 'Gonzalez-Agirre, Laparra y Rigau (2012), Multilingual Central Repository 3.0.'},
        {'name': 'Princeton WordNet 3.0 (relaciones entre sentidos)', 'license': 'WordNet 3.0 License',
         'url': 'https://wordnet.princeton.edu/license-and-commercial-use',
         'attribution': 'WordNet 3.0 Copyright 2006 by Princeton University.'},
        {'name': 'wordfreq 3.1 (frecuencias)', 'license': 'CC BY-SA 4.0 (datos)',
         'url': 'https://github.com/rspeer/wordfreq', 'attribution': 'Robyn Speer, wordfreq v3.1.'},
        {'name': 'OpenThesaurus español (confirmación de sinónimos)', 'license': 'LGPL 2.1',
         'url': 'https://github.com/LibreOffice/dictionaries/tree/master/es',
         'attribution': 'Marcelo Garrone y colaboradores, OpenThesaurus - Tesauro Español.'},
    ],
    'en': [
        {'name': 'Princeton WordNet 3.0', 'license': 'WordNet 3.0 License',
         'url': 'https://wordnet.princeton.edu/license-and-commercial-use',
         'attribution': 'WordNet 3.0 Copyright 2006 by Princeton University.'},
        {'name': 'CMU Pronouncing Dictionary 0.7a', 'license': 'BSD-2-Clause',
         'url': 'http://www.speech.cs.cmu.edu/cgi-bin/cmudict',
         'attribution': 'Copyright (C) 1993-2008 Carnegie Mellon University.'},
        {'name': 'wordfreq 3.1 (frecuencias)', 'license': 'CC BY-SA 4.0 (datos)',
         'url': 'https://github.com/rspeer/wordfreq', 'attribution': 'Robyn Speer, wordfreq v3.1.'},
    ],
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--min-zipf', type=float, default=2.0)
    a = ap.parse_args()
    synsets, weight, order = read_wordnet(a.src)
    mcr = read_mcr(a.src)
    pron = read_cmudict(a.src)
    thes = read_thesaurus(a.src)
    exceptions = read_noun_exceptions(a.src)
    os.makedirs(a.out, exist_ok=True)
    for lang in ['es', 'en']:
        data = build(lang, synsets, weight, order, mcr, pron, a.min_zipf, thes if lang == 'es' else None,
                     exceptions if lang == 'en' else None)
        path = os.path.join(a.out, lang + '.json.gz')
        with gzip.open(path, 'wt', encoding='utf-8', compresslevel=9) as f:
            json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
        print(lang, len(data['words']), 'palabras', len(data['synsets']), 'sentidos', os.path.getsize(path), 'bytes')


if __name__ == '__main__':
    main()
