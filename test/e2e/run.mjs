// End-to-end test: loads the real extension in Chromium, checks a set of bookmarks
// against a local server, applies a selection and verifies the resulting bookmarks.
//
//   npm run test:e2e                 # run the test
//   npm run test:e2e -- --screenshots  # also refresh store/screenshot-*.png
//   npm run test:e2e -- --screenshots --dark  # same, in dark mode (*-dark.png)
//
// Needs Playwright's Chromium (npx playwright install chromium): branded Google Chrome
// no longer loads unpacked extensions from the command line.

import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

import { BOOKMARKS, DEAD_HOST, READING_LIST, ROUTES, HTML_TITLE } from './fixtures.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const SCREENSHOTS = process.argv.includes('--screenshots');
const DARK = process.argv.includes('--dark');

const unexpectedRequests = [];
const requestCounts = new Map();
const server = await startServer();
const port = server.address().port;
const workDir = await mkdtemp(path.join(os.tmpdir(), 'easymarker-e2e-'));
let context;

try {
  const extensionDir = await prepareExtension(workDir);
  context = await chromium.launchPersistentContext(path.join(workDir, 'profile'), {
    channel: 'chromium', // full Chromium: the headless shell can't run extensions
    headless: true,
    locale: 'es-ES',
    // On Linux, Chrome picks its UI language (and chrome.i18n's) from LANGUAGE, not --lang.
    env: { ...process.env, LANGUAGE: 'es', LANG: 'es_ES.UTF-8' },
    viewport: { width: 1280, height: 800 },
    colorScheme: DARK ? 'dark' : 'light',
    args: [
      '--lang=es-ES',
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      `--host-resolver-rules=MAP ${DEAD_HOST} ~NOTFOUND, MAP *.test 127.0.0.1:${port}`,
    ],
  });

  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const appUrl = `chrome-extension://${new URL(worker.url()).host}/app.html`;
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error));
  page.on('console', (message) => {
    // Chrome logs every failed request ("Failed to load resource: 404…"): that's the job here.
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) {
      pageErrors.push(message.text());
    }
  });

  await page.goto(appUrl);
  await seed(page);
  await page.reload();

  await step('start screen shows the inventory', async () => {
    await page.locator('#stat-bookmarks').filter({ hasText: '15' }).waitFor();
    assert.equal(await page.locator('#stat-reading-list').textContent(), '3');
    assert.equal(await page.locator('#scan-button').textContent(), 'Analizar enlaces');
    await screenshot(page, 'screenshot-1-start');
  });

  await step('the toolbar button finds the open app tab', async () => {
    const contexts = await worker.evaluate(
      (url) => chrome.runtime.getContexts({ contextTypes: ['TAB'], documentUrls: [url] }),
      appUrl,
    );
    assert.equal(contexts.length, 1);
  });

  await step('scan proposes the expected changes', async () => {
    await page.dblclick('#scan-button'); // a double click must not start two scans
    await page.locator('#view-review').waitFor({ timeout: 60_000 });

    const updates = await readRows(page, 'update');
    assert.deepEqual(
      new Set(updates.map(({ title, checked, badge, newUrl }) => `${title} | ${checked} | ${badge} | ${newUrl}`)),
      new Set([
        'Guía de la API v1 | true | 301 · Movido | http://docs.acme.test/v2/guide#auth',
        'Blog del equipo | true | 308 · Movido | http://news.acme.test/2019/launch',
        'Ofertas de la tienda | true | 301 · Movido | http://shop.test/offers',
        'Cómo empezar | true | 301 · Movido | http://docs.acme.test/rl/start',
        'Wiki interna (antigua) | false | 301 · Lleva a la portada | http://wiki.acme.test/',
        'Panel de facturación | false | 302 · Redirección temporal | http://billing.acme.test/login?next=%2Fdashboard',
      ]),
    );
    assert.deepEqual(
      updates.map((row) => row.checked),
      [true, true, true, true, false, false],
      'pre-selected rows come first',
    );

    const removals = await readRows(page, 'remove');
    assert.deepEqual(
      new Set(removals.map(({ title, checked, badge }) => `${title} | ${checked} | ${badge}`)),
      new Set([
        'Artículo sobre extensiones | true | 404 · No encontrado',
        'Artículo sobre extensiones (copia) | true | 404 · No encontrado',
        `${HTML_TITLE} | true | 404 · No encontrado`,
        'Noticia borrada | true | 404 · No encontrado',
        'Curso de introducción | true | 410 · Eliminado',
        'Proyecto open source | true | El dominio no existe',
        'Hilo del foro | false | 503 · Error del servidor',
      ]),
    );
    assert.deepEqual(
      removals.map((row) => row.checked),
      [true, true, true, true, true, true, false],
      'pre-selected rows come first',
    );

    const summary = await page.locator('#review-summary').textContent();
    assert.equal(summary, 'Correctos: 4 · Sin comprobar: 0 · Omitidos: 1');
    assert.equal(await page.locator('#count-update').textContent(), '6');
    assert.equal(await page.locator('#count-remove').textContent(), '7');
    assert.equal(await page.locator('#selection-summary').textContent(), 'Para actualizar: 4 · Para eliminar: 6');

    // The last row must be reachable above the fixed action bar.
    const overlap = await page.evaluate(() => {
      window.scrollTo(0, document.scrollingElement.scrollHeight);
      const rows = document.querySelectorAll('#rows-update .row');
      const last = rows[rows.length - 1].getBoundingClientRect();
      return last.bottom - document.getElementById('actionbar').getBoundingClientRect().top;
    });
    assert.ok(overlap <= 0, `last row hidden ${overlap}px behind the action bar`);

    // At most HEAD + GET per address (no retries for HTTP answers, no second scan).
    const repeated = [...requestCounts].filter(([, count]) => count > 2);
    assert.deepEqual(repeated, []);
  });

  await step('titles are shown as text, never as HTML', async () => {
    assert.equal(await page.locator('#rows-remove .row-title b').count(), 0);
    assert.equal(await page.locator('#rows-remove .row-title', { hasText: '<b>importantes</b>' }).count(), 1);
  });

  await step('the user can change the selection', async () => {
    await page.locator('#rows-update .row', { hasText: 'Panel de facturación' }).locator('.row-check').check();
    await screenshot(page, 'screenshot-2-update');

    // Tabs work with the keyboard too.
    await page.focus('#tab-update');
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('#tab-remove').getAttribute('aria-selected'), 'true');
    assert.equal(await page.locator('#panel-update').isHidden(), true);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'tab-remove');
    await page.locator('#rows-remove .row', { hasText: 'Curso de introducción' }).locator('.row-head').click();
    assert.equal(await page.locator('#select-all-remove').evaluate((box) => box.indeterminate), true);
    assert.equal(await page.locator('#selection-summary').textContent(), 'Para actualizar: 5 · Para eliminar: 5');
    await screenshot(page, 'screenshot-3-remove');

    await page.click('#select-all-remove');
    assert.equal(await page.locator('#rows-remove .row-check:checked').count(), 7);
    await page.click('#select-all-remove');
    assert.equal(await page.locator('#rows-remove .row-check:checked').count(), 0);
    for (const title of ['Artículo sobre extensiones', 'Artículo sobre extensiones (copia)', 'Proyecto open source', 'Noticia borrada']) {
      await page.locator('#rows-remove .row').filter({ has: page.getByText(title, { exact: true }) }).locator('.row-check').check();
    }
    await page.locator('#rows-remove .row').filter({ has: page.getByText(HTML_TITLE, { exact: true }) }).locator('.row-check').check();
    assert.equal(await page.locator('#selection-summary').textContent(), 'Para actualizar: 5 · Para eliminar: 5');
  });

  await step('a backup can be downloaded', async () => {
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#backup-button')]);
    assert.match(download.suggestedFilename(), /^easymarker-backup-\d{4}-\d{2}-\d{2}\.html$/);
    const html = await readFile(await download.path(), 'utf8');
    assert.match(html, /^<!DOCTYPE NETSCAPE-Bookmark-file-1>/);
    assert.ok(html.includes('>Notas &lt;b&gt;importantes&lt;/b&gt; &amp; &quot;citas&quot;</A>'));
    assert.ok(html.includes('<H3>Lista de lectura</H3>'));
  });

  await step('changes made after the scan are not overwritten', async () => {
    // Someone edits a bookmark while the review screen is open.
    await page.evaluate(async () => {
      const [node] = await chrome.bookmarks.search({ title: 'Blog del equipo' });
      await chrome.bookmarks.update(node.id, { url: 'http://blog.acme.test/edited-by-hand' });
    });
  });

  await step('applying asks for confirmation and applies the selection', async () => {
    await page.click('#apply-button');
    await page.locator('#confirm-dialog').waitFor();
    assert.equal(await page.locator('#confirm-updates').textContent(), '5');
    assert.equal(await page.locator('#confirm-removals').textContent(), '5');
    await screenshot(page, 'screenshot-4-confirm');

    // Cancel first: nothing happens.
    await page.locator('#confirm-dialog button[value="cancel"]').click();
    assert.equal(await page.locator('#view-review').isVisible(), true);

    await page.click('#apply-button');
    await page.click('#confirm-apply');
    await page.locator('#view-done').waitFor();
    assert.equal(await page.locator('#done-summary').textContent(), 'Actualizados: 4 · Eliminados: 5');
    assert.deepEqual(await page.locator('#failure-list li').allTextContents(), [
      'Blog del equipo — ha cambiado o ya no existe desde el análisis',
    ]);
    await screenshot(page, 'screenshot-5-done');
  });

  await step('bookmarks and reading list end up as expected', async () => {
    const { bookmarks, readingList } = await page.evaluate(async () => {
      const [tree] = await chrome.bookmarks.getTree();
      const flat = [];
      const walk = (node) => (node.url ? flat.push([node.title, node.url]) : node.children?.forEach(walk));
      walk(tree);
      const entries = await chrome.readingList.query({});
      return {
        bookmarks: Object.fromEntries(flat),
        readingList: entries.map(({ title, url, hasBeenRead }) => ({ title, url, hasBeenRead })),
      };
    });

    assert.deepEqual(bookmarks, {
      'Guía de la API v1': 'http://docs.acme.test/v2/guide#auth',
      'Panel de facturación': 'http://billing.acme.test/login?next=%2Fdashboard',
      'Blog del equipo': 'http://blog.acme.test/edited-by-hand',
      'Wiki interna (antigua)': 'http://wiki.acme.test/old-page',
      'Estado del servicio': 'http://status.acme.test/',
      'Ofertas de la tienda': 'http://shop.test/offers',
      'Curso de introducción': 'http://learn.test/course/old',
      'Hilo del foro': 'http://forum.test/thread/7',
      Descargas: 'http://files.test/download',
      'Área de clientes': 'http://private.test/area',
      Bookmarklet: 'javascript:void(0)',
    });

    assert.deepEqual(
      readingList.sort((a, b) => a.url.localeCompare(b.url)),
      [
        { title: 'Cómo empezar', url: 'http://docs.acme.test/rl/start', hasBeenRead: true },
        { title: 'Receta del domingo', url: 'http://status.acme.test/rl/ok', hasBeenRead: false },
      ],
    );
  });

  await step('the page logged no errors and the server saw no unexpected requests', async () => {
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(unexpectedRequests, []);
  });

  console.log('\nE2E OK');
} finally {
  await context?.close();
  server.close();
  await rm(workDir, { recursive: true, force: true });
}

