# Arma data/social/semanas-20-11.json: lo que se publica del 20/11 al 3/12/2026 en
# Metricool (blogId 7586957, America/Buenos_Aires), ajustado con las métricas
# del 23/10–10/11 (ver docs/REDES-METRICAS.md):
#  - Base diaria del plan de 60 días (días 28–41), sin los duplicados de Facebook
#    (carrusel y finde: la página tiene 5 seguidores) y con los horarios en UTC.
#  - TikTok pasa el video del día de 21 h a 18 h (mejor franja según Metricool).
#  - Serie «Relámpago» (8 s) todos los días: TikTok y Shorts 10 h, reel de prueba
#    de Instagram (lo ven primero quienes no te siguen) y reel de Facebook 18 h.
import json, sys
SHA = sys.argv[1]
RAW = f'https://raw.githubusercontent.com/juanielias12345/criptico/{SHA}/public'
TZ = 'America/Buenos_Aires'
plan = json.load(open('data/social/plan.json'))
serie = {r['date']: r for r in json.load(open('scripts/social/relampago/serie.json'))}
posts = []
TAGS = '#críptico #acertijos #juegosdepalabras #juegosmentales'

def add(key, date, time, net, kind, text, media, alt, title=None):
    info = {'autoPublish': True, 'draft': False, 'descendants': [], 'firstCommentText': '', 'hasNotReadNotes': False,
            'media': media, 'mediaAltText': [alt] * len(media), 'providers': [{'network': net}],
            'publicationDate': {'dateTime': f'{date}T{time}:00', 'timezone': TZ}, 'shortener': False,
            'smartLinkData': {'ids': []}, 'text': '' if kind == 'STORY' else text}
    if net == 'instagram': info['instagramData'] = {'type': kind, 'showReelOnFeed': True, 'isAiGenerated': False}
    if net == 'facebook': info['facebookData'] = {'type': kind, **({'title': title} if kind == 'REEL' else {})}
    if net == 'tiktok': info['tiktokData'] = {'privacyOption': 'PUBLIC_TO_EVERYONE', 'title': title or text[:80], 'disableComment': False,
            'disableDuet': False, 'disableStitch': False, 'autoAddMusic': False, 'commercialContentOwnBrand': False,
            'commercialContentThirdParty': False, 'isAigc': False}
    if net == 'youtube': info['youtubeData'] = {'title': title, 'type': 'short', 'privacy': 'public', 'madeForKids': False,
            'category': 'EDUCATION', 'isAiGeneratedContent': False, 'tags': ['críptico', 'juegos de palabras', 'acertijos', 'crucigrama']}
    posts.append({'key': key, 'date': date, 'time': time, 'network': net, 'kind': kind, 'info': info})

KIND = {'instagram_clue': ('instagram', 'POST'), 'facebook_clue': ('facebook', 'POST'), 'instagram_carousel': ('instagram', 'POST'),
        'instagram_weekend': ('instagram', 'POST'), 'tiktok_video': ('tiktok', 'VIDEO'), 'youtube_video': ('youtube', 'SHORT'),
        'instagram_reel': ('instagram', 'REEL'), 'instagram_story': ('instagram', 'STORY'), 'facebook_reel': ('facebook', 'REEL')}
utc = lambda s: s.replace('a las 21 h', 'a las 00:00 UTC').replace('hoy a las 00:00 UTC', 'a las 00:00 UTC')
for d in plan['days'][28:42]:
    clue = d['clue']['clue']
    for p in d['pieces']:
        if p['slot'] not in KIND: continue
        net, kind = KIND[p['slot']]
        time, text, title = p['time'], utc(p['body']), None
        if net == 'tiktok':
            time = '18:00'
            text = f'¿Lo sacás? Escribí tu respuesta en los comentarios 👇 «{clue}» La solución, al final del video. Hay uno nuevo cada día en playcripticos.com {TAGS}'
            title = f'¿Lo sacás? «{clue}»'
        if net == 'youtube': title = f'¿Lo sacás? «{clue}» · críptico del día'[:95]
        if net == 'facebook' and kind == 'REEL': title = 'Críptico del día: la solución'
        add(p['id'], p['date'], time, net, kind, text, [RAW + a for a in p['assets']], p['alt_text'] or '', title)
    r = serie.get(d['date'])
    if not r: continue
    m = [f"{RAW}/social/relampago/{r['id']}.mp4"]
    alt = f"Video de 8 segundos: el críptico «{r['clue_text']}», cuenta regresiva de 5 segundos, una ayuda y la solución {r['answer']} explicada."
    q = r['clue_text']
    add(r['id'] + '-tt', d['date'], '10:00', 'tiktok', 'VIDEO',
        f'¿Lo sacás en 5 segundos? ⏱️ «{q}» Contá en cuántos segundos te salió 👇 {TAGS}', m, alt, f'¿Lo sacás en 5 segundos? «{q}»')
    add(r['id'] + '-yt', d['date'], '10:00', 'youtube', 'SHORT',
        f'¿Lo sacás en 5 segundos? «{q}» Uno nuevo cada día, gratis, en https://playcripticos.com/es/c/{r["slug"]}\n\n#críptico #acertijos #shorts', m, alt,
        f'¿Lo sacás en 5 segundos? «{q}» #shorts'[:95])
    add(r['id'] + '-ig', d['date'], '18:00', 'instagram', 'TRIAL_REEL',
        f'¿Lo sacás en 5 segundos? ⏱️\n\n«{q}»\n\nContá en cuántos segundos te salió 👇 Uno nuevo cada día en playcripticos.com (enlace en la biografía).\n\n{TAGS} #playcripticos', m, alt)
    add(r['id'] + '-fb', d['date'], '18:15', 'facebook', 'REEL',
        f'¿Lo sacás en 5 segundos? ⏱️ «{q}» Contá en cuántos segundos te salió. Jugalo y seguí con otros: https://playcripticos.com/es/c/{r["slug"]}', m, alt,
        '¿Lo sacás en 5 segundos?')
posts.sort(key=lambda p: (p['date'], p['time'], p['network']))
json.dump({'blogId': 7586957, 'timezone': TZ, 'posts': posts}, open('data/social/semanas-20-11.json', 'w'), ensure_ascii=False, indent=1)
from collections import Counter
print(len(posts), Counter(p['network'] for p in posts))
