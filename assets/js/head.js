/* Injects shared <head> assets so every page stays in sync */
(function () {
  const h = document.head;
  const add = (tag, attrs) => { const e = document.createElement(tag); Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v)); h.appendChild(e); };
  add('meta', { name: 'viewport', content: 'width=device-width, initial-scale=1' });
  add('meta', { name: 'theme-color', content: '#0a0a0a' });
  add('link', { rel: 'icon', href: 'assets/img/logo.jpg' });
  add('link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' });
  add('link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' });
  add('link', { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Lobster&family=Space+Grotesk:wght@400;500;600;700&display=swap' });
  add('link', { rel: 'stylesheet', href: 'assets/css/style.css?v=20260915e' });
})();
