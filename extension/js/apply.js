// Applies the changes the user confirmed.
//
// Every item is re-read right before it is changed: if the bookmark was edited or
// deleted since the scan (in this or another window, or by sync), it is left alone.

import { parseHttpUrl } from './url-utils.js';

export class StaleItemError extends Error {
  constructor() {
    super('The item changed or no longer exists');
    this.name = 'StaleItemError';
  }
}

/**
 * @typedef {object} Change
 * @property {'bookmark' | 'readingList'} source
 * @property {string} id
 * @property {string} url     the URL seen during the scan
 * @property {string} [newUrl] for updates
 *
 * @typedef {{ updated: number, removed: number, failures: { item: Change, error: unknown }[] }} ApplyReport
 */

/**
 * @param {{ updates: Change[], removals: Change[] }} changes
 * @returns {Promise<ApplyReport>}
 */
export async function applyChanges({ updates, removals }) {
  /** @type {ApplyReport} */
  const report = { updated: 0, removed: 0, failures: [] };

  for (const item of updates) {
    try {
      await (item.source === 'readingList' ? updateReadingListEntry(item) : updateBookmark(item));
      report.updated += 1;
    } catch (error) {
      report.failures.push({ item, error });
    }
  }

  for (const item of removals) {
    try {
      await (item.source === 'readingList' ? removeReadingListEntry(item) : removeBookmark(item));
      report.removed += 1;
    } catch (error) {
      report.failures.push({ item, error });
    }
  }

  return report;
}

/** @param {Change} item */
async function updateBookmark(item) {
  const url = webUrl(item.newUrl);
  await assertBookmarkUnchanged(item);
  await chrome.bookmarks.update(item.id, { url });
}

/** @param {Change} item */
async function removeBookmark(item) {
  await assertBookmarkUnchanged(item);
  await chrome.bookmarks.remove(item.id);
}

/** @param {Change} item */
async function assertBookmarkUnchanged(item) {
  let nodes;
  try {
    nodes = await chrome.bookmarks.get(item.id);
  } catch {
    throw new StaleItemError(); // the bookmark was deleted
  }
  if (nodes[0]?.url !== item.url) throw new StaleItemError();
}

// Reading-list entries are identified by their URL, so "updating" one means adding
// the new address (keeping title and read state) and removing the old one.
/** @param {Change} item */
async function updateReadingListEntry(item) {
  const url = webUrl(item.newUrl);
  const entry = await findReadingListEntry(item.url);
  if (!entry) throw new StaleItemError();
  if (!(await findReadingListEntry(url))) {
    await chrome.readingList.addEntry({ url, title: entry.title, hasBeenRead: entry.hasBeenRead });
  }
  await chrome.readingList.removeEntry({ url: item.url });
}

/** @param {Change} item */
async function removeReadingListEntry(item) {
  if (!(await findReadingListEntry(item.url))) throw new StaleItemError();
  await chrome.readingList.removeEntry({ url: item.url });
}

/** @param {string} url */
async function findReadingListEntry(url) {
  const entries = await chrome.readingList.query({ url });
  return entries.find((entry) => entry.url === url) ?? null;
}

/**
 * Defence in depth: never write anything but an http(s) address into the user's data.
 * @param {string | undefined} url
 */
function webUrl(url) {
  const parsed = parseHttpUrl(url);
  if (!parsed) throw new TypeError(`Refusing to save a non-web address: ${url}`);
  return parsed.href;
}
