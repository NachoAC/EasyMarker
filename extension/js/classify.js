// Turns the outcome of checking one URL into a proposal for the user.
// Pure module: no `chrome.*`, unit-tested in Node.

import { isHomepage, isHttpsUpgrade, stripFragment } from './url-utils.js';

/** What EasyMarker proposes to do with a link. */
export const Verdict = Object.freeze({
  OK: 'ok', // leave it alone
  UPDATE: 'update', // the link moved: propose the new address
  REMOVE: 'remove', // the link is broken: propose removing it
  UNCHECKED: 'unchecked', // could not be checked from here (offline, blocked locally…)
});

/** Why. The UI maps every reason to a localised label (`reason_<value>` messages). */
export const Reason = Object.freeze({
  OK: 'ok',
  RESTRICTED: 'restricted', // 401/403/429…: exists, but needs a login or throttles us
  PERMANENT: 'permanent', // 301/308
  HTTPS: 'https', // same address, now served over https
  TEMPORARY: 'temporary', // 302/303/307: may be a login wall or geo redirect
  HOMEPAGE: 'homepage', // a deep link that now lands on the front page: content likely gone
  NOT_FOUND: 'notFound', // 404
  GONE: 'gone', // 410
  DNS: 'dns', // the domain no longer resolves
  SERVER: 'server', // 5xx
  CLIENT: 'client', // other 4xx
  TIMEOUT: 'timeout',
  CONNECTION: 'connection',
  TLS: 'tls',
  REDIRECT_LOOP: 'redirectLoop',
  NETWORK: 'network',
  OFFLINE: 'offline',
  BLOCKED: 'blocked', // blocked on this machine (proxy, policy, unsafe port…)
});

const PERMANENT_REDIRECTS = new Set([301, 308]);

// The resource exists; the server just won't hand it to an anonymous request.
const RESTRICTED_STATUSES = new Set([401, 402, 403, 407, 429, 451]);

const TIMEOUT_ERRORS = new Set(['timeout', 'net::ERR_TIMED_OUT', 'net::ERR_CONNECTION_TIMED_OUT']);

const CONNECTION_ERRORS = new Set([
  'net::ERR_CONNECTION_REFUSED',
  'net::ERR_CONNECTION_RESET',
  'net::ERR_CONNECTION_CLOSED',
  'net::ERR_CONNECTION_FAILED',
  'net::ERR_ADDRESS_UNREACHABLE',
  'net::ERR_ADDRESS_INVALID',
  'net::ERR_EMPTY_RESPONSE',
]);

// Problems on this machine, not with the link: we can't tell whether it works.
const LOCAL_ERRORS = new Set([
  'net::ERR_BLOCKED_BY_CLIENT',
  'net::ERR_BLOCKED_BY_ADMINISTRATOR',
  'net::ERR_ACCESS_DENIED',
  'net::ERR_NETWORK_ACCESS_DENIED',
  'net::ERR_UNSAFE_PORT',
]);

/**
 * @typedef {{ from: string, to: string, statusCode: number }} Hop
 *
 * @typedef {(
 *   | { type: 'response', status: number, finalUrl: string, contentType?: string | null, hops: Hop[] | null }
 *   | { type: 'error', error: string }
 * )} Outcome
 * `hops` is null when the redirect chain could not be observed.
 *
 * @typedef {{
 *   verdict: string,
 *   reason: string,
 *   status: number | null,
 *   newUrl: string | null,
 *   suggested: boolean,
 *   isPage: boolean,
 * }} CheckResult
 * `suggested` means "pre-select this change in the review screen".
 * `isPage` means the link ends on an HTML page (not a PDF, a download…).
 */

/**
 * @param {string} requestUrl the URL that was requested (normalised, no fragment)
 * @param {Outcome} outcome
 * @returns {CheckResult}
 */
export function classify(requestUrl, outcome) {
  if (outcome.type === 'error') return { ...classifyError(outcome.error), isPage: false };
  return { ...classifyResponse(requestUrl, outcome), isPage: isHtml(outcome.contentType) };
}

/** @param {string | null | undefined} contentType */
export function isHtml(contentType) {
  const type = contentType?.split(';')[0].trim().toLowerCase();
  return type === 'text/html' || type === 'application/xhtml+xml';
}

/**
 * @param {string} requestUrl
 * @param {Extract<Outcome, { type: 'response' }>} outcome
 * @returns {Omit<CheckResult, 'isPage'>}
 */
