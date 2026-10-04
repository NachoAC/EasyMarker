// Pure URL helpers. They never touch `chrome.*`, so they can be unit-tested in Node.

const WEB_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Parses a web link. Anything that is not http(s) — bookmarklets (javascript:),
 * chrome://, file://, data: … — returns null: those can't be checked and must never be
 * written into a bookmark by this extension.
 * @param {unknown} raw
 * @returns {URL | null}
 */
export function parseHttpUrl(raw) {
  if (typeof raw !== 'string') return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  return WEB_PROTOCOLS.has(url.protocol) ? url : null;
}

/**
 * The URL exactly as the browser puts it on the wire: normalised by the URL parser and
 * without the #fragment (fragments are never sent to the server).
 * @param {string} raw
 * @returns {string | null}
 */
export function toRequestUrl(raw) {
  const url = parseHttpUrl(raw);
  if (!url) return null;
  url.hash = '';
  return url.href;
}

/** @param {string} raw */
export function stripFragment(raw) {
  const url = new URL(raw);
  url.hash = '';
  return url.href;
}

/**
 * Browsers keep the original #fragment when a redirect target has none of its own,
 * so a bookmark to `/old#install` that moved to `/new` should become `/new#install`.
 * @param {string} target
 * @param {string} original
 */
export function carryFragment(target, original) {
  const targetUrl = new URL(target);
  const originalUrl = new URL(original);
  if (!targetUrl.hash && originalUrl.hash) targetUrl.hash = originalUrl.hash;
  return targetUrl.href;
}

/**
 * True when `to` is the same address as `from`, only upgraded from http to https.
 * Chrome performs HSTS upgrades as an internal 307, which would otherwise look temporary.
 * The port must match too (`URL.port` is '' for each scheme's default): a non-default
 * port may be a different service, and HSTS keeps non-default ports as they are.
 * @param {string} from
 * @param {string} to
 */
export function isHttpsUpgrade(from, to) {
  const a = new URL(from);
  const b = new URL(to);
  return (
    a.protocol === 'http:' &&
    b.protocol === 'https:' &&
    a.hostname === b.hostname &&
    a.port === b.port &&
    a.pathname === b.pathname &&
    a.search === b.search
  );
}

/** True for a site's front page (`https://example.com/`). @param {string} raw */
export function isHomepage(raw) {
  const url = new URL(raw);
  return url.pathname === '/' && url.search === '';
}

/** @param {string} raw */
export function hostOf(raw) {
  try {
    return new URL(raw).hostname;
  } catch {
    return '';
  }
}
