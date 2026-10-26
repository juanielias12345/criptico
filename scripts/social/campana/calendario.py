# Arma data/social/campana-21.json: la base diaria del plan de 60 días (días 7 a 27,
# 30/10–19/11) más las piezas propias de la campaña. Cada entrada trae el «info» listo
# para el programador de Metricool (blogId 7586957, America/Buenos_Aires).
import json, sys
MAIN = 'https://raw.githubusercontent.com/juanielias12345/criptico/16c97b6536b5dabf856779f458ca6a0399679e94/public'
CAMP = 'https://raw.githubusercontent.com/juanielias12345/criptico/' + sys.argv[1] + '/public/social/campana/'
TZ = 'America/Buenos_Aires'
plan = json.load(open('data/social/plan.json'))
posts = []

def add(key, date, time, network, kind, text, media, alt, extra=None, draft=False, goal='', series=''):
    info = {'autoPublish': True, 'draft': draft, 'descendants': [], 'firstCommentText': '', 'hasNotReadNotes': False,
            'media': media, 'mediaAltText': [alt] * len(media), 'providers': [{'network': network}],
            'publicationDate': {'dateTime': f'{date}T{time}:00', 'timezone': TZ}, 'shortener': False,
            'smartLinkData': {'ids': []}, 'text': text}
    if network == 'instagram': info['instagramData'] = {'type': kind, 'showReelOnFeed': True, 'isAiGenerated': False}
    if network == 'facebook': info['facebookData'] = {'type': kind, **({'title': extra} if extra and kind == 'REEL' else {})}
    if network == 'tiktok': info['tiktokData'] = {'privacyOption': 'PUBLIC_TO_EVERYONE', 'title': extra or text[:80], 'disableComment': False,
            'disableDuet': False, 'disableStitch': False, 'autoAddMusic': kind == 'PHOTO', 'commercialContentOwnBrand': True,
            'commercialContentThirdParty': False, 'isAigc': False, **({'photoCoverIndex': 0} if kind == 'PHOTO' else {})}
    if network == 'youtube': info['youtubeData'] = {'title': extra, 'type': 'short', 'privacy': 'public', 'madeForKids': False,
            'category': 'EDUCATION', 'isAiGeneratedContent': False, 'tags': ['críptico', 'juegos de palabras', 'acertijos', 'crucigrama']}
    if kind == 'STORY': info['text'] = ''
    posts.append({'key': key, 'date': date, 'time': time, 'network': network, 'kind': kind, 'draft': draft,
                  'goal': goal, 'series': series, 'info': info})

# ── Base diaria (plan de 60 días) ──
KIND = {'instagram_clue': ('instagram', 'POST'), 'facebook_clue': ('facebook', 'POST'), 'instagram_carousel': ('instagram', 'POST'),
        'facebook_carousel': ('facebook', 'POST'), 'instagram_weekend': ('instagram', 'POST'), 'facebook_weekend': ('facebook', 'POST'),
        'tiktok_video': ('tiktok', 'VIDEO'), 'youtube_video': ('youtube', 'SHORT'), 'instagram_reel': ('instagram', 'REEL'),
        'instagram_story': ('instagram', 'STORY'), 'facebook_reel': ('facebook', 'REEL')}
# El carrusel «Desafío rioplatense» del 30/10 se reemplaza por el «Así se resuelve» del día 59:
# las piezas no nombran países ni regiones (pedido de juan, 26/10).
SWAP = {p['slot']: p for p in plan['days'][59]['pieces'] if 'carousel' in p['slot']}
for d in plan['days'][7:28]:
    for p in d['pieces']:
        if 'rioplatense' in p['title']: p = {**SWAP[p['slot']], 'id': p['id'], 'date': p['date'], 'time': p['time']}
        net, kind = KIND[p['slot']]
        title = None
        if net == 'tiktok': title = p['body'].split('«')[0].strip() + ' «' + d['clue']['clue'] + '»'
        if net == 'youtube': title = (p['body'].split('\n')[0].strip() + ' · críptico del día')[:95]
        if net == 'facebook' and kind == 'REEL': title = 'Críptico del día: la solución'
        goal = 'Desafío diario' if 'clue' in p['slot'] or 'weekend' in p['slot'] else 'Educación' if 'carousel' in p['slot'] else 'Solución y recurrencia'
        add(p['id'], p['date'], p['time'], net, kind, p['body'], [MAIN + a for a in p['assets']], p['alt_text'] or '', title, goal=goal, series='Base diaria')

