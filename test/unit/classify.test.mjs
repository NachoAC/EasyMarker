import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Reason, Verdict, classify, isHtml, isRetryableError } from '../../extension/js/classify.js';

const URL_A = 'http://example.com/docs/page';

const response = (status, finalUrl = URL_A, hops = [], contentType = null) => ({
  type: 'response',
  status,
  finalUrl,
  hops,
  contentType,
});
const hop = (from, to, statusCode) => ({ from, to, statusCode });
const error = (code) => ({ type: 'error', error: code });

describe('classify: reachable links', () => {
  it('keeps a link that answers 200 without redirects', () => {
    assert.deepEqual(classify(URL_A, response(200)), {
      verdict: Verdict.OK,
      reason: Reason.OK,
      status: 200,
      newUrl: null,
      suggested: false,
      isPage: false,
    });
  });

  it('keeps links that exist but need a login or throttle us', () => {
    for (const status of [401, 403, 429]) {
      const result = classify(URL_A, response(status));
      assert.equal(result.verdict, Verdict.OK, `status ${status}`);
      assert.equal(result.reason, Reason.RESTRICTED);
    }
  });

  it('ignores the fragment of the final URL', () => {
    assert.equal(classify(URL_A, response(200, `${URL_A}#top`)).verdict, Verdict.OK);
  });

  it('treats a redirect that comes back to the same URL as OK', () => {
    const hops = [hop(URL_A, `${URL_A}?set-cookie=1`, 302), hop(`${URL_A}?set-cookie=1`, URL_A, 302)];
    assert.equal(classify(URL_A, response(200, URL_A, hops)).verdict, Verdict.OK);
  });
});

describe('classify: moved links', () => {
  it('suggests the target of a 301', () => {
    const target = 'https://example.com/docs/new-page';
    const result = classify(URL_A, response(200, target, [hop(URL_A, target, 301)]));
    assert.deepEqual(result, {
      verdict: Verdict.UPDATE,
      reason: Reason.PERMANENT,
      status: 301,
      newUrl: target,
      suggested: true,
      isPage: false,
    });
  });

  it('suggests the target of a 308', () => {
    const target = 'http://other.example/page';
    const result = classify(URL_A, response(200, target, [hop(URL_A, target, 308)]));
    assert.equal(result.reason, Reason.PERMANENT);
    assert.equal(result.suggested, true);
  });

  it('proposes temporary redirects without pre-selecting them', () => {
    for (const status of [302, 303, 307]) {
      const target = 'http://example.com/login';
      const result = classify(URL_A, response(200, target, [hop(URL_A, target, status)]));
      assert.equal(result.verdict, Verdict.UPDATE, `status ${status}`);
      assert.equal(result.reason, Reason.TEMPORARY);
      assert.equal(result.newUrl, target);
      assert.equal(result.suggested, false);
    }
  });

  it('follows only the permanent part of a mixed chain', () => {
    const moved = 'http://example.com/docs/moved';
    const login = 'http://example.com/login?next=/docs/moved';
    const hops = [hop(URL_A, moved, 301), hop(moved, login, 302)];
    const result = classify(URL_A, response(200, login, hops));
    assert.equal(result.newUrl, moved);
    assert.equal(result.reason, Reason.PERMANENT);
    assert.equal(result.suggested, true);
  });

  it('follows consecutive permanent redirects to the end', () => {
    const b = 'https://example.com/docs/page';
    const c = 'https://www.example.com/docs/page';
    const result = classify(URL_A, response(200, c, [hop(URL_A, b, 301), hop(b, c, 301)]));
    assert.equal(result.newUrl, c);
    assert.equal(result.suggested, true);
  });

  it('labels a pure http→https upgrade, even when Chrome reports it as an internal 307 (HSTS)', () => {
    const secure = 'https://example.com/docs/page';
    const result = classify(URL_A, response(200, secure, [hop(URL_A, secure, 307)]));
    assert.equal(result.reason, Reason.HTTPS);
    assert.equal(result.newUrl, secure);
    assert.equal(result.suggested, true);
  });

  it('keeps a temporary redirect to another port unselected, even when it switches to https', () => {
    const from = 'http://example.com:8080/report';
    const to = 'https://example.com/report';
    const result = classify(from, response(200, to, [hop(from, to, 302)]));
    assert.equal(result.reason, Reason.TEMPORARY);
    assert.equal(result.suggested, false);
  });

  it('does not pre-select a deep link that now lands on the homepage', () => {
    const home = 'https://example.com/';
    const result = classify(URL_A, response(200, home, [hop(URL_A, home, 301)]));
    assert.equal(result.verdict, Verdict.UPDATE);
    assert.equal(result.reason, Reason.HOMEPAGE);
    assert.equal(result.suggested, false);
  });

  it('pre-selects a homepage that moved to another homepage', () => {
    const result = classify('http://old.example/', response(200, 'https://new.example/', [
      hop('http://old.example/', 'https://new.example/', 301),
    ]));
    assert.equal(result.reason, Reason.PERMANENT);
    assert.equal(result.suggested, true);
  });

  it('falls back to an unselected proposal when the redirect chain was not observed', () => {
    const result = classify(URL_A, response(200, 'https://example.com/elsewhere', null));
    assert.equal(result.verdict, Verdict.UPDATE);
    assert.equal(result.reason, Reason.TEMPORARY);
    assert.equal(result.status, null);
    assert.equal(result.suggested, false);
  });
});