function classifyResponse(requestUrl, outcome) {
  const { status } = outcome;
  if (status === 404) return result(Verdict.REMOVE, Reason.NOT_FOUND, status, true);
  if (status === 410) return result(Verdict.REMOVE, Reason.GONE, status, true);
  if (status >= 500) return result(Verdict.REMOVE, Reason.SERVER, status, false);
  if (status >= 400 && !RESTRICTED_STATUSES.has(status)) {
    return result(Verdict.REMOVE, Reason.CLIENT, status, false);
  }
  return classifyReachable(requestUrl, outcome);
}

/** @param {string} error a Chrome `net::ERR_*` code, or 'timeout' */
export function isRetryableError(error) {
  const reason = errorReason(error);
  return reason === Reason.DNS || reason === Reason.CONNECTION || reason === Reason.NETWORK;
}

/**
 * @param {string} requestUrl
 * @param {{ status: number, finalUrl: string, hops: Hop[] | null }} outcome
 * @returns {Omit<CheckResult, 'isPage'>}
 */
function classifyReachable(requestUrl, { status, finalUrl, hops }) {
  const finalRequestUrl = stripFragment(finalUrl);
  if (finalRequestUrl === requestUrl) {
    const reason = RESTRICTED_STATUSES.has(status) ? Reason.RESTRICTED : Reason.OK;
    return result(Verdict.OK, reason, status, false);
  }

  const redirectStatus = hops?.[0]?.statusCode ?? null;
  const permanent = permanentTarget(requestUrl, hops);

  let reason;
  let newUrl;
  let suggested;
  if (permanent) {
    // Follow only the permanent part of the chain: in `A -301-> B -302-> /login`
    // the bookmark should become B, which still sends you to the login when needed.
    newUrl = permanent;
    reason = isHttpsUpgrade(requestUrl, permanent) ? Reason.HTTPS : Reason.PERMANENT;
    suggested = true;
  } else {
    newUrl = finalRequestUrl;
    reason = Reason.TEMPORARY;
    suggested = false;
  }

  if (!isHomepage(requestUrl) && isHomepage(newUrl)) {
    reason = Reason.HOMEPAGE;
    suggested = false;
  }

  return result(Verdict.UPDATE, reason, redirectStatus, suggested, newUrl);
}

/**
 * The address reached by following only the leading permanent redirects, or null.
 * @param {string} requestUrl
 * @param {Hop[] | null} hops
 */
function permanentTarget(requestUrl, hops) {
  if (!hops) return null;
  let target = null;
  for (const hop of hops) {
    const permanent = PERMANENT_REDIRECTS.has(hop.statusCode) || isHttpsUpgrade(hop.from, hop.to);
    if (!permanent) break;
    target = hop.to;
  }
  if (target === null) return null;
  target = stripFragment(target);
  return target === requestUrl ? null : target;
}

/**
 * @param {string} error
 * @returns {Omit<CheckResult, 'isPage'>}
 */
function classifyError(error) {
  const reason = errorReason(error);
  switch (reason) {
    case Reason.DNS:
      return result(Verdict.REMOVE, reason, null, true);
    case Reason.OFFLINE:
    case Reason.BLOCKED:
      return result(Verdict.UNCHECKED, reason, null, false);
    default:
      return result(Verdict.REMOVE, reason, null, false);
  }
}

/** @param {string} error */
function errorReason(error) {
  if (TIMEOUT_ERRORS.has(error)) return Reason.TIMEOUT;
  if (error === 'net::ERR_NAME_NOT_RESOLVED') return Reason.DNS;
  if (error === 'net::ERR_INTERNET_DISCONNECTED') return Reason.OFFLINE;
  if (error === 'net::ERR_TOO_MANY_REDIRECTS') return Reason.REDIRECT_LOOP;
  if (/^net::ERR_.*(CERT|SSL)/.test(error)) return Reason.TLS;
  if (CONNECTION_ERRORS.has(error)) return Reason.CONNECTION;
  if (LOCAL_ERRORS.has(error) || /^net::ERR_(PROXY|TUNNEL)_/.test(error)) return Reason.BLOCKED;
  return Reason.NETWORK;
}

/**
 * @param {string} verdict
 * @param {string} reason
 * @param {number | null} status
 * @param {boolean} suggested
 * @param {string | null} [newUrl]
 * @returns {Omit<CheckResult, 'isPage'>}
 */
function result(verdict, reason, status, suggested, newUrl = null) {
  return { verdict, reason, status, newUrl, suggested };
}
