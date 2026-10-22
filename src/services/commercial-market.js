'use strict';

// Conocimiento de mercado del agente de estrategia comercial.
// Cada línea de ingreso tiene requisitos medibles con métricas reales del juego, un plan
// de ejecución (tareas con responsable) y las fuentes consultadas con fecha.
// Los umbrales son criterios internos, editables acá; no son reglas del mercado.

const CHECKED = '2026-10-22';
const SOURCES = {
  nyt: { title: 'The New York Times Help Center: New York Times Games Subscription', url: 'https://thenewyorktimeshelpcenter.helpjuice.com/360052272251-New-York-Times-Games-Subscription', checked: CHECKED,
    fact: 'Modelo freemium: Wordle, Connections, Strands y otros gratis; el crucigrama diario, el archivo de más de 10.000 crucigramas y herramientas extra son pagos (facturación cada 28 días o anual).' },
  revenuecat: { title: 'RevenueCat: State of Subscription Apps 2026 (benchmarks)', url: 'https://www.revenuecat.com/blog/growth/subscription-app-trends-benchmarks-2026.md', checked: CHECKED,
    fact: 'Conversión mediana a pago al día 35: 2,1 % en apps freemium y 10,7 % con muro de pago; pruebas de 17 a 32 días convierten 42,5 % contra 25,5 % las de menos de 4 días.' },
  mercadopago: { title: 'Mercado Pago Argentina: Suscripciones', url: 'https://www.mercadopago.com.ar/herramientas-para-vender/suscripciones', checked: CHECKED,
    fact: 'Cobro recurrente con link (semanal a anual), prueba gratis opcional, reintento de cobros. Comisión según plazo de acreditación: entre 1,49 % y 6,99 % + IVA (puede variar por impuestos provinciales).' },
  nine: { title: 'INMA: Nine uses puzzles to drive premium subscription bundles', url: 'https://www.inma.org/blogs/value-content/post.cfm/nine-uses-puzzles-to-drive-premium-subscription-bundles', checked: CHECKED,
    fact: 'En Nine (Australia) los suscriptores que juegan crucigramas y sudoku seguido tienen 73 % a 75 % menos probabilidad de cancelar; los juegos fueron de los mejores conversores a suscripción.' },
};

// métrica: [etiqueta, unidad]
const METRICS = {
  wau: ['Jugadores activos en 7 días', ''], mau: ['Jugadores activos en 30 días', ''], d7: ['Retención al día 7', '%'],
  accounts: ['Cuentas de jugadores', ''], entries_30d: ['Visitas de entrada en 30 días', ''], followers: ['Seguidores en redes (suma)', ''],
  published_clues: ['Crípticos publicados', ''], games_per_wau: ['Partidas por jugador activo por semana', ''],
};