// ---------------------------------------------------------------- helpers

async function step(name, body) {
  process.stdout.write(`• ${name} … `);
  await body();
  process.stdout.write('ok\n');
}

/**
 * Automation can't click Chrome's permission prompt, so the test build grants the
 * optional host permissions up front. chrome.permissions.request() then resolves
 * immediately, exercising the same code path as a user who clicks "Allow".
 */
async function prepareExtension(dir) {
  const target = path.join(dir, 'extension');
  await cp(path.join(ROOT, 'extension'), target, { recursive: true });
  const manifestPath = path.join(target, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.host_permissions = manifest.optional_host_permissions;
  delete manifest.optional_host_permissions;
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  return target;
}

async function seed(page) {
  await page.evaluate(
    async ({ bookmarks, readingList }) => {
      for (const [parentId, folders] of Object.entries(bookmarks)) {
        for (const [folder, items] of Object.entries(folders)) {
          const parent = folder ? (await chrome.bookmarks.create({ parentId, title: folder })).id : parentId;
          for (const [title, url] of items) await chrome.bookmarks.create({ parentId: parent, title, url });
        }
      }
      for (const entry of readingList) await chrome.readingList.addEntry(entry);
    },
    { bookmarks: BOOKMARKS, readingList: READING_LIST },
  );
}

async function readRows(page, list) {
  return page.locator(`#rows-${list} .row`).evaluateAll((rows) =>
    rows.map((row) => ({
      title: row.querySelector('.row-title').textContent,
      checked: row.querySelector('.row-check').checked,
      badge: row.querySelector('.badge').textContent,
      newUrl: row.querySelector('.row-url-new')?.textContent ?? null,
    })),
  );
}

async function screenshot(page, name) {
  if (!SCREENSHOTS) return;
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300); // let the selection fade finish
  await page.screenshot({ path: path.join(ROOT, 'store', `${name}${DARK ? '-dark' : ''}.png`) });
}

function startServer() {
  const handler = (request, response) => {
    const key = `${request.headers.host}${request.url}`;
    requestCounts.set(key, (requestCounts.get(key) ?? 0) + 1);
    const route = ROUTES[key];
    if (!route) unexpectedRequests.push(`${request.method} ${key}`);
    if (request.headers.cookie) unexpectedRequests.push(`cookie sent to ${key}`);
    const status = route ? (request.method === 'HEAD' && route.headStatus) || route.status : 404;
    response.writeHead(status, route?.location ? { Location: route.location } : { 'Content-Type': 'text/plain' });
    response.end(request.method === 'HEAD' ? undefined : 'EasyMarker test server');
  };
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}