# ── Piezas propias de la campaña ──
HORA = '00:00 UTC: 18 h en México, 19 h en Colombia y Perú, 21 h en Chile, 1 h en España'
TAGS = '#críptico #juegosdepalabras #acertijos #playcripticos'
def video(key, date, time, file, alt, ig, fb, tt, yt, ytitle, ttitle, draft=False, goal='', series=''):
    m = [CAMP + file]
    add(key + '-ig', date, time, 'instagram', 'REEL', ig, m, alt, draft=draft, goal=goal, series=series)
    add(key + '-tt', date, time, 'tiktok', 'VIDEO', tt, m, alt, ttitle, draft=draft, goal=goal, series=series)
    add(key + '-yt', date, time, 'youtube', 'SHORT', yt, m, alt, ytitle, draft=draft, goal=goal, series=series)
    add(key + '-fb', date, f'{time[:3]}15', 'facebook', 'REEL', fb, m, alt, ytitle, draft=draft, goal=goal, series=series)
def carousel(key, date, time, folder, n, alt, ig, fb, tt, ttitle, draft=False, goal='', series='', tiktok=True):
    m = [CAMP + f'{folder}/slide-{i:02d}.png' for i in range(1, n + 1)]
    add(key + '-ig', date, time, 'instagram', 'POST', ig, m, alt, draft=draft, goal=goal, series=series)
    add(key + '-fb', date, f'{time[:3]}30', 'facebook', 'POST', fb, m, alt, draft=draft, goal=goal, series=series)
    if tiktok: add(key + '-tt', date, f'{time[:3]}45', 'tiktok', 'PHOTO', tt, m, alt, ttitle, draft=draft, goal=goal, series=series)

V = 'Funcionalidades'
# v1 TikTok ya programado el 26/10 (id 406932627); se agregan las otras tres redes.
add('c21-v1-ig', '2026-10-30', '18:00', 'instagram', 'REEL', f'¿Nunca jugaste un críptico? Así se juega 🧩\n\nUna parte de la frase define la palabra; la otra la arma con un juego de letras. Si te trabás, la pista te dice el truco, y al final te explica por qué.\n\nGratis y sin registrarte: playcripticos.com (link en el perfil)\n\n{TAGS}',
    [CAMP + 'v1-asi-se-juega.mp4'], 'Grabación real de Play Crípticos en un teléfono: un intento errado, la pista que avisa que es un anagrama y la solución META explicada.', goal='Captación', series=V)
add('c21-v1-yt', '2026-10-30', '18:00', 'youtube', 'SHORT', 'Así se juega un críptico en Play Crípticos: una parte de la frase define la palabra y la otra la arma con un juego de letras. Gratis y sin registrarte en https://playcripticos.com\n\n' + TAGS,
    [CAMP + 'v1-asi-se-juega.mp4'], 'Grabación real de Play Crípticos en un teléfono.', '¿Nunca jugaste un críptico? Así se juega', goal='Captación', series=V)
add('c21-v1-fb', '2026-10-30', '18:15', 'facebook', 'REEL', '¿Nunca jugaste un críptico? Así se juega 🧩 Una parte de la frase define la palabra; la otra la arma con un juego de letras. Gratis y sin registrarte: https://playcripticos.com/es/jugar',
    [CAMP + 'v1-asi-se-juega.mp4'], 'Grabación real de Play Crípticos en un teléfono.', '¿Nunca jugaste un críptico? Así se juega', goal='Captación', series=V)

