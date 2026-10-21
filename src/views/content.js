'use strict';

// Textos largos de las páginas informativas. Las políticas son una base
// adaptable: antes de publicar en cada mercado conviene revisarlas con
// asesoramiento legal local (ver docs/LEGAL.md).

module.exports = {
  es: {
    help: `
<h2>¿Qué es un críptico?</h2>
<p>Un críptico es una pista con dos partes: una <strong>definición</strong> normal y un <strong>juego de palabras</strong> que lleva a la misma respuesta. La definición casi siempre está al principio o al final. El número entre paréntesis es la cantidad de letras; si hay varias palabras, aparecen separadas por comas, como (3,4).</p>
<h2>Mecanismos más comunes</h2>
<dl class="mech-list">
<dt>Anagrama</dt><dd>Palabras como <em>loco, revuelto, alterado</em> avisan que hay que reordenar letras. <em>Jamón loco para una religiosa (5)</em> → MONJA.</dd>
<dt>Palabra oculta</dt><dd><em>esconde, contiene, oculta</em>: la respuesta está escrita dentro de la pista. <em>Alemán gordo oculta una fruta tropical (5)</em> → aleMÁN GOrdo → MANGO.</dd>
<dt>Inversión</dt><dd><em>de vuelta, al revés</em>: se lee hacia atrás. <em>Oído que vuelve con rencor (4)</em> → ODIO.</dd>
<dt>Inserción</dt><dd><em>guarda, abraza, en</em>: un fragmento va dentro de otro. <em>Peso que guarda al rey: un recluso (5)</em> → P(R)ESO.</dd>
<dt>Eliminación</dt><dd><em>sin principio, sin fin, pierde</em>: se quitan letras.</dd>
<dt>Charada</dt><dd>Se unen piezas: <em>Astro rey y cubo de juego para un militar (7)</em> → SOL + DADO.</dd>
<dt>Homófono</dt><dd><em>se oye, suena, dicen</em>: la respuesta suena como otra palabra. Algunos dependen de la región: en el Río de la Plata «casa» y «caza» suenan igual; en buena parte de España, no.</dd>
<dt>Doble definición</dt><dd>Dos definiciones seguidas de la misma palabra.</dd>
<dt>Abreviaturas</dt><dd>Convenciones del género: N = norte, R = rey, O = oxígeno, I = uno (romano).</dd>
</dl>
<h2>Cómo se juega acá</h2>
<ul>
<li>No hay límite diario. Al terminar un críptico podés pedir otro, y evitamos repetirte los que ya viste.</li>
<li>Las pistas progresivas muestran, en orden: el mecanismo, la definición, la primera letra y un patrón de letras.</li>
<li>Las tildes y las mayúsculas no importan, pero la Ñ sí: AÑO y ANO son palabras distintas.</li>
<li>El desafío diario es opcional y es el mismo para todas las personas que juegan en ese idioma.</li>
<li>Si encontrás un error, usá «Informar un error» en la partida.</li>
</ul>
<h2>Idioma y país</h2>
<p>Son preferencias independientes. El país sirve para estadísticas generales y para sugerir una variante; nunca cambia el idioma por sí solo. Si elegís una variante con pocos crípticos propios (por ejemplo, español de México), te mostramos también los de uso general y te lo avisamos.</p>
<h2>De dónde salen los crípticos</h2>
<p>De tres lugares: un catálogo original escrito para este sitio, fuentes externas que dieron permiso o tienen licencia de reutilización (siempre con atribución), y propuestas de la comunidad aprobadas una por una por una persona. Ningún críptico se publica sin pasar validaciones automáticas que comprueban que el juego de palabras produce la respuesta.</p>`,
    privacy: `
<p><em>Última actualización: ${new Date().getUTCFullYear()}. Este texto es una base: el responsable del sitio debe completarlo con sus datos y revisarlo según la normativa de cada país donde lo publique.</em></p>
<h2>Qué datos usamos</h2>
<ul>
<li><strong>Jugar sin cuenta:</strong> guardamos un identificador aleatorio en una cookie técnica (<code>pid</code>) para no repetirte crípticos y calcular tus estadísticas. No contiene datos personales.</li>
<li><strong>Preferencias:</strong> país, idioma y tema se guardan en tu navegador solo si marcás «Recordar en este dispositivo».</li>
<li><strong>Cuenta opcional:</strong> nombre de usuario y contraseña (guardada con hash scrypt; nunca en texto plano). El correo es opcional.</li>
<li><strong>Propuestas:</strong> el contenido que envíes y, si lo indicás, el nombre público con el que querés aparecer.</li>
<li><strong>Partidas:</strong> de cada partida registramos el críptico, cuándo empezó y terminó, los intentos, las pistas, si se reveló la respuesta y un tiempo activo estimado (mientras la pestaña está visible y hay interacción). No guardamos lo que escribís como respuesta.</li>
<li><strong>Perfil:</strong> tus respuestas escritas (en mayúsculas, sin espacios), el momento de cada pista y los logros obtenidos, para mostrarte tu historial y tu evolución. Solo los ves vos. El perfil público y los rankings están apagados por defecto: si los activás, se muestra únicamente lo que elijas (nunca tu correo, historial, respuestas, tiempos ni pistas). Los enlaces para compartir un resultado no incluyen tu nombre.</li>
<li><strong>Visitas:</strong> contamos visitas de forma agregada por día, idioma y país elegido, sin cookies ni identificadores. Si tu navegador envía «Do Not Track» o «Global Privacy Control», no se cuentan.</li>
<li><strong>Seguridad:</strong> para limitar abusos usamos un hash de la dirección IP con una sal secreta; no guardamos la IP. El hash asociado a una sesión se borra a los 30 días.</li>
<li><strong>Ubicación:</strong> no la inferimos. Solo usamos el país que elegís.</li>
</ul>
<h2>Para qué</h2>
<p>Para que el juego funcione, evitar repeticiones, mostrar estadísticas, moderar propuestas y proteger el sitio. No vendemos datos ni usamos publicidad personalizada. No hay rastreadores de terceros.</p>
<h2>Cuánto tiempo</h2>
<p>Las partidas se conservan hasta 400 días; el detalle de eventos de cada partida, 180 días; los registros de seguridad, hasta 2 años; las sesiones vencen solas. Podés borrar tu cuenta desde tu perfil en cualquier momento: se eliminan tus datos personales y tus partidas quedan solo en estadísticas anónimas.</p>
<h2>Tus derechos</h2>
<p>Desde tu perfil podés descargar una copia de tus datos, pedir una corrección o eliminar tu cuenta. También podés escribir al contacto del responsable del sitio.</p>`,
    terms: `
<p><em>Base adaptable: revisala antes de publicar en cada mercado.</em></p>
<h2>Uso del sitio</h2>
<p>Jugar es gratuito y no requiere registro. No está permitido automatizar el acceso para copiar el catálogo, intentar vulnerar la seguridad ni usar el sitio para enviar spam.</p>
<h2>Contenido</h2>
<p>Los crípticos originales del sitio son propiedad de su responsable. Los de fuentes externas se muestran con la atribución y la licencia que indique cada fuente.</p>
<h2>Condiciones de contribución</h2>
<ul>
<li>Al enviar un críptico, declarás que es tuyo o que tenés derecho a enviarlo, y que no copia material protegido de terceros.</li>
<li>Nos das permiso, no exclusivo y gratuito, para publicarlo, editarlo para corregir errores y mostrarlo en el sitio, con tu nombre público si lo indicaste.</li>
<li>Toda propuesta la revisa una persona. Podemos aprobarla, pedir correcciones o rechazarla. Ninguna cantidad de aportes da derecho a publicación automática.</li>
</ul>
<h2>Responsabilidad</h2>
<p>Hacemos lo posible para que cada críptico sea correcto, pero pueden existir errores. Si encontrás uno, avisanos desde la partida.</p>`,
  },
  en: {
    help: `
<h2>What is a cryptic clue?</h2>
<p>A cryptic clue has two parts: a plain <strong>definition</strong> and some <strong>wordplay</strong> that leads to the same answer. The definition is almost always at the start or the end. The number in brackets is the length of the answer; several words appear as (3,4).</p>
<h2>Common devices</h2>
<dl class="mech-list">
<dt>Anagram</dt><dd>Words like <em>wildly, reformed, scrambled</em> tell you to rearrange letters. <em>Cheater reformed as an educator (7)</em> → TEACHER.</dd>
<dt>Hidden word</dt><dd><em>partly, seen in, hides</em>: the answer is spelt out inside the clue. <em>World seen in clear theory (5)</em> → clEAR THeory → EARTH.</dd>
<dt>Reversal</dt><dd><em>sent back, returned</em>: read it backwards. <em>Prize from drawer turned over (6)</em> → REWARD.</dd>
<dt>Container</dt><dd><em>holding, around, in</em>: one piece goes inside another. <em>Beer holding a coat (5)</em> → P(A)INT.</dd>
<dt>Deletion</dt><dd><em>beheaded, cut short, loses</em>: letters are removed.</dd>
<dt>Charade</dt><dd>Pieces joined together: <em>Floor covering: vehicle and animal companion (6)</em> → CAR + PET.</dd>
<dt>Homophone</dt><dd><em>we hear, on the radio, so to speak</em>: the answer sounds like another word. Some depend on accent: FATHER and FARTHER only sound alike in non-rhotic British speech.</dd>
<dt>Double definition</dt><dd>Two definitions of the same word side by side.</dd>
<dt>Abbreviations</dt><dd>Conventions such as N = north, R = river, B = born, I = one.</dd>
</dl>
<h2>How play works here</h2>
<ul>
<li>There is no daily limit. Ask for another clue whenever you like; we avoid repeating ones you've seen.</li>
<li>Progressive hints reveal, in order: the device, the definition, the first letter and a letter pattern.</li>
<li>Case, spaces and accents don't matter.</li>
<li>The daily challenge is optional and the same for everyone playing in that language.</li>
<li>Found a mistake? Use "Report a problem" during the game.</li>
</ul>
<h2>Language and country</h2>
<p>They are independent. Your country is used for overall statistics and to suggest a variety; it never changes your language on its own.</p>
<h2>Where the clues come from</h2>
<p>An original catalogue written for this site, external sources that granted permission or use a reuse licence (always credited), and community submissions approved one by one by a person. Nothing is published without automatic checks that the wordplay really produces the answer.</p>`,
    privacy: `
<p><em>Last updated: ${new Date().getUTCFullYear()}. This is a template: the site operator must complete it and review it for each country where the site is published.</em></p>
<h2>What we use</h2>
<ul>
<li><strong>Playing without an account:</strong> a random identifier in a technical cookie (<code>pid</code>) so we don't repeat clues and can show your statistics. It contains no personal data.</li>
<li><strong>Preferences:</strong> country, language and theme are stored in your browser only if you tick "Remember on this device".</li>
<li><strong>Optional account:</strong> username and password (stored as a scrypt hash, never in plain text). Email is optional.</li>
<li><strong>Submissions:</strong> what you send and, if you choose, a public name.</li>
<li><strong>Games:</strong> for each game we record the clue, when it started and ended, attempts, hints, whether the answer was revealed and an estimated active time (while the tab is visible and you interact). We don't store what you type as an answer.</li>
<li><strong>Profile:</strong> the answers you typed (uppercase, no spaces), when each hint was requested and the achievements you earned, to show your history and progress. Only you can see them. The public profile and leaderboards are off by default: if you turn them on, only what you choose is shown (never your email, history, answers, times or hints). Links to share a result do not include your name.</li>
<li><strong>Visits:</strong> counted in aggregate per day, language and chosen country, with no cookies or identifiers. If your browser sends Do Not Track or Global Privacy Control, they aren't counted.</li>
<li><strong>Security:</strong> to limit abuse we use a salted hash of your IP address; we don't store the address itself. The hash attached to a session is erased after 30 days.</li>
<li><strong>Location:</strong> we don't infer it. We only use the country you choose.</li>
</ul>
<h2>Why</h2>
<p>To run the game, avoid repeats, show statistics, moderate submissions and protect the site. We don't sell data, show targeted ads or use third-party trackers.</p>
<h2>How long</h2>
<p>Games are kept for up to 400 days, per-game event details for 180 days, security logs for up to 2 years, and sessions expire automatically. You can delete your account from your profile at any time: your personal data is erased and your games remain only in anonymous statistics.</p>
<h2>Your rights</h2>
<p>From your profile you can download a copy of your data, request a correction or delete your account. You can also contact the site operator.</p>`,
    terms: `
<p><em>Adaptable template: review before launching in each market.</em></p>
<h2>Using the site</h2>
<p>Playing is free and needs no account. Do not automate access to copy the catalogue, attempt to break security, or use the site to send spam.</p>
<h2>Content</h2>
<p>Original clues belong to the site operator. Clues from external sources are shown with the credit and licence each source requires.</p>
<h2>Contribution terms</h2>
<ul>
<li>By submitting a clue you confirm it is yours or that you have the right to submit it, and that it doesn't copy protected material.</li>
<li>You grant us a free, non-exclusive permission to publish it, edit it to fix mistakes and show it on the site, with your public name if given.</li>
<li>A person reviews every submission. We may approve it, ask for changes or reject it. No number of contributions grants automatic publication.</li>
</ul>
<h2>Liability</h2>
<p>We do our best to make every clue correct, but mistakes can happen. Please report them from the game.</p>`,
  },
};

