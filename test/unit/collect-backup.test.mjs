import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildBookmarksHtml } from '../../extension/js/backup.js';
import { flattenBookmarks, flattenReadingList } from '../../extension/js/collect.js';

// Shape of chrome.bookmarks.getTree()
const TREE = [
  {
    id: '0',
    title: '',
    children: [
      {
        id: '1',
        title: 'Bookmarks bar',
        folderType: 'bookmarks-bar',
        dateAdded: 1_700_000_000_000,
        children: [
          { id: '10', title: 'Docs', url: 'https://example.com/docs#intro', dateAdded: 1_700_000_001_000 },
          { id: '11', title: 'Bookmarklet', url: 'javascript:alert(1)' },
          {
            id: '12',
            title: 'Dev',
            children: [{ id: '13', title: '<b>"Tricky" & \'odd\'</b>', url: 'http://example.org/?a=1&b=2' }],
          },
        ],
      },
      { id: '2', title: 'Other bookmarks', folderType: 'other', children: [] },
      {
        id: '4',
        title: 'Managed',
        folderType: 'managed',
        unmodifiable: 'managed',
        children: [{ id: '40', title: 'Intranet', url: 'https://intranet.example/', unmodifiable: 'managed' }],
      },
    ],
  },
];

describe('flattenBookmarks', () => {
  it('collects web bookmarks with their folder path', () => {
    const { links, count, skipped } = flattenBookmarks(TREE);
    assert.equal(count, 4);
    assert.equal(skipped, 2); // the bookmarklet and the managed bookmark
    assert.deepEqual(
      links.map((link) => [link.id, link.requestUrl, link.path.join('/')]),
      [
        ['10', 'https://example.com/docs', 'Bookmarks bar'],
        ['13', 'http://example.org/?a=1&b=2', 'Bookmarks bar/Dev'],
      ],
    );
    assert.equal(links[0].url, 'https://example.com/docs#intro', 'keeps the stored URL untouched');
    assert.equal(links[0].source, 'bookmark');
  });
});

describe('flattenReadingList', () => {
  it('uses the URL as id and skips non-web entries', () => {
    const { links, count, skipped } = flattenReadingList([
      { url: 'https://news.example/a', title: 'A', hasBeenRead: false },
      { url: 'chrome://flags', title: 'Flags', hasBeenRead: true },
    ]);
    assert.equal(count, 2);
    assert.equal(skipped, 1);
    assert.deepEqual(links, [
      { source: 'readingList', id: 'https://news.example/a', title: 'A', url: 'https://news.example/a', requestUrl: 'https://news.example/a', path: [] },
    ]);
  });
});

describe('buildBookmarksHtml', () => {
  const html = buildBookmarksHtml(TREE, [{ url: 'https://news.example/a?x=<y>', title: 'Read <me>', creationTime: 1_700_000_002_000 }], {
    readingListTitle: 'Reading list',
  });

  it('writes a Netscape bookmark file', () => {
    assert.match(html, /^<!DOCTYPE NETSCAPE-Bookmark-file-1>\n/);
    assert.match(html, /<H3 ADD_DATE="1700000000" LAST_MODIFIED="0" PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar<\/H3>/);
    assert.match(html, /<A HREF="https:\/\/example.com\/docs#intro" ADD_DATE="1700000001">Docs<\/A>/);
    assert.match(html, /<H3>Reading list<\/H3>/);
  });

  it('escapes titles and URLs', () => {
    assert.ok(html.includes('&lt;b&gt;&quot;Tricky&quot; &amp; &#39;odd&#39;&lt;/b&gt;'));
    assert.ok(html.includes('HREF="http://example.org/?a=1&amp;b=2"'));
    assert.ok(html.includes('HREF="https://news.example/a?x=&lt;y&gt;"'));
    assert.ok(!html.includes('<b>'));
    assert.ok(!html.includes('<me>'));
  });

  it('balances every folder', () => {
    const opened = html.match(/<DL><p>/g).length;
    const closed = html.match(/<\/DL><p>/g).length;
    assert.equal(opened, closed);
  });
});
