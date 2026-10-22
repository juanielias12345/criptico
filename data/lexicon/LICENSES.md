# Léxico del generador: fuentes y licencias

`es.json.gz` y `en.json.gz` se construyen con `scripts/lexicon/build.py` a partir
de las fuentes de abajo. Solo los usa el generador del banco de crípticos
(nunca las partidas). Las pistas generadas no copian texto de estas fuentes:
usan relaciones entre palabras y plantillas propias.

Cada archivo es una adaptación que incluye frecuencias de wordfreq (CC BY-SA 4.0),
por lo que el conjunto se distribuye bajo **CC BY-SA 4.0**, respetando además los
avisos de cada componente:

| Clave en el JSON | Fuente | Licencia y aviso |
|---|---|---|
| `synsets`, `words` (inglés) y relaciones (español) | Princeton WordNet 3.0 | Licencia de WordNet 3.0 (texto abajo) |
| `words`, `synsets` (español) | Multilingual Central Repository 3.0, Gonzalez-Agirre, Laparra y Rigau (2012), vía Open Multilingual Wordnet | CC BY 3.0 — https://creativecommons.org/licenses/by/3.0/ |
| `thes` (español) | OpenThesaurus – Tesauro Español, Marcelo Garrone y colaboradores (LibreOffice dictionaries) | LGPL 2.1 — https://www.gnu.org/licenses/old-licenses/lgpl-2.1.html. Fuente: https://github.com/LibreOffice/dictionaries/tree/master/es |
| `pron` (inglés) | CMU Pronouncing Dictionary 0.7a | BSD (aviso abajo) |
| frecuencia de cada palabra | wordfreq 3.1, Robyn Speer | Datos CC BY-SA 4.0 — https://github.com/rspeer/wordfreq |

Conviene que un asesor legal revise esta compilación antes de usar el léxico fuera de este proyecto.

## WordNet 3.0 License

WordNet Release 3.0. This software and database is being provided to you, the LICENSEE, by
Princeton University under the following license. By obtaining, using and/or copying this
software and database, you agree that you have read, understood, and will comply with these
terms and conditions.:

Permission to use, copy, modify and distribute this software and database and its
documentation for any purpose and without fee or royalty is hereby granted, provided that you
agree to comply with the following copyright notice and statements, including the disclaimer,
and that the same appear on ALL copies of the software, database and documentation, including
modifications that you make for internal use or for distribution.

WordNet 3.0 Copyright 2006 by Princeton University. All rights reserved.

THIS SOFTWARE AND DATABASE IS PROVIDED "AS IS" AND PRINCETON UNIVERSITY MAKES NO
REPRESENTATIONS OR WARRANTIES, EXPRESS OR IMPLIED. BY WAY OF EXAMPLE, BUT NOT LIMITATION,
PRINCETON UNIVERSITY MAKES NO REPRESENTATIONS OR WARRANTIES OF MERCHANT- ABILITY OR FITNESS
FOR ANY PARTICULAR PURPOSE OR THAT THE USE OF THE LICENSED SOFTWARE, DATABASE OR
DOCUMENTATION WILL NOT INFRINGE ANY THIRD PARTY PATENTS, COPYRIGHTS, TRADEMARKS OR OTHER
RIGHTS.

The name of Princeton University or Princeton may not be used in advertising or publicity
pertaining to distribution of the software and/or database. Title to copyright in this
software, database and any associated documentation shall at all times remain with Princeton
University and LICENSEE agrees to preserve same.

## CMU Pronouncing Dictionary

Copyright (C) 1993-2008 Carnegie Mellon University. All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are
permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of
   conditions and the following disclaimer. The contents of this file are deemed to be
   source code.
2. Redistributions in binary form must reproduce the above copyright notice, this list of
   conditions and the following disclaimer in the documentation and/or other materials
   provided with the distribution.

This work was supported in part by funding from the Defense Advanced Research Projects Agency,
the Office of Naval Research and the National Science Foundation of the United States of
America, and by member companies of the Carnegie Mellon Sphinx Speech Consortium. We
acknowledge the contributions of many volunteers to the expansion and improvement of this
dictionary.

THIS SOFTWARE IS PROVIDED BY CARNEGIE MELLON UNIVERSITY ``AS IS'' AND ANY EXPRESSED OR IMPLIED
WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL CARNEGIE MELLON UNIVERSITY
NOR ITS EMPLOYEES BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR
OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.
