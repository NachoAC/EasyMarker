// Thin wrapper over chrome.i18n. Texts live in _locales/<lang>/messages.json.

let numberFormat;

/**
 * @param {string} key
 * @param {string | string[]} [substitutions]
 */
export function t(key, substitutions) {
  return chrome.i18n.getMessage(key, substitutions) || key;
}

/** @param {number} value */
export function formatNumber(value) {
  numberFormat ??= new Intl.NumberFormat(chrome.i18n.getUILanguage());
  return numberFormat.format(value);
}

/**
 * Fills elements marked with data-i18n (text), data-i18n-title and data-i18n-aria-label.
 * Always via textContent/attributes, never as HTML.
 */
export function localizeDocument() {
  document.documentElement.lang = chrome.i18n.getUILanguage();
  for (const element of document.querySelectorAll('[data-i18n]')) {
    element.textContent = t(element.dataset.i18n);
  }
  for (const element of document.querySelectorAll('[data-i18n-title]')) {
    element.title = t(element.dataset.i18nTitle);
  }
  for (const element of document.querySelectorAll('[data-i18n-aria-label]')) {
    element.setAttribute('aria-label', t(element.dataset.i18nAriaLabel));
  }
}
