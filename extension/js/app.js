// UI controller for app.html: start → scan → review → done.
// All user-provided text (titles, URLs) is rendered with textContent, never as HTML.

import { applyChanges, StaleItemError } from './apply.js';
import { downloadBackup } from './backup.js';
import { scanLinks } from './checker.js';
import { Reason, Verdict } from './classify.js';
import { collectLinks } from './collect.js';
import { faviconTargets, refreshFavicons } from './favicons.js';
import { formatNumber, localizeDocument, t } from './i18n.js';
import { carryFragment } from './url-utils.js';

// Requested at runtime, on the "Check links" click, instead of at install time.
const HOST_PERMISSIONS = Object.freeze({ origins: ['http://*/*', 'https://*/*'] });
const LISTS = [Verdict.UPDATE, Verdict.REMOVE];
const VIEWS = ['start', 'scan', 'review', 'icons', 'done'];

class OfflineError extends Error {}

/**
 * @typedef {import('./collect.js').Link & {
 *   index: number,
 *   verdict: string,
 *   reason: string,
 *   status: number | null,
 *   newUrl: string | null,
 *   suggested: boolean,
 *   isPage: boolean,
 *   selected: boolean,
 * }} ReviewItem
 *
 * @typedef {{ refreshed: number, total: number } | { unavailable: true }} IconsReport
 */

const state = {
  busy: false,
  /** @type {AbortController | null} */
  scan: null,
  /** @type {AbortController | null} */
  icons: null,
  /** @type {ReviewItem[]} */
  items: [],
};

const $ = (id) => document.getElementById(id);

localizeDocument();
bindEvents();
refreshInventory();

function bindEvents() {
  $('scan-button').addEventListener('click', startScan);
  $('cancel-button').addEventListener('click', () => state.scan?.abort());
  $('skip-icons-button').addEventListener('click', () => state.icons?.abort());
  $('backup-button').addEventListener('click', backup);
  $('confirm-backup').addEventListener('click', backup);
  $('apply-button').addEventListener('click', openConfirm);
  $('confirm-dialog').addEventListener('close', onConfirmClosed);
  $('rescan-button').addEventListener('click', restart);
  $('restart-button').addEventListener('click', restart);

  const tablist = document.querySelector('[role="tablist"]');
  tablist.addEventListener('click', (event) => {
    const tab = event.target.closest('[role="tab"]');
    if (tab) selectTab(tab.id.replace('tab-', ''));
  });
  tablist.addEventListener('keydown', onTabKeydown);

  for (const list of LISTS) {
    $(`select-all-${list}`).addEventListener('change', (event) => setAllSelected(list, event.target.checked));
    $(`rows-${list}`).addEventListener('change', onRowToggled);
  }

  window.addEventListener('beforeunload', (event) => {
    if (state.busy) event.preventDefault();
  });
}

// ---------------------------------------------------------------- start

async function refreshInventory() {
  try {
    const { bookmarkCount, readingListCount } = await collectLinks();
    $('stat-bookmarks').textContent = formatNumber(bookmarkCount);
    $('stat-reading-list').textContent = readingListCount === null ? '—' : formatNumber(readingListCount);
  } catch (error) {
    showNotice(t('errorGeneric', errorMessage(error)));
  }
}

function restart() {
  state.items = [];
  hideNotice();
  showView('start');
  refreshInventory();
}

// ---------------------------------------------------------------- scan

async function startScan() {
  if (state.busy) return;
  // Busy from the first click: a double click while Chrome shows the permission
  // prompt must not start a second scan.
  setBusy(true);
  try {
    await scan();
  } finally {
    state.scan = null;
    setBusy(false);
  }
}

