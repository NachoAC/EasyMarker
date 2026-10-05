// Checks links over the network.
//
// fetch() alone hides two things we need: the status code of each redirect hop
// (301 "moved" vs 302 "temporarily elsewhere") and the exact network error
// (a domain that no longer exists vs a server that is just down). Both are visible
// through chrome.webRequest, so while a scan runs we observe our own requests.
//
// The requests themselves run in a dedicated worker (fetch-worker.js): from a document,
// Chrome would act on the `Link: rel=preload` headers of the checked sites.

import { classify, isRetryableError } from './classify.js';
import { runPool } from './pool.js';
import { hostOf } from './url-utils.js';

const REQUEST_TIMEOUT_MS = 12_000;
const OBSERVER_GRACE_MS = 1_500;
const RETRY_DELAY_MS = 1_000;
const CONCURRENCY = 8;
const PER_HOST = 2;

/** @typedef {import('./classify.js').CheckResult} CheckResult */
/** @typedef {import('./classify.js').Outcome} Outcome */
/** @typedef {import('./classify.js').Hop} Hop */

/**
 * @typedef {object} Tracked
 * @property {string} key
 * @property {string | null} requestId
 * @property {Hop[]} hops
 * @property {{ statusCode?: number, error?: string } | null} terminal
 * @property {Promise<void>} settled resolves on the request's final webRequest event
 * @property {(info: { statusCode?: number, error?: string }) => void} settle
 */

class RequestObserver {
  /** @type {Map<string, Tracked>} keyed by "METHOD url"; waiting for their requestId */
  #pending = new Map();
  /** @type {Map<string, Tracked>} keyed by webRequest requestId */
  #byId = new Map();
  #origin = self.location.origin;
  #filter = { urls: ['http://*/*', 'https://*/*'], types: ['xmlhttprequest'] };

  #onBeforeRequest = (details) => {
    // Only our own requests. Redirect hops reuse the requestId we already know.
    if (details.initiator !== this.#origin || this.#byId.has(details.requestId)) return;
    const tracked = this.#pending.get(`${details.method} ${details.url}`);
    if (!tracked || tracked.requestId !== null) return;
    tracked.requestId = details.requestId;
    this.#byId.set(details.requestId, tracked);
  };

