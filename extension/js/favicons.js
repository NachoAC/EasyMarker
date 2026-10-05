// Refreshes the icons of bookmarks whose address changed.
//
// Chrome stores favicons per page URL and only fetches them when the page is visited, so a
// bookmark moved to a new address shows the generic globe until it is opened. No extension
// API can set a bookmark's icon, so each new address is opened once, in a minimized,
// unfocused window with muted tabs, and closed as soon as Chrome has the icon. The exact
// bookmark URL is opened, #fragment included, because that is the key Chrome uses to look
// the icon up.
//
// Those visits are isolated with declarativeNetRequest session rules that apply only to
// our own tabs, and only while they are open:
// - anonymous: no cookies are sent and none are stored, so the user's sessions are never
//   used (no "log out" or "unsubscribe" link can act on their account);
// - inert: a `sandbox` CSP disables every script (inline ones too), form, popup and
//   download, and scripts, styles, fonts, frames, media and background requests are not
//   even fetched. Only the HTML and its images (the icon is one) are loaded.
// Without host access those rules would not apply, so then no page is opened at all.

import { runPool } from './pool.js';

const CONCURRENCY = 3;
const PAGE_TIMEOUT_MS = 15_000; // give up on pages that never finish loading
const LATE_ICON_MS = 2_000; // the icon usually arrives just after the page has loaded
const SAVE_MS = 750; // let Chrome store the icon before the tab closes

const HOST_PERMISSIONS = { origins: ['http://*/*', 'https://*/*'] };

/** Everything but the page itself and images, which the icon needs. */
const BLOCKED_TYPES = [
  'sub_frame',
  'stylesheet',
  'script',
  'font',
  'object',
  'xmlhttprequest',
  'ping',
  'csp_report',
  'media',
  'websocket',
  'webtransport',
  'webbundle',
  'other',
];
const ALL_TYPES = ['main_frame', 'image', ...BLOCKED_TYPES];

const INERT_PAGE_CSP = "sandbox; default-src 'none'; img-src * data:";

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
 * Pure: the session rules that isolate one tab (see the top of this file).
 * @param {number} tabId
 * @param {number} firstRuleId the rules use this id and the next one
 * @returns {chrome.declarativeNetRequest.Rule[]}
 */
export function isolationRules(tabId, firstRuleId) {
  return [
    {
      id: firstRuleId,
      priority: 1,
      action: { type: 'block' },
      condition: { tabIds: [tabId], resourceTypes: BLOCKED_TYPES },
    },
    {
      id: firstRuleId + 1,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [{ header: 'cookie', operation: 'remove' }],
        responseHeaders: [
          { header: 'set-cookie', operation: 'remove' },
          // Render HTML served as an attachment instead of downloading it.
          { header: 'content-disposition', operation: 'remove' },
          { header: 'content-security-policy', operation: 'append', value: INERT_PAGE_CSP },
        ],
      },
      // main_frame must be listed: rules without resourceTypes skip the page itself.
      condition: { tabIds: [tabId], resourceTypes: ALL_TYPES },
    },
  ];
}

/**
 * Opens every URL once, isolated, so Chrome caches its icon. Best effort: pages that fail
 * to load or have no icon are skipped. Aborting `signal` closes the window at once.
 *
 * @param {string[]} urls
 * @param {{ signal?: AbortSignal, onProgress?: (done: number, total: number) => void }} [options]
 * @returns {Promise<number | null>} how many pages provided an icon, or null when the
 *   visits could not be isolated (no host access) and nothing was opened
 */
export async function refreshFavicons(urls, { signal, onProgress } = {}) {
  if (urls.length === 0) return 0;
  if (!chrome.declarativeNetRequest || !(await chrome.permissions.contains(HOST_PERMISSIONS))) return null;

  // Leftovers from an interrupted run only target closed tabs, but start clean anyway.
  const stale = await chrome.declarativeNetRequest.getSessionRules();
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: stale.map((rule) => rule.id) });

  const window = await chrome.windows.create({ focused: false, state: 'minimized' });
  const watcher = new TabWatcher(window.id);
  const close = () => chrome.windows.remove(window.id).catch(() => {}); // the user may have closed it
  signal?.addEventListener('abort', close, { once: true });
  let nextRuleId = 1;
  let done = 0;
  let withIcon = 0;
  try {
    await runPool(
      urls,
      async (url) => {
        const firstRuleId = nextRuleId;
        nextRuleId += 2;
        if (await loadIsolated(window.id, url, firstRuleId, watcher)) withIcon += 1;
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
 * @param {number} firstRuleId
 * @param {TabWatcher} watcher
 * @returns {Promise<boolean>} whether Chrome reported an icon for the page
 */
async function loadIsolated(windowId, url, firstRuleId, watcher) {
  let tab;
  try {
    // Start blank: the rules need the tab's id, and must be in place before the page loads.
    tab = await chrome.tabs.create({ windowId, url: 'about:blank', active: false });
  } catch {
    return false; // e.g. the user closed the window
  }
  const rules = isolationRules(tab.id, firstRuleId);
  try {
    await chrome.declarativeNetRequest.updateSessionRules({ addRules: rules });
    await chrome.tabs.update(tab.id, { url, muted: true });
    const gotIcon = await watcher.waitForIcon(tab.id);
    if (gotIcon) await new Promise((resolve) => setTimeout(resolve, SAVE_MS));
    return gotIcon;
  } catch {
    return false; // the tab was closed, or the rules could not be added (the page never loads)
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => {});
    await chrome.declarativeNetRequest
      .updateSessionRules({ removeRuleIds: rules.map((rule) => rule.id) })
      .catch(() => {});
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
    // Ignore the about:blank the tab starts on: only the real page counts.
    if (change.status === 'complete' && /^https?:/.test(tab.url ?? '')) state.complete = true;
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