video('c21-v2', '2026-10-31', '18:00', 'v2-diario.mp4', 'Grabación real del Diario de Play Crípticos: se resuelve el críptico del día y se ve cuántos lo resolvieron.',
    f'Un críptico por día, el mismo para todos 📅\n\nEl Diario se renueva todos los días a las 00:00 UTC y te muestra cuántos lo resolvieron. ¿Te sumás a jugarlo todos los días?\n\nplaycripticos.com (link en el perfil)\n\n{TAGS}',
    'Un críptico por día, el mismo para todos 📅 El Diario se renueva todos los días a las 00:00 UTC y te muestra cuántos lo resolvieron. Jugalo acá: https://playcripticos.com/es/diario',
    f'El Diario: un críptico por día, el mismo para todos. Se renueva todos los días a las 00:00 UTC. playcripticos.com {TAGS}',
    'El Diario: un críptico por día en https://playcripticos.com/es/diario\n\n' + TAGS, 'Un críptico por día, el mismo para todos', 'El Diario de Play Crípticos', goal='Recurrencia', series=V)

for key, date, img, fechas in [('c21-t1', '2026-11-01', 'torneo-02-11.png', '2 al 8 de noviembre'), ('c21-t2', '2026-11-08', 'torneo-09-11.png', '9 al 15 de noviembre'), ('c21-t3', '2026-11-15', 'torneo-16-11.png', '16 al 22 de noviembre')]:
    alt = f'Esta noche, 00:00 UTC: arranca el torneo de la semana, {fechas}. 7 crípticos, uno por día, gratis.'
    m = [CAMP + img]
    add(key + '-ig', date, '17:00', 'instagram', 'POST', f'Esta noche arranca el torneo de la semana 🏆\n\n{HORA}\n\n{fechas}: 7 crípticos, uno por día, con ranking. Gratis: solo necesitás una cuenta.\n\nAnotate en Desafíos: playcripticos.com (link en el perfil)\n\n{TAGS}', m, alt, goal='Activación', series='Torneo semanal')
    add(key + '-fb', date, '17:15', 'facebook', 'POST', f'Esta noche arranca el torneo de la semana 🏆 ({HORA}) {fechas}: 7 crípticos, uno por día, con ranking. Gratis. Anotate: https://playcripticos.com/es/desafios', m, alt, goal='Activación', series='Torneo semanal')
    add(key + '-tt', date, '17:30', 'tiktok', 'PHOTO', f'Esta noche (00:00 UTC) arranca el torneo semanal de crípticos: 7 rondas, una por día, gratis. Anotate en playcripticos.com {TAGS}', m, alt, 'Arranca el torneo de la semana', goal='Activación', series='Torneo semanal')

video('c21-v3', '2026-11-01', '19:00', 'v3-torneo.mp4', 'Grabación real: inscripción al torneo semanal y una ronda resuelta con 200 puntos.',
    f'Hay un torneo de crípticos cada semana 🏆\n\nTe anotás gratis, se abre una ronda por día y sumás hasta 200 puntos por críptico: más rápido y sin pistas, más puntos. Esta noche (00:00 UTC) arranca el nuevo.\n\nDesafíos en playcripticos.com (link en el perfil)\n\n{TAGS}',
    'Hay un torneo de crípticos cada semana 🏆 Te anotás gratis, una ronda por día, hasta 200 puntos por críptico. Esta noche (00:00 UTC) arranca: https://playcripticos.com/es/desafios',
    f'Torneo semanal de crípticos: te anotás gratis y sumás hasta 200 puntos por ronda. ¿Cuánto sacás? {TAGS}',
    'Torneo semanal gratis en https://playcripticos.com/es/desafios\n\n' + TAGS, 'Torneo semanal de crípticos: hasta 200 puntos', 'Torneo semanal de crípticos', goal='Activación', series=V)
carousel('c21-k2', '2026-11-03', '13:00', 'k2-torneo', 5, 'Carrusel: reglas y puntaje del torneo semanal de Play Crípticos.',
    f'El torneo semanal, explicado 🏆\n\nCómo entrar, cuándo abre cada ronda y cómo se suman los puntos. Guardalo para la próxima ronda (abre a las 00:00 UTC).\n\nplaycripticos.com (link en el perfil)\n\n{TAGS}',
    'El torneo semanal de Play Crípticos, explicado: cómo entrar, cuándo abre cada ronda y cómo se suman los puntos. Anotate gratis: https://playcripticos.com/es/desafios',
    f'Reglas del torneo semanal de crípticos: hasta 200 puntos por ronda. {TAGS}', 'El torneo semanal, explicado', goal='Activación', series='Carruseles de producto')