async function scan() {
  hideNotice();
  if (!navigator.onLine) {
    showNotice(t('errorOffline'));
    return;
  }

  let granted;
  try {
    granted = await chrome.permissions.request(HOST_PERMISSIONS);
  } catch (error) {
    showNotice(t('errorGeneric', errorMessage(error)));
    return;
  }
  if (!granted) {
    showNotice(t('errorPermission'));
    return;
  }

  let inventory;
  try {
    inventory = await collectLinks();
  } catch (error) {
    showNotice(t('errorGeneric', errorMessage(error)));
    return;
  }
  if (inventory.links.length === 0) {
    showNotice(t('errorNothingToCheck'), 'info');
    return;
  }

  const controller = new AbortController();
  const progress = { done: 0, total: new Set(inventory.links.map((link) => link.requestUrl)).size };
  const tally = { [Verdict.OK]: 0, [Verdict.UPDATE]: 0, [Verdict.REMOVE]: 0, [Verdict.UNCHECKED]: 0 };
  /** @type {ReviewItem[]} */
  const items = [];
  const renderSoon = throttleToFrame(() => renderProgress(progress, tally));
  const onOffline = () => controller.abort(new OfflineError());

  state.scan = controller;
  renderProgress(progress, tally);
  showView('scan');
  window.addEventListener('offline', onOffline);

  let failure = null;
  try {
    await scanLinks(inventory.links, {
      signal: controller.signal,
      onResult(result, links) {
        if (result.reason === Reason.OFFLINE) {
          controller.abort(new OfflineError());
          return;
        }
        progress.done += 1;
        tally[result.verdict] += links.length;
        if (result.verdict === Verdict.UPDATE || result.verdict === Verdict.REMOVE) {
          for (const link of links) items.push(toReviewItem(link, result));
        }
        renderSoon();
      },
    });
  } catch (error) {
    failure = error;
  } finally {
    window.removeEventListener('offline', onOffline);
  }

  if (controller.signal.aborted) {
    showView('start');
    if (controller.signal.reason instanceof OfflineError) showNotice(t('errorOffline'));
    else showNotice(t('scanCancelled'), 'info');
    return;
  }
  if (failure) {
    showView('start');
    showNotice(t('errorGeneric', errorMessage(failure)));
    return;
  }

  state.items = sortForReview(items);
  renderReview(tally, inventory.skipped);
}

/**
 * @param {import('./collect.js').Link} link
 * @param {import('./classify.js').CheckResult} result
 * @returns {ReviewItem}
 */
function toReviewItem(link, result) {
  return {
    ...link,
    index: -1,
    verdict: result.verdict,
    reason: result.reason,
    status: result.status,
    newUrl: result.newUrl && carryFragment(result.newUrl, link.url),
    suggested: result.suggested,
    isPage: result.isPage,
    selected: result.suggested,
  };
}

/** Pre-selected first, then grouped by reason, then by title. @param {ReviewItem[]} items */
function sortForReview(items) {
  const collator = new Intl.Collator(chrome.i18n.getUILanguage(), { sensitivity: 'base', numeric: true });
  items.sort(
    (a, b) =>
      Number(b.suggested) - Number(a.suggested) ||
      a.reason.localeCompare(b.reason) ||
      collator.compare(a.title || a.url, b.title || b.url),
  );
  items.forEach((item, index) => {
    item.index = index;
  });
  return items;
}

function renderProgress(progress, tally) {
  setProgressBar('progress', progress.done, progress.total);
  $('progress-text').textContent = t('scanProgress', [formatNumber(progress.done), formatNumber(progress.total)]);
  $('tally-ok').textContent = formatNumber(tally[Verdict.OK]);
  $('tally-update').textContent = formatNumber(tally[Verdict.UPDATE]);
  $('tally-remove').textContent = formatNumber(tally[Verdict.REMOVE]);
}

// ---------------------------------------------------------------- review

function renderReview(tally, skipped) {
  $('review-summary').textContent = t('reviewSummary', [
    formatNumber(tally[Verdict.OK]),
    formatNumber(tally[Verdict.UNCHECKED]),
    formatNumber(skipped),
  ]);

  for (const list of LISTS) {
    const items = state.items.filter((item) => item.verdict === list);
    const fragment = document.createDocumentFragment();
    for (const item of items) fragment.append(renderRow(item));
    $(`rows-${list}`).replaceChildren(fragment);
    $(`count-${list}`).textContent = formatNumber(items.length);
    $(`empty-${list}`).hidden = items.length > 0;
    $(`toolbar-${list}`).hidden = items.length === 0;
  }

  const hasUpdates = state.items.some((item) => item.verdict === Verdict.UPDATE);
  const hasRemovals = state.items.some((item) => item.verdict === Verdict.REMOVE);
  selectTab(!hasUpdates && hasRemovals ? Verdict.REMOVE : Verdict.UPDATE);
  updateSelectionUi();
  showView('review');
}

