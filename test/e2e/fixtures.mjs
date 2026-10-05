// Test data for the end-to-end run. Every *.test host resolves to the local server
// (see --host-resolver-rules in run.mjs) except DEAD_HOST, which doesn't resolve at all.

export const DEAD_HOST = 'abandoned-project.test';

const redirect = (status, location) => ({ status, location });
const reply = (status) => ({ status });

// Like many real sites (Next.js, Shopify…), every response advertises assets to preload.
// The extension must never act on them: no request to ASSET_HOST, no CSP errors.
export const ASSET_HOST = 'assets.cdn.test';
export const PRELOAD_LINKS = [
  `<http://${ASSET_HOST}/font.woff2>; rel=preload; as=font; type="font/woff2"; crossorigin`,
  `<http://${ASSET_HOST}/style.css>; rel=preload; as=style`,
  `<http://${ASSET_HOST}/app.js>; rel=preload; as=script`,
  `<http://${ASSET_HOST}/logo.png>; rel=preload; as=image`,
].join(', ');

/** "host/path" → response. Anything else answers 404 and is reported as unexpected. */
export const ROUTES = {
  'docs.acme.test/v1/guide': redirect(301, 'http://docs.acme.test/v2/guide'),
  'docs.acme.test/v2/guide': reply(200),
  'billing.acme.test/dashboard': redirect(302, 'http://billing.acme.test/login?next=%2Fdashboard'),
  'billing.acme.test/login?next=%2Fdashboard': reply(200),
  'blog.acme.test/2019/launch': redirect(308, 'http://news.acme.test/2019/launch'),
  'news.acme.test/2019/launch': reply(200),
  'wiki.acme.test/old-page': redirect(301, 'http://wiki.acme.test/'),
  'wiki.acme.test/': reply(200),
  'status.acme.test/': reply(200),
  'shop.test/old-offers': redirect(301, 'http://shop.test/offers'),
  'shop.test/offers': redirect(302, 'http://shop.test/login'),
  'shop.test/login': reply(200),
  'magazine.test/articles/42': reply(404),
  'magazine.test/notes': reply(404),
  'learn.test/course/old': reply(410),
  'forum.test/thread/7': reply(503),
  'files.test/download': { status: 200, headStatus: 405 },
  'private.test/area': reply(403),
  'docs.acme.test/rl/getting-started': redirect(301, 'http://docs.acme.test/rl/start'),
  'docs.acme.test/rl/start': reply(200),
  'magazine.test/rl/gone': reply(404),
  'status.acme.test/rl/ok': reply(200),
};

// If a title were ever parsed as HTML, the <b> would become an element.
export const HTML_TITLE = 'Notas <b>importantes</b> & "citas"';

/** Bookmarks to create, by parent folder: '1' = bookmarks bar, '2' = other bookmarks. */
export const BOOKMARKS = {
  '1': {
    Trabajo: [
      ['Guía de la API v1', 'http://docs.acme.test/v1/guide#auth'],
      ['Panel de facturación', 'http://billing.acme.test/dashboard'],
      ['Blog del equipo', 'http://blog.acme.test/2019/launch'],
      ['Wiki interna (antigua)', 'http://wiki.acme.test/old-page'],
      ['Estado del servicio', 'http://status.acme.test/'],
      ['Ofertas de la tienda', 'http://shop.test/old-offers'],
    ],
    Lecturas: [
      ['Artículo sobre extensiones', 'http://magazine.test/articles/42'],
      ['Curso de introducción', 'http://learn.test/course/old'],
      ['Proyecto open source', `http://${DEAD_HOST}/`],
      ['Hilo del foro', 'http://forum.test/thread/7'],
      ['Descargas', 'http://files.test/download'],
      ['Área de clientes', 'http://private.test/area'],
    ],
  },
  '2': {
    '': [
      ['Artículo sobre extensiones (copia)', 'http://magazine.test/articles/42'],
      ['Bookmarklet', 'javascript:void(0)'],
      [HTML_TITLE, 'http://magazine.test/notes'],
    ],
  },
};

export const READING_LIST = [
  { title: 'Cómo empezar', url: 'http://docs.acme.test/rl/getting-started', hasBeenRead: true },
  { title: 'Noticia borrada', url: 'http://magazine.test/rl/gone', hasBeenRead: false },
  { title: 'Receta del domingo', url: 'http://status.acme.test/rl/ok', hasBeenRead: false },
];