// ── Ejemplos editoriales ──
// Todos salen del catálogo semilla validado (seed/): el juego de palabras
// produce la respuesta y la definición está en un extremo de la pista.
// Cada pista se describe en partes: '' texto, 'def' definición, 'ind' indicador, 'enum' longitud.
const P = (...parts) => parts.map((p) => (Array.isArray(p) ? p : [p, '']));

module.exports.EXAMPLES = {
  es: {
    specimen: { parts: P('Ramo ', ['revuelto', 'ind'], ' para ', ['el sentimiento', 'def'], [' (4)', 'enum']), from: 'RAMO', to: 'AMOR' },
    home_try: { parts: P(['Queso solo', ''], ' ', ['esconde', 'ind'], ' ', ['un animal del bosque', 'def'], [' (3)', 'enum']), answer: 'OSO',
      hint: 'Fijate en las letras de «queso solo», sin el espacio.',
      steps: ['«un animal del bosque» es la definición.', '«esconde» avisa que la respuesta está escrita dentro de la pista.', 'quesO SOlo → OSO.'] },
  },
  en: {
    specimen: { parts: P(['Cheater', ''], ' ', ['reformed', 'ind'], ' as ', ['an educator', 'def'], [' (7)', 'enum']), from: 'CHEATER', to: 'TEACHER' },
    home_try: { parts: P(['Partly', 'ind'], ' honest ', ['home for birds', 'def'], [' (4)', 'enum']), answer: 'NEST',
      hint: 'Look at the letters of "honest".',
      steps: ['"home for birds" is the definition.', '"Partly" says the answer is hidden inside the clue.', 'hoNEST → NEST.'] },
  },
};