/** @param {ReviewItem} item */
function renderRow(item) {
  const row = /** @type {HTMLElement} */ ($('row-template').content.firstElementChild.cloneNode(true));
  const checkbox = row.querySelector('.row-check');
  const checkboxId = `item-${item.index}`;
  checkbox.id = checkboxId;
  checkbox.checked = item.selected;
  checkbox.dataset.index = String(item.index);
  row.querySelector('.row-head').htmlFor = checkboxId;
  row.classList.toggle('is-selected', item.selected);

  const fromReadingList = item.source === 'readingList';
  const sourceIcon = row.querySelector('.row-source');
  sourceIcon.querySelector('use').setAttribute('href', fromReadingList ? '#i-reading' : '#i-bookmark');
  sourceIcon.setAttribute('aria-label', t(fromReadingList ? 'readingList' : 'sourceBookmark'));

  row.querySelector('.row-title').textContent = item.title || item.url;
  row.querySelector('.row-path').textContent = fromReadingList ? t('readingList') : item.path.join(' › ');

  const badge = row.querySelector('.badge');
  const label = t(`reason_${item.reason}`);
  badge.textContent = item.status ? `${item.status} · ${label}` : label;
  badge.classList.add(badgeClass(item));

  setLink(row.querySelector('.row-url-old'), item.url);
  const newLink = row.querySelector('.row-url-new');
  if (item.newUrl) setLink(newLink, item.newUrl);
  else newLink.remove();

  return row;
}

/** @param {HTMLAnchorElement} anchor @param {string} url (always http/https: see collect.js) */
function setLink(anchor, url) {
  anchor.href = url;
  anchor.textContent = url;
  anchor.title = url;
}

/** @param {ReviewItem} item */
function badgeClass(item) {
  if (!item.suggested) return 'badge-warn';
  return item.verdict === Verdict.UPDATE ? 'badge-good' : 'badge-bad';
}

function onRowToggled(event) {
  const checkbox = event.target;
  if (!checkbox.classList.contains('row-check')) return;
  const item = state.items[Number(checkbox.dataset.index)];
  item.selected = checkbox.checked;
  checkbox.closest('.row').classList.toggle('is-selected', item.selected);
  updateSelectionUi();
}

function setAllSelected(list, selected) {
  for (const item of state.items) if (item.verdict === list) item.selected = selected;
  for (const checkbox of $(`rows-${list}`).querySelectorAll('.row-check')) {
    checkbox.checked = selected;
    checkbox.closest('.row').classList.toggle('is-selected', selected);
  }
  updateSelectionUi();
}

function updateSelectionUi() {
  const { updates, removals } = selectedChanges();
  const selectedCount = { [Verdict.UPDATE]: updates.length, [Verdict.REMOVE]: removals.length };

  for (const list of LISTS) {
    const total = state.items.filter((item) => item.verdict === list).length;
    const selected = selectedCount[list];
    const selectAll = $(`select-all-${list}`);
    selectAll.checked = total > 0 && selected === total;
    selectAll.indeterminate = selected > 0 && selected < total;
    $(`selected-${list}`).textContent = t('selectedOf', [formatNumber(selected), formatNumber(total)]);
  }

  $('selection-summary').textContent = t('selectionSummary', [
    formatNumber(updates.length),
    formatNumber(removals.length),
  ]);
  updateApplyButton();
}

function selectedChanges() {
  const selected = state.items.filter((item) => item.selected);
  return {
    updates: selected.filter((item) => item.verdict === Verdict.UPDATE),
    removals: selected.filter((item) => item.verdict === Verdict.REMOVE),
  };
}

function selectTab(list, { focus = false } = {}) {
  for (const candidate of LISTS) {
    const tab = $(`tab-${candidate}`);
    const active = candidate === list;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    $(`panel-${candidate}`).hidden = !active;
  }
  if (focus) $(`tab-${list}`).focus();
}

function onTabKeydown(event) {
  const current = LISTS.findIndex((list) => $(`tab-${list}`).getAttribute('aria-selected') === 'true');
  const moves = { ArrowRight: current + 1, ArrowLeft: current - 1, Home: 0, End: LISTS.length - 1 };
  if (!(event.key in moves)) return;
  event.preventDefault();
  const next = (moves[event.key] + LISTS.length) % LISTS.length;
  selectTab(LISTS[next], { focus: true });
}

// ---------------------------------------------------------------- apply

function openConfirm() {
  const { updates, removals } = selectedChanges();
  if (updates.length + removals.length === 0) return;
  $('confirm-updates').textContent = formatNumber(updates.length);
  $('confirm-removals').textContent = formatNumber(removals.length);
  const pages = faviconTargets(updates).length;
  $('confirm-favicons-option').hidden = pages === 0;
  $('confirm-favicons-count').textContent = t('confirmFaviconsCount', formatNumber(pages));
  const dialog = $('confirm-dialog');
  dialog.returnValue = '';
  dialog.showModal();
}