video('c21-v4', '2026-11-04', '18:00', 'v4-duelo.mp4', 'Grabación real: se crea un duelo con enlace, se ven los botones para mandarlo por WhatsApp y se resuelve la primera ronda.',
    f'¿A quién retarías a un duelo de crípticos? ⚔️\n\nCreás un enlace, lo mandás por WhatsApp y los dos juegan los mismos crípticos. Gana quien suma más puntos.\n\nGratis en playcripticos.com (link en el perfil)\n\n{TAGS}',
    '¿A quién retarías a un duelo de crípticos? ⚔️ Creás un enlace, lo mandás por WhatsApp y gana quien suma más. Gratis: https://playcripticos.com/es/desafios',
    f'Duelos de crípticos 1 contra 1: mandale el enlace a quien quieras. ¿A quién retás? {TAGS}',
    'Duelos 1 contra 1 en https://playcripticos.com/es/desafios\n\n' + TAGS, 'Duelos de crípticos 1 contra 1', 'Duelos de crípticos 1 contra 1', goal='Viralidad', series=V)
carousel('c21-k3', '2026-11-05', '13:00', 'k3-duelos', 5, 'Carrusel: cómo funcionan los duelos 1 contra 1 en Play Crípticos.',
    f'Duelos 1 contra 1, en 3 pasos ⚔️\n\nEtiquetá a quien retarías primero 👇\n\nplaycripticos.com (link en el perfil)\n\n{TAGS}',
    'Duelos 1 contra 1 en Play Crípticos, en 3 pasos. Etiquetá a quien retarías primero 👇 https://playcripticos.com/es/desafios',
    f'Cómo retar a alguien a un duelo de crípticos. {TAGS}', 'Duelos 1 contra 1 en 3 pasos', goal='Viralidad', series='Carruseles de producto')
video('c21-v5', '2026-11-06', '18:00', 'v5-mecanismos.mp4', 'Grabación real de la guía de mecanismos de Play Crípticos.',
    f'Todos los crípticos usan 9 trucos 🔤\n\nAnagrama, palabra oculta, inversión, charada… Hay una guía gratis para cada uno, con ejemplos para practicar.\n\nplaycripticos.com (link en el perfil)\n\n{TAGS}',
    'Todos los crípticos usan 9 trucos 🔤 Aprendelos con la guía gratis: https://playcripticos.com/es/mecanismos',
    f'Los 9 trucos de los crípticos, con una guía gratis para cada uno. {TAGS}',
    'Guía de los 9 mecanismos: https://playcripticos.com/es/mecanismos\n\n' + TAGS, 'Los 9 trucos de todos los crípticos', 'Los 9 trucos de los crípticos', goal='Educación', series=V)
carousel('c21-k4', '2026-11-10', '13:00', 'k4-niveles-logros', 5, 'Carrusel: los 12 niveles y algunos logros del perfil de Play Crípticos.',
    f'De Curioso a Leyenda del crucigrama 🏅\n\nLos 12 niveles, cómo se sube y algunos logros para ir a buscar. ¿En qué nivel estás? Contalo abajo.\n\nplaycripticos.com (link en el perfil)\n\n{TAGS}',
    'De Curioso a Leyenda del crucigrama 🏅 Los 12 niveles y los logros de Play Crípticos. ¿En qué nivel estás? https://playcripticos.com/es/perfil',
    f'Los 12 niveles de Play Crípticos: ¿en cuál estás? {TAGS}', 'De Curioso a Leyenda', goal='Retención', series='Carruseles de producto')
