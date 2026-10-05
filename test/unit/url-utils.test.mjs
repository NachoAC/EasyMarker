import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  carryFragment,
  hostOf,
  isHomepage,
  isHttpsUpgrade,
  parseHttpUrl,
  toRequestUrl,
} from '../../extension/js/url-utils.js';

describe('parseHttpUrl', () => {
  it('accepts http and https only', () => {
    assert.ok(parseHttpUrl('http://example.com'));
    assert.ok(parseHttpUrl('https://example.com/a?b#c'));
    for (const raw of ['javascript:alert(1)', 'chrome://settings', 'file:///etc/passwd', 'data:text/html,hi', 'ftp://x', 'not a url', '', null, undefined, 42]) {
      assert.equal(parseHttpUrl(raw), null, String(raw));
    }
  });
});

describe('toRequestUrl', () => {
  it('normalises and drops the fragment', () => {
    assert.equal(toRequestUrl('HTTP://Example.COM/a b#section'), 'http://example.com/a%20b');
    assert.equal(toRequestUrl('https://example.com'), 'https://example.com/');
  });

  it('returns null for non-web links', () => {
    assert.equal(toRequestUrl('javascript:void(0)'), null);
  });
});

describe('carryFragment', () => {
  it('keeps the bookmark fragment when the target has none', () => {
    assert.equal(carryFragment('https://new.example/page', 'http://old.example/page#install'), 'https://new.example/page#install');
  });

  it('prefers the target fragment', () => {
    assert.equal(carryFragment('https://new.example/page#b', 'http://old.example/page#a'), 'https://new.example/page#b');
  });

  it('leaves URLs without fragments alone', () => {
    assert.equal(carryFragment('https://new.example/page', 'http://old.example/page'), 'https://new.example/page');
  });
});

describe('isHttpsUpgrade', () => {
  it('detects the same address moving to https', () => {
    assert.equal(isHttpsUpgrade('http://example.com/a?b=1', 'https://example.com/a?b=1'), true);
    assert.equal(isHttpsUpgrade('http://example.com:80/a', 'https://example.com:443/a'), true);
    assert.equal(isHttpsUpgrade('http://example.com:8080/a', 'https://example.com:8080/a'), true);
  });

  it('rejects any other change', () => {
    assert.equal(isHttpsUpgrade('http://example.com/a', 'https://www.example.com/a'), false);
    assert.equal(isHttpsUpgrade('http://example.com/a', 'https://example.com/b'), false);
    assert.equal(isHttpsUpgrade('https://example.com/a', 'http://example.com/a'), false);
  });

  it('rejects a change of port, which may be a different service', () => {
    assert.equal(isHttpsUpgrade('http://example.com:8080/report', 'https://example.com/report'), false);
    assert.equal(isHttpsUpgrade('http://example.com/report', 'https://example.com:8443/report'), false);
  });
});

describe('isHomepage', () => {
  it('matches the root without a query string', () => {
    assert.equal(isHomepage('https://example.com/'), true);
    assert.equal(isHomepage('https://example.com/?p=1'), false);
    assert.equal(isHomepage('https://example.com/blog'), false);
  });
});

describe('hostOf', () => {
  it('returns the hostname, or an empty string', () => {
    assert.equal(hostOf('https://sub.example.com:8080/x'), 'sub.example.com');
    assert.equal(hostOf('nope'), '');
  });
});
