/* Play Crípticos: anuncios de Google AdSense. Solo se carga en páginas con anuncios (ver src/services/ads.js). */
(function () {
  'use strict';

  let boot = null;
  try { boot = JSON.parse(document.getElementById('boot').textContent).ads; } catch (e) { boot = null; }
  if (!boot || !/^ca-pub-\d+$/.test(boot.client || '')) return;
  const queue = (window.adsbygoogle = window.adsbygoogle || []);
  // Si el navegador pide no ser rastreado, se piden anuncios no personalizados.
  if (navigator.doNotTrack === '1' || navigator.globalPrivacyControl) queue.requestNonPersonalizedAds = 1;
  // El aviso de consentimiento (Unión Europea, Reino Unido, Suiza y estados de EE. UU.) lo
  // muestra el propio script de Google cuando está configurado en «Privacidad y mensajes» de AdSense.
  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + encodeURIComponent(boot.client);
  s.crossOrigin = 'anonymous';
  document.head.appendChild(s);
  // Bloques manuales (si hay ADSENSE_SLOT); los automáticos los ubica Google.
  document.querySelectorAll('ins.adsbygoogle:not([data-adsbygoogle-status])').forEach(() => {
    try { queue.push({}); } catch (e) { /* bloqueador de anuncios */ }
  });
})();