module.exports.LESSONS = {
  es: [
    { kicker: 'Primeros pasos', title: 'Qué es un críptico',
      text: 'Una pista con dos caras. Una parte es una definición normal; la otra, un juego de palabras que llega a la misma respuesta. Cuando las dos coinciden, no hay dudas.',
      tries: [{ parts: P('Ramo ', ['revuelto', 'ind'], ' para ', ['el sentimiento', 'def'], [' (4)', 'enum']), answer: 'AMOR', hint: 'La definición es «el sentimiento».',
        steps: ['«el sentimiento» es la definición.', '«revuelto» indica un anagrama de RAMO.', 'RAMO reordenado → AMOR.'] }] },
    { kicker: 'La clave', title: 'Cómo encontrar la definición',
      text: 'Está siempre en un extremo: al principio o al final. Probá leer la pista cortándola en dos y preguntate qué mitad suena a diccionario.',
      tries: [{ parts: P('Trapo ', ['roto', 'ind'], ' en ', ['el alumbramiento', 'def'], [' (5)', 'enum']), answer: 'PARTO', hint: '«el alumbramiento» es un nacimiento.',
        steps: ['La definición está al final: «el alumbramiento».', '«roto» indica que las letras de TRAPO se reordenan.', 'TRAPO → PARTO.'] }] },
    { kicker: 'Mecanismo', title: 'Anagramas', signals: ['loco', 'revuelto', 'alterado', 'roto', 'movido'],
      text: 'Una palabra que sugiere desorden avisa que hay que reordenar letras que ya están en la pista. Las letras tienen que ser exactamente las mismas.',
      tries: [{ parts: P('Jamón ', ['loco', 'ind'], ' para ', ['una religiosa', 'def'], [' (5)', 'enum']), answer: 'MONJA', hint: 'Reordená J-A-M-O-N.',
        steps: ['«una religiosa» es la definición.', '«loco» indica un anagrama de JAMÓN.', 'JAMON → MONJA.'] }] },
    { kicker: 'Mecanismo', title: 'Palabras ocultas', signals: ['esconde', 'oculta', 'contiene', 'en parte'],
      text: 'La respuesta está escrita, letra por letra, dentro de la pista. Suele atravesar el espacio entre dos palabras.',
      tries: [{ parts: P('Alemán gordo ', ['oculta', 'ind'], ' ', ['una fruta tropical', 'def'], [' (5)', 'enum']), answer: 'MANGO', hint: 'Mirá el final de «Alemán» y el principio de «gordo».',
        steps: ['«una fruta tropical» es la definición.', '«oculta» indica una palabra escondida.', 'aleMÁN GOrdo → MANGO.'] }] },
    { kicker: 'Mecanismo', title: 'Inversiones', signals: ['de vuelta', 'al revés', 'que vuelve', 'regresa'],
      text: 'Una palabra se lee de atrás para adelante. El indicador sugiere un regreso o un giro.',
      tries: [{ parts: P('Oído que ', ['vuelve', 'ind'], ' con ', ['rencor', 'def'], [' (4)', 'enum']), answer: 'ODIO', hint: 'Leé OÍDO al revés.',
        steps: ['«rencor» es la definición.', '«vuelve» indica una inversión.', 'OIDO al revés → ODIO.'] }] },
    { kicker: 'Mecanismos', title: 'Inserciones y eliminaciones', signals: ['guarda', 'abraza', 'sin principio', 'pierde'],
      text: 'En una inserción, un fragmento va dentro de otro. En una eliminación, a una palabra le sacás letras: la primera, la última o alguna en especial.',
      tries: [
        { parts: P('Peso que ', ['guarda', 'ind'], ' al rey: ', ['un recluso', 'def'], [' (5)', 'enum']), answer: 'PRESO', hint: 'En los crípticos, «rey» suele ser R.',
          steps: ['«un recluso» es la definición.', '«guarda» indica que algo va dentro de PESO.', 'rey = R; P(R)ESO → PRESO.'] },
        { parts: P('Saludo ', ['sin principio', 'ind'], ' forma ', ['una onda en el mar', 'def'], [' (3)', 'enum']), answer: 'OLA', hint: '¿Qué saludo de cuatro letras conocés?',
          steps: ['«una onda en el mar» es la definición.', '«sin principio» indica sacar la primera letra.', 'HOLA sin la H → OLA.'] }] },
    { kicker: 'Avanzado', title: 'Piezas que se suman', signals: ['y', 'con', 'junto a'],
      text: 'En una charada la respuesta se arma uniendo piezas, cada una con su propia mini definición. Los crípticos más difíciles combinan varios mecanismos a la vez.',
      tries: [{ parts: P('Astro rey ', ['y', 'ind'], ' cubo de juego para ', ['un militar', 'def'], [' (7)', 'enum']), answer: 'SOLDADO', hint: 'El astro rey tiene tres letras.',
        steps: ['«un militar» es la definición.', 'astro rey = SOL; cubo de juego = DADO.', 'SOL + DADO → SOLDADO.'] }] },
  ],
  en: [
    { kicker: 'First steps', title: 'What a cryptic clue is',
      text: 'A clue with two faces. One part is a plain definition; the other is wordplay that reaches the same answer. When both agree, there is no doubt.',
      tries: [{ parts: P(['Cheater', ''], ' ', ['reformed', 'ind'], ' as ', ['an educator', 'def'], [' (7)', 'enum']), answer: 'TEACHER', hint: 'The definition is "an educator".',
        steps: ['"an educator" is the definition.', '"reformed" signals an anagram of CHEATER.', 'CHEATER rearranged → TEACHER.'] }] },
    { kicker: 'The key', title: 'How to find the definition',
      text: 'It is always at one end: the start or the finish. Try splitting the clue in two and ask which half sounds like a dictionary.',
      tries: [{ parts: P('Garden ', ['wrecked', 'ind'], ": that's ", ['a risk', 'def'], [' (6)', 'enum']), answer: 'DANGER', hint: 'The definition is at the end.',
        steps: ['"a risk" is the definition, at the end.', '"wrecked" signals an anagram of GARDEN.', 'GARDEN → DANGER.'] }] },
    { kicker: 'Device', title: 'Anagrams', signals: ['scrambled', 'reformed', 'wrecked', 'arrangement'],
      text: 'A word suggesting disorder tells you to rearrange letters already in the clue. The letters must match exactly.',
      tries: [{ parts: P('Runes ', ['scrambled', 'ind'], ' for ', ['a carer', 'def'], [' (5)', 'enum']), answer: 'NURSE', hint: 'Rearrange R-U-N-E-S.',
        steps: ['"a carer" is the definition.', '"scrambled" signals an anagram of RUNES.', 'RUNES → NURSE.'] }] },
    { kicker: 'Device', title: 'Hidden words', signals: ['hides', 'partly', 'in', 'some'],
      text: 'The answer is written, letter by letter, inside the clue — often across the gap between two words.',
      tries: [{ parts: P('Sailor Ryan ', ['hides', 'ind'], ' ', ['a British truck', 'def'], [' (5)', 'enum']), answer: 'LORRY', hint: 'Look across "Sailor Ryan".',
        steps: ['"a British truck" is the definition.', '"hides" signals a hidden word.', 'saiLOR RYan → LORRY.'] }] },
    { kicker: 'Device', title: 'Reversals', signals: ['turned back', 'returned', 'sent back', 'over'],
      text: 'A word is read backwards. The indicator suggests a return or a turn.',
      tries: [{ parts: P('Evil ', ['turned back', 'ind'], ' to ', ['exist', 'def'], [' (4)', 'enum']), answer: 'LIVE', hint: 'Read EVIL backwards.',
        steps: ['"exist" is the definition.', '"turned back" signals a reversal.', 'EVIL reversed → LIVE.'] }] },
    { kicker: 'Devices', title: 'Containers and deletions', signals: ['holding', 'around', 'loses', 'without'],
      text: 'In a container, one piece goes inside another. In a deletion, you remove letters from a word: the first, the last, or a specific one.',
      tries: [
        { parts: P('Beer ', ['holding', 'ind'], ' a ', ['coat', 'def'], [' (5)', 'enum']), answer: 'PAINT', hint: 'A glass of beer is a…',
          steps: ['"coat" is the definition.', '"holding" signals that A goes inside a word for beer.', 'PINT holding A → P(A)INT → PAINT.'] },
        { parts: P('Grain ', ['loses', 'ind'], ' west for ', ['warmth', 'def'], [' (4)', 'enum']), answer: 'HEAT', hint: 'West = W.',
          steps: ['"warmth" is the definition.', '"loses west" means remove W.', 'WHEAT without W → HEAT.'] }] },
    { kicker: 'Advanced', title: 'Pieces that add up', signals: ['and', 'with', 'by'],
      text: 'In a charade the answer is built from pieces, each with its own mini definition. The hardest clues combine several devices at once.',
      tries: [{ parts: P(['Floor covering', 'def'], ': vehicle ', ['and', 'ind'], ' animal companion', [' (6)', 'enum']), answer: 'CARPET', hint: 'Vehicle = CAR.',
        steps: ['"Floor covering" is the definition, at the start.', 'vehicle = CAR; animal companion = PET.', 'CAR + PET → CARPET.'] }] },
  ],
};