carousel('c21-k1', '2026-11-12', '13:00', 'k1-todo-gratis', 7, 'Carrusel: todo lo que se puede hacer gratis en Play Crípticos.',
    f'Todo lo que podés hacer gratis en Play Crípticos 📌\n\nJugar sin límite, el Diario, torneo, duelos, tu perfil con niveles y logros, y lecciones para aprender. Guardalo.\n\nplaycripticos.com (link en el perfil)\n\n{TAGS}',
    'Todo lo que podés hacer gratis en Play Crípticos: jugar sin límite, el Diario, torneo, duelos, perfil y lecciones. https://playcripticos.com',
    f'Todo lo que podés hacer gratis en Play Crípticos. {TAGS}', 'Todo lo que podés hacer gratis', goal='Captación', series='Carruseles de producto')
# Plus: borradores hasta que el pago esté activo (hoy la página dice «Muy pronto»).
carousel('c21-k5', '2026-11-17', '13:00', 'k5-gratis-vs-plus', 5, 'Carrusel: diferencias entre jugar gratis y Play Crípticos Plus.',
    f'Gratis y Plus: qué cambia ✨\n\nJugar sigue siendo gratis. Plus saca los anuncios y suma 10 crípticos difíciles por día, la comparación con la comunidad y la insignia. Sin ventajas en torneos ni duelos.\n\nplaycripticos.com/es/plus (link en el perfil)\n\n{TAGS}',
    'Gratis y Plus: qué cambia. Jugar sigue siendo gratis; Plus saca los anuncios y suma 10 crípticos difíciles por día. Sin ventajas en torneos ni duelos. https://playcripticos.com/es/plus',
    '', '', draft=True, goal='Educación sobre la suscripción', series='Plus', tiktok=False)
video('c21-v6', '2026-11-18', '18:00', 'v6-plus.mp4', 'Grabación real de la página de Play Crípticos Plus.',
    f'Jugar sigue siendo gratis. Y si querés más, está Plus ✨\n\nSin anuncios, 10 crípticos difíciles por día y tu nivel contra la comunidad. USD 1,50 por mes o USD 12 por año. Sin ventajas en torneos ni duelos.\n\nplaycripticos.com/es/plus\n\n{TAGS}',
    'Jugar sigue siendo gratis. Plus: sin anuncios, 10 crípticos difíciles por día y tu nivel contra la comunidad. USD 1,50/mes o USD 12/año. https://playcripticos.com/es/plus',
    f'Play Crípticos Plus: sin anuncios y 10 crípticos difíciles por día. Jugar sigue siendo gratis. {TAGS}',
    'Plus en https://playcripticos.com/es/plus\n\n' + TAGS, 'Play Crípticos Plus: qué incluye', 'Qué incluye Play Crípticos Plus', draft=True, goal='Conversión', series='Plus')
carousel('c21-k6', '2026-11-19', '13:00', 'k6-en-el-telefono', 5, 'Carrusel: cómo agregar Play Crípticos a la pantalla de inicio del teléfono en iPhone y Android.',
    f'Play Crípticos en tu teléfono, hoy 📱\n\nMientras llega la app, agregalo a la pantalla de inicio en tres toques (iPhone y Android). La app todavía no está en las tiendas: cuando salga, lo anunciamos acá.\n\nplaycripticos.com\n\n{TAGS}',
    'Play Crípticos en tu teléfono, hoy 📱 Agregalo a la pantalla de inicio en tres toques. La app todavía no está en las tiendas: cuando salga, lo anunciamos acá. https://playcripticos.com',
    f'Cómo tener Play Crípticos en el teléfono sin descargar nada. {TAGS}', 'Play Crípticos en tu teléfono', goal='Preparación móvil', series='Móvil')

posts.sort(key=lambda p: (p['date'], p['time'], p['key']))
json.dump({'campaign': 'Campaña 21 días 30/10–19/11/2026', 'blogId': 7586957, 'timezone': TZ, 'posts': posts}, open('data/social/campana-21.json', 'w'), ensure_ascii=False, indent=1)
from collections import Counter
print(len(posts), Counter(p['network'] for p in posts), Counter(p['series'] for p in posts), sum(p['draft'] for p in posts))
