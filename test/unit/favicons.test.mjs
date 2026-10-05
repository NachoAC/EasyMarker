import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { faviconTargets, isolationRules } from '../../extension/js/favicons.js';

describe('faviconTargets', () => {
  it('opens each updated web page once, with its fragment', () => {
    assert.deepEqual(
      faviconTargets([
        { newUrl: 'https://example.com/guide#install', isPage: true },
        { newUrl: 'https://example.com/guide#install', isPage: true }, // same address in two folders
        { newUrl: 'https://example.com/guide', isPage: true },
      ]),
      ['https://example.com/guide#install', 'https://example.com/guide'],
    );
  });

  it('never opens files or downloads', () => {
    assert.deepEqual(
      faviconTargets([
        { newUrl: 'https://example.com/manual.pdf', isPage: false },
        { newUrl: 'https://example.com/setup.zip', isPage: false },
        { newUrl: null, isPage: true },
      ]),
      [],
    );
  });
});

describe('isolationRules', () => {
  const [block, headers] = isolationRules(42, 7);

  it('applies only to the given tab, with consecutive rule ids', () => {
    assert.deepEqual([block.id, headers.id], [7, 8]);
    for (const rule of [block, headers]) assert.deepEqual(rule.condition.tabIds, [42]);
  });

  it('loads nothing but the page and its images', () => {
    assert.equal(block.action.type, 'block');
    for (const type of ['script', 'stylesheet', 'font', 'sub_frame', 'media', 'xmlhttprequest', 'websocket', 'object']) {
      assert.ok(block.condition.resourceTypes.includes(type), type);
    }
    for (const type of ['main_frame', 'image']) assert.ok(!block.condition.resourceTypes.includes(type), type);
  });

  it('keeps the visit anonymous, including the page itself', () => {
    // Rules without explicit resource types skip main_frame: it must be listed.
    assert.ok(headers.condition.resourceTypes.includes('main_frame'));
    assert.ok(headers.condition.resourceTypes.includes('image'));
    assert.deepEqual(headers.action.requestHeaders, [{ header: 'cookie', operation: 'remove' }]);
    const responseHeaders = Object.fromEntries(headers.action.responseHeaders.map((h) => [h.header, h]));
    assert.equal(responseHeaders['set-cookie'].operation, 'remove');
    assert.equal(responseHeaders['content-disposition'].operation, 'remove');
  });

  it('makes the page inert with a sandbox CSP that still allows the icon', () => {
    const csp = headers.action.responseHeaders.find((h) => h.header === 'content-security-policy');
    assert.equal(csp.operation, 'append');
    const directives = csp.value.split(';').map((d) => d.trim());
    assert.ok(directives.includes('sandbox'), 'no scripts, forms, popups or downloads');
    assert.ok(directives.includes("default-src 'none'"));
    assert.ok(directives.some((d) => d.startsWith('img-src')), 'images (the icon) stay allowed');
  });
});
