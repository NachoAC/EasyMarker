// Gathers every checkable link from the bookmarks tree and the reading list.

import { toRequestUrl } from './url-utils.js';

/**
 * @typedef {object} Link
 * @property {'bookmark' | 'readingList'} source
 * @property {string} id       bookmark id, or the URL for reading-list entries
 * @property {string} title
 * @property {string} url      exactly as stored (used to detect changes before applying)
 * @property {string} requestUrl normalised URL without #fragment (what gets checked)
 * @property {string[]} path   folder names from the root, empty for the reading list
 *
 * @typedef {object} Inventory
 * @property {Link[]} links
 * @property {number} bookmarkCount  bookmarks of any kind
 * @property {number | null} readingListCount null when the browser has no reading list API
 * @property {number} skipped  entries that can't be checked (non-web links, managed bookmarks)
 */

/** @returns {Promise<Inventory>} */
export async function collectLinks() {
  const tree = await chrome.bookmarks.getTree();
  const bookmarks = flattenBookmarks(tree);
  const readingList = chrome.readingList ? flattenReadingList(await chrome.readingList.query({})) : null;

  return {
    links: [...bookmarks.links, ...(readingList?.links ?? [])],
    bookmarkCount: bookmarks.count,
    readingListCount: readingList?.count ?? null,
    skipped: bookmarks.skipped + (readingList?.skipped ?? 0),
  };
}

/**
 * Pure: flattens a `chrome.bookmarks.getTree()` result.
 * @param {chrome.bookmarks.BookmarkTreeNode[]} tree
 */
export function flattenBookmarks(tree) {
  /** @type {Link[]} */
  const links = [];
  let count = 0;
  let skipped = 0;

  /** @param {chrome.bookmarks.BookmarkTreeNode} node @param {string[]} path */
  const visit = (node, path) => {
    if (node.url === undefined) {
      const childPath = node.title ? [...path, node.title] : path;
      for (const child of node.children ?? []) visit(child, childPath);
      return;
    }

    count += 1;
    const requestUrl = toRequestUrl(node.url);
    // Managed bookmarks are set by an administrator and can't be edited.
    if (!requestUrl || node.unmodifiable) {
      skipped += 1;
      return;
    }
    links.push({ source: 'bookmark', id: node.id, title: node.title, url: node.url, requestUrl, path });
  };

  for (const root of tree) visit(root, []);
  return { links, count, skipped };
}

/**
 * Pure: maps `chrome.readingList.query({})` entries to links.
 * @param {chrome.readingList.ReadingListEntry[]} entries
 */
export function flattenReadingList(entries) {
  /** @type {Link[]} */
  const links = [];
  let skipped = 0;
  for (const entry of entries) {
    const requestUrl = toRequestUrl(entry.url);
    if (!requestUrl) {
      skipped += 1;
      continue;
    }
    links.push({ source: 'readingList', id: entry.url, title: entry.title, url: entry.url, requestUrl, path: [] });
  }
  return { links, count: entries.length, skipped };
}
