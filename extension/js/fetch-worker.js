// Dedicated worker that makes the link-check requests for checker.js.
//
// Many sites answer with `Link: <…>; rel=preload` headers (fonts, stylesheets, scripts,
// images). When fetch() runs in a document, Chrome acts on those headers and tries to
// preload the assets into the extension page; the extension's CSP blocks every one, but
// each attempt is logged as an error. A worker has no document, so Chrome ignores them.
//
// Protocol (postMessage):
//   page → worker  { type: 'fetch', id, url, method }   start a request
//   page → worker  { type: 'abort', id }                cancel it
//   worker → page  { id, status, finalUrl }             response headers received
//   worker → page  { id, failed: true }                 network error or aborted

/** @type {Map<number, AbortController>} */
const controllers = new Map();

self.addEventListener('message', async ({ data }) => {
  if (data.type === 'abort') {
    controllers.get(data.id)?.abort();
    return;
  }

  const { id, url, method } = data;
  const controller = new AbortController();
  controllers.set(id, controller);
  try {
    const response = await fetch(url, {
      method,
      signal: controller.signal,
      redirect: 'follow',
      // Anonymous, uncached request: no cookies are sent (so no session side effects)
      // and the target site isn't told where the request came from.
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
    // Only the status matters: drop the body instead of downloading it.
    response.body?.cancel().catch(() => {});
    self.postMessage({ id, status: response.status, finalUrl: response.url });
  } catch {
    self.postMessage({ id, failed: true });
  } finally {
    controllers.delete(id);
  }
});