describe('classify: broken links', () => {
  it('pre-selects 404 and 410 for removal', () => {
    assert.deepEqual(classify(URL_A, response(404)), {
      verdict: Verdict.REMOVE,
      reason: Reason.NOT_FOUND,
      status: 404,
      newUrl: null,
      suggested: true,
      isPage: false,
    });
    assert.equal(classify(URL_A, response(410)).reason, Reason.GONE);
    assert.equal(classify(URL_A, response(410)).suggested, true);
  });

  it('reports a redirect that ends in a 404 as broken', () => {
    const target = 'http://example.com/new';
    const result = classify(URL_A, response(404, target, [hop(URL_A, target, 301)]));
    assert.equal(result.verdict, Verdict.REMOVE);
    assert.equal(result.reason, Reason.NOT_FOUND);
  });

  it('proposes server errors and odd 4xx without pre-selecting them', () => {
    assert.equal(classify(URL_A, response(503)).reason, Reason.SERVER);
    assert.equal(classify(URL_A, response(503)).suggested, false);
    assert.equal(classify(URL_A, response(400)).reason, Reason.CLIENT);
    assert.equal(classify(URL_A, response(400)).suggested, false);
  });

  it('pre-selects domains that no longer resolve', () => {
    const result = classify(URL_A, error('net::ERR_NAME_NOT_RESOLVED'));
    assert.equal(result.verdict, Verdict.REMOVE);
    assert.equal(result.reason, Reason.DNS);
    assert.equal(result.suggested, true);
  });

  it('maps network errors to unselected removal proposals', () => {
    const cases = {
      timeout: Reason.TIMEOUT,
      'net::ERR_CONNECTION_TIMED_OUT': Reason.TIMEOUT,
      'net::ERR_CONNECTION_REFUSED': Reason.CONNECTION,
      'net::ERR_CERT_DATE_INVALID': Reason.TLS,
      'net::ERR_SSL_PROTOCOL_ERROR': Reason.TLS,
      'net::ERR_TOO_MANY_REDIRECTS': Reason.REDIRECT_LOOP,
      'net::ERR_HTTP2_PROTOCOL_ERROR': Reason.NETWORK,
    };
    for (const [code, reason] of Object.entries(cases)) {
      const result = classify(URL_A, error(code));
      assert.equal(result.verdict, Verdict.REMOVE, code);
      assert.equal(result.reason, reason, code);
      assert.equal(result.suggested, false, code);
    }
  });

  it('does not judge links it could not check from this machine', () => {
    for (const code of ['net::ERR_INTERNET_DISCONNECTED', 'net::ERR_BLOCKED_BY_CLIENT', 'net::ERR_PROXY_CONNECTION_FAILED', 'net::ERR_UNSAFE_PORT']) {
      assert.equal(classify(URL_A, error(code)).verdict, Verdict.UNCHECKED, code);
    }
    assert.equal(classify(URL_A, error('net::ERR_INTERNET_DISCONNECTED')).reason, Reason.OFFLINE);
  });
});

describe('isPage', () => {
  it('is true when the link ends on an HTML page', () => {
    const target = 'https://example.com/docs/new-page';
    const result = classify(URL_A, response(200, target, [hop(URL_A, target, 301)], 'text/html; charset=utf-8'));
    assert.equal(result.isPage, true);
  });

  it('is false for files, unknown types and errors', () => {
    assert.equal(classify(URL_A, response(200, URL_A, [], 'application/pdf')).isPage, false);
    assert.equal(classify(URL_A, response(200, URL_A, [], null)).isPage, false);
    assert.equal(classify(URL_A, error('net::ERR_NAME_NOT_RESOLVED')).isPage, false);
  });
});

describe('isHtml', () => {
  it('recognises HTML content types only', () => {
    assert.equal(isHtml('text/html'), true);
    assert.equal(isHtml('Text/HTML; charset=UTF-8'), true);
    assert.equal(isHtml('application/xhtml+xml'), true);
    for (const type of ['application/pdf', 'application/zip', 'text/plain', 'image/png', '', null, undefined]) {
      assert.equal(isHtml(type), false, String(type));
    }
  });
});

describe('isRetryableError', () => {
  it('retries transient network failures only', () => {
    assert.equal(isRetryableError('net::ERR_NAME_NOT_RESOLVED'), true);
    assert.equal(isRetryableError('net::ERR_CONNECTION_RESET'), true);
    assert.equal(isRetryableError('net::ERR_NETWORK_CHANGED'), true);
    assert.equal(isRetryableError('timeout'), false);
    assert.equal(isRetryableError('net::ERR_CERT_AUTHORITY_INVALID'), false);
    assert.equal(isRetryableError('net::ERR_BLOCKED_BY_CLIENT'), false);
  });
});
