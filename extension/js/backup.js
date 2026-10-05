// Exports the bookmarks (and the reading list, as an extra folder) to the standard
// "Netscape bookmark file" HTML format that Chrome and every other browser can import.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** @param {unknown} value */
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

/** Bookmark timestamps are milliseconds; the file format uses seconds. */
function seconds(ms) {
  return Math.floor((ms ?? 0) / 1000);
}

/**
 * Pure: builds the backup file.
 * @param {chrome.bookmarks.BookmarkTreeNode[]} tree result of chrome.bookmarks.getTree()
 * @param {chrome.readingList.ReadingListEntry[]} readingList
 * @param {{ readingListTitle: string }} labels
 * @returns {string}
 */
export function buildBookmarksHtml(tree, readingList, { readingListTitle }) {
  const lines = [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<!-- This is an automatically generated file.',
    '     It will be read and overwritten.',
    '     DO NOT EDIT! -->',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>Bookmarks</TITLE>',
    '<H1>Bookmarks</H1>',
    '<DL><p>',
  ];

  const link = (indent, url, title, added) =>
    `${indent}<DT><A HREF="${escapeHtml(url)}" ADD_DATE="${seconds(added)}">${escapeHtml(title)}</A>`;

  const folder = (indent, title, attributes, writeChildren) => {
    lines.push(`${indent}<DT><H3${attributes}>${escapeHtml(title)}</H3>`, `${indent}<DL><p>`);
    writeChildren(`${indent}    `);
    lines.push(`${indent}</DL><p>`);
  };

  /** @param {chrome.bookmarks.BookmarkTreeNode[]} nodes @param {string} indent */
  const writeNodes = (nodes, indent) => {
    for (const node of nodes) {
      if (node.url !== undefined) {
        lines.push(link(indent, node.url, node.title, node.dateAdded));
        continue;
      }
      const isToolbar = node.folderType === 'bookmarks-bar' || (node.folderType === undefined && node.id === '1');
      const attributes =
        ` ADD_DATE="${seconds(node.dateAdded)}" LAST_MODIFIED="${seconds(node.dateGroupModified)}"` +
        (isToolbar ? ' PERSONAL_TOOLBAR_FOLDER="true"' : '');
      folder(indent, node.title, attributes, (inner) => writeNodes(node.children ?? [], inner));
    }
  };

  writeNodes(tree.flatMap((root) => root.children ?? []), '    ');

  if (readingList.length > 0) {
    folder('    ', readingListTitle, '', (inner) => {
      for (const entry of readingList) lines.push(link(inner, entry.url, entry.title, entry.creationTime));
    });
  }

  lines.push('</DL><p>');
  return `${lines.join('\n')}\n`;
}

/**
 * Builds the backup from the live data and hands it to the browser as a download.
 * @param {{ readingListTitle: string }} labels
 */
export async function downloadBackup(labels) {
  const tree = await chrome.bookmarks.getTree();
  const readingList = chrome.readingList ? await chrome.readingList.query({}) : [];
  const html = buildBookmarksHtml(tree, readingList, labels);

  const date = new Date().toISOString().slice(0, 10);
  const href = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = `easymarker-backup-${date}.html`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
}
