import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { faviconTargets } from '../../extension/js/favicons.js';

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