// Plan: [agente, tarea, resultado esperado, categoría, área, nivel de aprobación, ¿la hace un CEO?]
const OPTIONS = [
  {
    id: 'licencias', name: 'Licencias a medios y educación (B2B)',
    summary: 'Vender o licenciar crípticos diarios en español a diarios, revistas, apps y escuelas, con explicación de cada solución.',
    why: 'No depende del tráfico propio: el activo es el banco de crípticos originales validados. Los medios usan los juegos para retener suscriptores.',
    sources: ['nine', 'nyt'],
    requirements: [['published_clues', 3000]],
    revenue: 'Precio por licencia mensual a negociar con cada medio; no se estima un monto sin una primera oferta real.',
    risks: ['Exclusividad y derechos: cada críptico cedido debe ser original y con derechos claros.', 'Ciclo de venta largo.'],
    kpi: 'Contratos firmados y facturación mensual registrada',
    plan: [
      ['contratos', 'Borrador de contrato de licencia de contenidos (no exclusiva, por país y período)', 'Borrador revisable por un abogado', 'legal', 'legal', 2],
      ['propiedad-intelectual', 'Verificar que los crípticos ofrecidos sean originales y con derechos claros', 'Lista de lotes aptos para licenciar', 'legal', 'legal', 1],
      ['marketing-direccion', 'Kit comercial: muestra de 30 crípticos, formatos de entrega y casos de uso', 'PDF del kit listo para enviar', 'growth', 'marketing', 2],
      ['alianzas', 'Lista de 30 medios y editoriales hispanohablantes con contacto público', 'Lista con fuente de cada contacto; no se envía nada sin aprobación', 'growth', 'marketing', 2],
      ['finanzas', 'Propuesta de precios por tamaño de medio y forma de cobro', 'Tabla de precios para aprobar', 'human_decision', 'finance', 3],
      [null, 'Decidir precios y firmar con el primer medio', 'Primer contrato firmado', 'human_decision', 'direction', 4, true],
    ],
  },
  {
    id: 'suscripcion', name: 'Suscripción «Play Crípticos+» (freemium)',
    summary: 'El juego diario sigue gratis; la suscripción suma archivo completo, pistas ilimitadas, estadísticas avanzadas y sin publicidad.',
    why: 'Es el modelo de NYT Games: lo diario gratis atrae, el archivo y las herramientas se pagan.',
    sources: ['nyt', 'revenuecat', 'mercadopago'],
    requirements: [['wau', 1000], ['d7', 15], ['accounts', 300]],
    revenue: 'Escenario de referencia (estimación, no promesa): jugadores activos en 30 días × 2,1 % de conversión × precio mensual, menos comisión de cobro.',
    conversion: 0.021, price_usd: 2.5, fee: 0.0699 * 1.21,
    risks: ['Si la retención es baja, casi nadie paga.', 'Cobro y facturación: requiere cuenta de Mercado Pago y situación fiscal en orden.', 'Legal: términos de suscripción, arrepentimiento y baja simple.'],
    kpi: 'Suscriptores pagos y conversión de activos a pagos',
    plan: [
      ['producto', 'Definir qué queda gratis y qué es «Play Crípticos+»', 'Documento de alcance para aprobar', 'growth', 'direction', 2],
      ['legal-terminos', 'Términos de suscripción: renovación, baja, arrepentimiento y reembolsos', 'Borrador para revisión jurídica', 'legal', 'legal', 4],
      ['backend', 'Integrar suscripciones de Mercado Pago (alta, renovación, baja y webhooks)', 'Cobro de prueba en el entorno de pruebas', 'important', 'tech', 3],
      ['frontend', 'Pantalla de planes y beneficios para suscriptores', 'Pantalla en escritorio y móvil con pruebas', 'important', 'tech', 3],
      ['finanzas', 'Precio por país y proyección con supuestos explícitos', 'Tabla de precios para aprobar', 'human_decision', 'finance', 3],
      [null, 'Abrir la cuenta de cobro (Mercado Pago) y definir la situación fiscal', 'Cuenta habilitada para cobros recurrentes', 'human_decision', 'finance', 4, true],
    ],
  },
  {
    id: 'patrocinio', name: 'Patrocinio del críptico diario',
    summary: 'Una marca presenta el críptico del día o una semana temática, con mención en el sitio y en redes.',
    why: 'Aprovecha la audiencia de redes y el hábito diario sin cobrar al jugador.',
    sources: [],
    requirements: [['followers', 5000], ['wau', 2000]],
    revenue: 'Precio por semana a negociar según audiencia real del momento; no se estima sin audiencia.',
    risks: ['Toda publicidad debe identificarse como tal.', 'Evitar marcas que dañen la confianza del juego.'],
    kpi: 'Semanas patrocinadas vendidas',
    plan: [
      ['marketing-direccion', 'Kit de medios con audiencia real verificada (sitio y redes)', 'Kit con cifras de las últimas 4 semanas', 'growth', 'marketing', 2],
      ['legal-marketing', 'Reglas de identificación de contenido patrocinado por país', 'Guía aprobada', 'legal', 'legal', 3],
      ['alianzas', 'Lista de 20 marcas afines (editoriales, librerías, educación)', 'Lista con contacto público; nada se envía sin aprobación', 'growth', 'marketing', 2],
      [null, 'Fijar precio y aprobar la primera marca', 'Primera semana vendida', 'human_decision', 'direction', 4, true],
    ],
  },
  {
    id: 'publicidad', name: 'Publicidad en el sitio',
    summary: 'Anuncios en páginas de lectura (no durante la partida), con consentimiento de cookies.',
    why: 'Ingreso pasivo cuando hay volumen de visitas; con poco tráfico no compensa el costo en experiencia.',
    sources: [],
    requirements: [['entries_30d', 30000]],
    revenue: 'Depende del RPM real, que se mide con una prueba; no se estima de antemano.',
    risks: ['Empeora la experiencia y la velocidad.', 'Privacidad: consentimiento de cookies obligatorio en varios países.'],
    kpi: 'Ingreso por cada 1.000 visitas medido en la prueba',
    plan: [
      ['privacidad', 'Consentimiento de cookies publicitarias y actualización de la política', 'Borradores para aprobar', 'legal', 'legal', 4],
      ['frontend', 'Espacios publicitarios fuera de la partida, con prueba de rendimiento', 'Medición antes y después', 'important', 'tech', 3],
      [null, 'Abrir la cuenta del proveedor de anuncios', 'Cuenta aprobada', 'human_decision', 'finance', 4, true],
    ],
  },
  {
    id: 'libros', name: 'Libros y cuadernillos de crípticos (PDF e impresos)',
    summary: 'Colecciones temáticas por dificultad con soluciones explicadas, vendidas con un link de pago.',
    why: 'Usa el banco existente y se puede vender a la comunidad de redes.',
    sources: ['mercadopago'],
    requirements: [['published_clues', 1000], ['followers', 1000]],
    revenue: 'Precio por ejemplar × ventas reales; sin ventas previas no se proyecta.',
    risks: ['Derechos de cada críptico incluido.', 'Facturación de cada venta.'],
    kpi: 'Ejemplares vendidos',
    plan: [
      ['editorial', 'Seleccionar 100 crípticos por dificultad para el primer cuadernillo', 'Selección validada sin duplicados', 'growth', 'direction', 2],
      ['produccion-contenido', 'Diseñar el PDF del cuadernillo con soluciones explicadas', 'PDF final para aprobar', 'growth', 'marketing', 3],
      [null, 'Crear el link de pago y fijar el precio', 'Link de pago activo', 'human_decision', 'finance', 4, true],
    ],
  },
  {
    id: 'aportes', name: 'Aportes voluntarios de la comunidad',
    summary: 'Botón «Apoyá Play Crípticos» con un link de pago, sin beneficios a cambio.',
    why: 'Se puede activar con poca audiencia y valida si la comunidad está dispuesta a pagar.',
    sources: ['mercadopago'],
    requirements: [['wau', 200]],
    revenue: 'Ingreso bajo e irregular; sirve como señal de disposición a pagar.',
    risks: ['Debe quedar claro que no da beneficios.'],
    kpi: 'Aportes recibidos por mes',
    plan: [
      ['frontend', 'Botón de aporte en el pie y en «Mi perfil»', 'Botón visible en escritorio y móvil', 'growth', 'tech', 3],
      [null, 'Crear el link de pago para aportes', 'Link activo', 'human_decision', 'finance', 4, true],
    ],
  },
];

module.exports = { OPTIONS, SOURCES, METRICS, CHECKED };
