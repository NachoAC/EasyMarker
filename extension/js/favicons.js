// Refreshes the icons of bookmarks whose address changed.
//
// Chrome stores favicons per page URL and only fetches them when the page is visited, so a
// bookmark moved to a new address shows the generic globe until it is opened. No extension
// API can set a bookmark's icon, so we do what the user would do: open each new address once,
// in a minimized, unfocused window with muted tabs, and close it as soon as Chrome has
// the icon. The exact bookmark URL is opened, #fragment included, because that is the key
// Chrome uses to look the icon up.

import { runPool } from './pool.js';

const CONCURRENCY = 3;
const PAGE_TIMEOUT_MS = 15_000; // give up on pages that never finish loading
const LATE_ICON_MS = 2_000; // the icon usually arrives just after the page has loaded
const SAVE_MS = 750; // let Chrome store the icon before the tab closes

/**
 * Pure: the addresses to open for the updates that were applied.
 * Only web pages (never PDFs or downloads), each address once.
 * @param {{ newUrl?: string | null, isPage?: boolean }[]} updates
 * @returns {string[]}
 */
export function faviconTargets(updates) {
  return [...new Set(updates.filter((item) => item.isPage && item.newUrl).map((item) => item.newUrl))];
}

/**
 * Opens every URL once so Chrome caches its icon. Best effort: pages that fail to load
 * or have no icon are skipped. Aborting `signal` stops opening new pages.
 *
 * @param {string[]} urls
 * @param {{ signal?: AbortSignal, onProgress?: (done: number, total: number) => void }} [options]
 * @returns {Promise<number>} how many pages provided an icon
 */
export async function refreshFavicons(urls, { signal, onProgress } = {}) {
  if (urls.length === 0) return 0;

  const window = await chrome.windows.create({ focused: false, state: 'minimized' });
  const watcher = new TabWatcher(window.id);
  // Skipping closes the window at once: pages still loading are dropped, not waited for.
  const close = () => chrome.windows.remove(window.id).catch(() => {}); // the user may have closed it
  signal?.addEventListener('abort', close, { once: true });
  let done = 0;
  let withIcon = 0;
  try {
    await runPool(
      urls,
      async (url) => {
        if (await loadOnce(window.id, url, watcher)) withIcon += 1;
        done += 1;
        onProgress?.(done, urls.length);
      },
      { concurrency: CONCURRENCY, perGroup: CONCURRENCY, signal },
    );
  } finally {
    signal?.removeEventListener('abort', close);
    watcher.stop();
    await close();
  }
  return withIcon;
}

/**
 * @param {number} windowId
 * @param {string} url
 * @param {TabWatcher} watcher
 * @returns {Promise<boolean>} whether Chrome reported an icon for the page
 */
async function loadOnce(windowId, url, watcher) {
  let tab;
  try {
    tab = await chrome.tabs.create({ windowId, url, active: false });
  } catch {
    return false; // e.g. the user closed the window
  }
  try {
    chrome.tabs.update(tab.id, { muted: true }).catch(() => {});
    const gotIcon = await watcher.waitForIcon(tab.id);
    if (gotIcon) await new Promise((resolve) => setTimeout(resolve, SAVE_MS));
    return gotIcon;
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

/**
 * Follows the tabs of our window. Listening starts before any tab is created, so no
 * update is missed, however fast a page (or its cached icon) loads.
 */
class TabWatcher {
  /** @type {Map<number, { icon: boolean, complete: boolean, removed: boolean, wake: () => void }>} */
  #tabs = new Map();
  #windowId;

  #onUpdated = (tabId, change, tab) => {
    if (tab.windowId !== this.#windowId) return;
    const state = this.#state(tabId);
    if (change.favIconUrl) state.icon = true;
    if (change.status === 'complete') state.complete = true;
    state.wake();
  };

  #onRemoved = (tabId) => {
    const state = this.#tabs.get(tabId);
    if (!state) return;
    state.removed = true;
    state.wake();
  };

  /** @param {number} windowId */
  constructor(windowId) {
    this.#windowId = windowId;
    chrome.tabs.onUpdated.addListener(this.#onUpdated);
    chrome.tabs.onRemoved.addListener(this.#onRemoved);
  }

  stop() {
    chrome.tabs.onUpdated.removeListener(this.#onUpdated);
    chrome.tabs.onRemoved.removeListener(this.#onRemoved);
  }

  /**
   * Resolves true once Chrome reports the tab's icon, false if the page has none,
   * never finishes loading or the tab is closed.
   * @param {number} tabId
   */
  async waitForIcon(tabId) {
    const state = this.#state(tabId);
    const deadline = Date.now() + PAGE_TIMEOUT_MS;
    let lateIconDeadline = Infinity;
    while (!state.icon && !state.removed) {
      if (state.complete && lateIconDeadline === Infinity) lateIconDeadline = Date.now() + LATE_ICON_MS;
      const remaining = Math.min(deadline, lateIconDeadline) - Date.now();
      if (remaining <= 0) break;
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, remaining);
        state.wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      state.wake = () => {};
    }
    this.#tabs.delete(tabId);
    return state.icon;
  }

  #state(tabId) {
    let state = this.#tabs.get(tabId);
    if (!state) {
      state = { icon: false, complete: false, removed: false, wake: () => {} };
      this.#tabs.set(tabId, state);
    }
    return state;
  }
}
