'use strict';

/* ======================================================================
   «Свиток» как мини-апп внутри Telegram.
   Telegram открывает сайт с #tgWebAppData=... — тогда сразу показываем приложение,
   подгружаем SDK, растягиваем на весь экран, отключаем «смахнуть вниз, чтобы закрыть»
   (иначе он мешает листать ленту) и учитываем вырезы/кнопки Telegram.
   ====================================================================== */
const Tg = (() => {
  const inTg = /tgWebApp/.test(location.hash) || document.documentElement.classList.contains('in-tg');
  let wa = null;
  let readyPromise = null;

  function loadSdk() {
    return new Promise((resolve) => {
      if (window.Telegram?.WebApp) { resolve(window.Telegram.WebApp); return; }
      const s = document.createElement('script');
      s.src = 'https://telegram.org/js/telegram-web-app.js?59';
      s.onload = () => resolve(window.Telegram?.WebApp || null);
      s.onerror = () => resolve(null);
      document.head.appendChild(s);
    });
  }

  function applySafeArea() {
    if (!wa) return;
    const s = wa.safeAreaInset || {}, c = wa.contentSafeAreaInset || {};
    const root = document.documentElement.style;
    root.setProperty('--safe-t', `${(s.top || 0) + (c.top || 0)}px`);
    root.setProperty('--safe-b', `${(s.bottom || 0) + (c.bottom || 0)}px`);
  }

  function ready() {
    if (!inTg) return Promise.resolve(null);
    if (readyPromise) return readyPromise;
    readyPromise = (async () => {
      wa = await loadSdk();
      if (!wa) return null;
      try { wa.ready(); wa.expand(); } catch { /* старый клиент */ }
      try { if (wa.isVersionAtLeast?.('7.7')) wa.disableVerticalSwipes(); } catch { /* */ }
      try { if (wa.isVersionAtLeast?.('8.0') && ['ios', 'android'].includes(wa.platform)) wa.requestFullscreen(); } catch { /* */ }
      try { wa.setHeaderColor('#0f0e0c'); wa.setBackgroundColor('#0f0e0c'); wa.setBottomBarColor?.('#0c0b09'); } catch { /* */ }
      applySafeArea();
      ['safeAreaChanged', 'contentSafeAreaChanged', 'fullscreenChanged', 'viewportChanged'].forEach((ev) => {
        try { wa.onEvent(ev, applySafeArea); } catch { /* */ }
      });
      return wa;
    })();
    return readyPromise;
  }

  /* поделиться текстом через Telegram (navigator.share внутри Telegram обычно нет) */
  function shareText(text, url) {
    if (!wa) return false;
    const link = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
    try { wa.openTelegramLink(link); return true; } catch { return false; }
  }

  /* иконка мини-аппа на экране «Домой» (Telegram 8.0+): unsupported | unknown | added | missed */
  function homeScreenStatus() {
    return new Promise((resolve) => {
      if (!wa || !wa.isVersionAtLeast?.('8.0') || typeof wa.checkHomeScreenStatus !== 'function') { resolve('unsupported'); return; }
      const t = setTimeout(() => resolve('unknown'), 1500);
      try { wa.checkHomeScreenStatus((st) => { clearTimeout(t); resolve(st || 'unknown'); }); } catch { clearTimeout(t); resolve('unsupported'); }
    });
  }
  function addToHomeScreen(onAdded) {
    if (!wa || typeof wa.addToHomeScreen !== 'function') return false;
    try { wa.onEvent('homeScreenAdded', () => onAdded && onAdded()); } catch { /* */ }
    try { wa.addToHomeScreen(); return true; } catch { return false; }
  }

  /* стих из ссылки: t.me/<бот>/app?startapp=v_<книга>_<глава>_<стих> или кнопка бота с ?v=<книга>_<глава>_<стих> */
  function verseLink() {
    const start = new URLSearchParams(location.hash.slice(1)).get('tgWebAppStartParam') || '';
    const q = new URLSearchParams(location.search).get('v') || '';
    const m = (start.match(/^v_(\d+_\d+_\d+)$/)?.[1] || q).match(/^(\d+)_(\d+)_(\d+)$/);
    return m ? { b: +m[1], c: +m[2], v: +m[3] } : null;
  }

  return { inTg, ready, verseLink, shareText, homeScreenStatus, addToHomeScreen, initData: () => wa?.initData || '', get wa() { return wa; } };
})();
