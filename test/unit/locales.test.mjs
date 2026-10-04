// Guards the translations: same keys and placeholders in every language, and every
// key the UI references exists.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, it } from 'node:test';

const EXTENSION = new URL('../../extension/', import.meta.url);
const read = (path) => readFileSync(new URL(path, EXTENSION), 'utf8');
const locales = readdirSync(new URL('_locales/', EXTENSION));
const messages = Object.fromEntries(locales.map((lang) => [lang, JSON.parse(read(`_locales/${lang}/messages.json`))]));

describe('locales', () => {
  it('ships Spanish (default) and English', () => {
    assert.deepEqual(locales.sort(), ['en', 'es']);
    assert.equal(JSON.parse(read('manifest.json')).default_locale, 'es');
  });

  it('have the same keys and placeholders', () => {
    const [reference, ...others] = Object.values(messages);
    for (const other of others) {
      assert.deepEqual(Object.keys(other).sort(), Object.keys(reference).sort());
      for (const [key, entry] of Object.entries(reference)) {
        assert.deepEqual(other[key].placeholders ?? null, entry.placeholders ?? null, key);
      }
    }
  });

  it('declare every placeholder they use', () => {
    for (const [lang, entries] of Object.entries(messages)) {
      for (const [key, { message, placeholders = {} }] of Object.entries(entries)) {
        for (const [, name] of message.matchAll(/\$([A-Z_]+)\$/g)) {
          assert.ok(name.toLowerCase() in placeholders, `${lang}.${key} uses $${name}$`);
        }
      }
    }
  });

  it('cover every key used by the extension', () => {
    const used = new Set();
    const html = read('app.html');
    for (const [, key] of html.matchAll(/data-i18n(?:-title|-aria-label)?="([^"]+)"/g)) used.add(key);
    for (const file of readdirSync(new URL('js/', EXTENSION))) {
      for (const [, key] of read(`js/${file}`).matchAll(/\bt\('([A-Za-z_]+)'/g)) used.add(key);
    }
    for (const [, key] of read('manifest.json').matchAll(/__MSG_(\w+)__/g)) used.add(key);
    for (const reason of ['permanent', 'https', 'temporary', 'homepage', 'notFound', 'gone', 'dns', 'server', 'client', 'timeout', 'connection', 'tls', 'redirectLoop', 'network']) {
      used.add(`reason_${reason}`);
    }

    for (const [lang, entries] of Object.entries(messages)) {
      for (const key of used) assert.ok(key in entries, `${lang} is missing "${key}"`);
    }
  });

  it('keep the store description within the 132 character limit', () => {
    for (const [lang, entries] of Object.entries(messages)) {
      assert.ok(entries.extDescription.message.length <= 132, lang);
    }
  });
});