async function onConfirmClosed() {
  if ($('confirm-dialog').returnValue !== 'confirm' || state.busy) return;

  const changes = selectedChanges();
  const wantIcons = !$('confirm-favicons-option').hidden && $('confirm-favicons').checked;
  const applyButton = $('apply-button');
  setBusy(true);
  applyButton.textContent = t('applyingButton');

  let report;
  let icons = null;
  try {
    report = await applyChanges(changes);
    if (wantIcons) {
      const failed = new Set(report.failures.map(({ item }) => item));
      icons = await refreshIcons(faviconTargets(changes.updates.filter((item) => !failed.has(item))));
    }
  } catch (error) {
    showNotice(t('errorGeneric', errorMessage(error)));
    return;
  } finally {
    applyButton.textContent = t('applyButton');
    setBusy(false);
  }

  state.items = [];
  renderDone(report, icons);
}

/**
 * Loads the updated pages so Chrome shows their icons instead of the generic globe.
 * Best effort: a failure here never hides the result of the changes already applied.
 * @param {string[]} urls
 * @returns {Promise<IconsReport | null>}
 */
async function refreshIcons(urls) {
  if (urls.length === 0) return null;
  const controller = new AbortController();
  const render = (done) => {
    setProgressBar('icons-progress', done, urls.length);
    $('icons-progress-text').textContent = t('iconsProgress', [formatNumber(done), formatNumber(urls.length)]);
  };
  state.icons = controller;
  render(0);
  showView('icons');
  try {
    const refreshed = await refreshFavicons(urls, { signal: controller.signal, onProgress: render });
    // null: the visits could not be isolated (no website access), so none was made.
    return refreshed === null ? { unavailable: true } : { refreshed, total: urls.length };
  } catch (error) {
    console.warn('EasyMarker: could not refresh icons', error);
    return null;
  } finally {
    state.icons = null;
  }
}

/**
 * @param {import('./apply.js').ApplyReport} report
 * @param {IconsReport | null} icons
 */
function renderDone(report, icons) {
  $('done-summary').textContent = t('doneSummary', [formatNumber(report.updated), formatNumber(report.removed)]);
  $('done-icons').hidden = icons === null;
  if (icons) {
    $('done-icons').textContent =
      'unavailable' in icons
        ? t('doneIconsUnavailable')
        : t('doneIcons', [formatNumber(icons.refreshed), formatNumber(icons.total)]);
  }

  const list = $('failure-list');
  list.replaceChildren(
    ...report.failures.map(({ item, error }) => {
      const entry = document.createElement('li');
      const reason = error instanceof StaleItemError ? t('errorStale') : errorMessage(error);
      entry.textContent = `${item.title || item.url} — ${reason}`;
      return entry;
    }),
  );
  $('done-failures').hidden = report.failures.length === 0;
  showView('done');
}

// ---------------------------------------------------------------- shared

async function backup() {
  try {
    await downloadBackup({ readingListTitle: t('readingList') });
  } catch (error) {
    showNotice(t('errorBackup', errorMessage(error)));
  }
}

function setProgressBar(id, done, total) {
  const ratio = total ? done / total : 0;
  $(`${id}-fill`).style.transform = `scaleX(${ratio})`;
  $(id).setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
}

function showView(name) {
  for (const view of VIEWS) $(`view-${view}`).hidden = view !== name;
  $('actionbar').hidden = name !== 'review';
  // Move focus to the new heading so keyboard and screen-reader users follow along.
  $(`view-${name}`).querySelector('h1').focus();
}

function setBusy(busy) {
  state.busy = busy;
  $('scan-button').disabled = busy;
  $('rescan-button').disabled = busy;
  updateApplyButton();
}

function updateApplyButton() {
  const { updates, removals } = selectedChanges();
  $('apply-button').disabled = state.busy || updates.length + removals.length === 0;
}

function showNotice(message, tone = 'error') {
  const notice = $('notice');
  notice.textContent = message;
  notice.dataset.tone = tone;
  notice.hidden = false;
}

function hideNotice() {
  $('notice').hidden = true;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function throttleToFrame(callback) {
  let scheduled = false;
  return () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      callback();
    });
  };
}