  #onBeforeRedirect = (details) => {
    this.#byId.get(details.requestId)?.hops.push({
      from: details.url,
      to: details.redirectUrl,
      statusCode: details.statusCode,
    });
  };

  #onResponseStarted = (details) => {
    this.#byId.get(details.requestId)?.settle({ statusCode: details.statusCode });
  };

  #onErrorOccurred = (details) => {
    this.#byId.get(details.requestId)?.settle({ error: details.error });
  };

  start() {
    chrome.webRequest.onBeforeRequest.addListener(this.#onBeforeRequest, this.#filter);
    chrome.webRequest.onBeforeRedirect.addListener(this.#onBeforeRedirect, this.#filter);
    chrome.webRequest.onResponseStarted.addListener(this.#onResponseStarted, this.#filter);
    chrome.webRequest.onErrorOccurred.addListener(this.#onErrorOccurred, this.#filter);
  }

  // Listeners are removed as soon as the scan ends: we don't observe normal browsing.
  stop() {
    chrome.webRequest.onBeforeRequest.removeListener(this.#onBeforeRequest);
    chrome.webRequest.onBeforeRedirect.removeListener(this.#onBeforeRedirect);
    chrome.webRequest.onResponseStarted.removeListener(this.#onResponseStarted);
    chrome.webRequest.onErrorOccurred.removeListener(this.#onErrorOccurred);
    this.#pending.clear();
    this.#byId.clear();
  }

  /**
   * Starts watching for the next request to `url` with `method`.
   * @returns {Tracked}
   */
  track(url, method) {
    /** @type {() => void} */
    let resolve = () => {};
    /** @type {Tracked} */
    const tracked = {
      key: `${method} ${url}`,
      requestId: null,
      hops: [],
      terminal: null,
      settled: new Promise((r) => {
        resolve = r;
      }),
      settle(info) {
        tracked.terminal ??= info;
        resolve();
      },
    };
    this.#pending.set(tracked.key, tracked);
    return tracked;
  }

  /** @param {Tracked} tracked */
  untrack(tracked) {
    if (this.#pending.get(tracked.key) === tracked) this.#pending.delete(tracked.key);
    if (tracked.requestId !== null) this.#byId.delete(tracked.requestId);
  }
}

/** Page-side client for fetch-worker.js. */
class RequestWorker {
  #worker = new Worker(new URL('./fetch-worker.js', import.meta.url));
  /** @type {Map<number, { resolve: (reply: object) => void, reject: (error: Error) => void }>} */
  #pending = new Map();
  #nextId = 0;

  constructor() {
    this.#worker.addEventListener('message', ({ data }) => {
      this.#pending.get(data.id)?.resolve(data);
      this.#pending.delete(data.id);
    });
    this.#worker.addEventListener('error', (event) => {
      event.preventDefault();
      this.#failAll(new Error(`Link checker worker failed: ${event.message}`));
    });
  }

  /**
   * Requests `url` and resolves once the response headers arrive.
   * Aborting `signal` cancels the request; it then resolves as failed.
   * @param {string} url
   * @param {'HEAD' | 'GET'} method
   * @param {AbortSignal} signal
   * @returns {Promise<{ status: number, finalUrl: string, contentType: string | null } | { failed: true }>}
   */
  fetch(url, method, signal) {
    const id = this.#nextId++;
    const abort = () => this.#worker.postMessage({ type: 'abort', id });
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#worker.postMessage({ type: 'fetch', id, url, method });
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    }).finally(() => signal.removeEventListener('abort', abort));
  }

  terminate() {
    this.#worker.terminate();
    this.#failAll(new Error('Link checker worker stopped'));
  }

  #failAll(error) {
    for (const { reject } of this.#pending.values()) reject(error);
    this.#pending.clear();
  }
}

/** @typedef {{ observer: RequestObserver, requests: RequestWorker }} Network */

/**
 * Checks every link and reports each result as soon as it is known.
 * Links sharing the same address are checked once.
 *
 * @template {{ requestUrl: string }} L
 * @param {L[]} links
 * @param {{ signal: AbortSignal, onResult: (result: CheckResult, links: L[]) => void }} options
 */
export async function scanLinks(links, { signal, onResult }) {
  const byUrl = Map.groupBy(links, (link) => link.requestUrl);
  /** @type {Network} */
  const network = { observer: new RequestObserver(), requests: new RequestWorker() };
  network.observer.start();
  try {
    await runPool(
      byUrl.keys(),
      async (url) => {
        const result = await checkUrl(network, url, signal);
        onResult(result, byUrl.get(url));
      },
      { concurrency: CONCURRENCY, perGroup: PER_HOST, groupOf: hostOf, signal },
    );
  } finally {
    network.observer.stop();
    network.requests.terminate();
  }
}

/**
 * @param {Network} network
 * @param {string} url
 * @param {AbortSignal} signal
 * @returns {Promise<CheckResult>}
 */
async function checkUrl(network, url, signal) {
  // HEAD is cheap, but many servers reject or mishandle it: confirm any failure with GET.
  let outcome = await attempt(network, url, 'HEAD', signal);
  if (outcome.type === 'error' || outcome.status >= 400) {
    outcome = await attempt(network, url, 'GET', signal);
    if (outcome.type === 'error' && isRetryableError(outcome.error)) {
      await sleep(RETRY_DELAY_MS, signal);
      outcome = await attempt(network, url, 'GET', signal);
    }
  }
  return classify(url, outcome);
}

/**
 * @param {Network} network
 * @param {string} url
 * @param {'HEAD' | 'GET'} method
 * @param {AbortSignal} signal
 * @returns {Promise<Outcome>}
 */
async function attempt({ observer, requests }, url, method, signal) {
  const tracked = observer.track(url, method);
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  try {
    const reply = await requests.fetch(url, method, AbortSignal.any([signal, timeout]));
    signal.throwIfAborted();
    if ('failed' in reply) {
      if (timeout.aborted) return { type: 'error', error: 'timeout' };
      await settledWithin(tracked, OBSERVER_GRACE_MS);
      return { type: 'error', error: tracked.terminal?.error ?? 'net::ERR_FAILED' };
    }
    await settledWithin(tracked, OBSERVER_GRACE_MS);
    return {
      type: 'response',
      status: reply.status,
      finalUrl: reply.finalUrl,
      contentType: reply.contentType,
      hops: tracked.requestId === null ? null : tracked.hops,
    };
  } finally {
    observer.untrack(tracked);
  }
}

/**
 * webRequest events and the fetch() response travel separately; give the observer a
 * moment to report the final event so the redirect chain is complete.
 * @param {Tracked} tracked
 * @param {number} ms
 */
function settledWithin(tracked, ms) {
  let timer;
  return Promise.race([
    tracked.settled,
    new Promise((resolve) => {
      timer = setTimeout(resolve, ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * @param {number} ms
 * @param {AbortSignal} signal
 */
function sleep(ms, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
