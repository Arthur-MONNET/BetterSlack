// Catalogue mods that are on by default, and what "default" has to mean.
//
// A fresh install starts with nothing, except what a manifest marks
// `defaultEnabled`. The loader switches each of those on once per person --
// on a first install and on the first start after an update that brings one --
// and never again: somebody who switched it off has said so.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/*
 * store.ts resolves the home directory once, when it is imported, so the
 * scratch home has to exist before it is: the wrong order runs this against
 * the real ~/.betterslack.
 */
const HOME = mkdtempSync(path.join(tmpdir(), 'betterslack-defaults-'));
process.env.BETTERSLACK_HOME = HOME;
const { readSettings, seedDefaultMods, setModEnabled, setModInstalled, writeSettings } =
  await import('../dist/store.mjs');
const { Catalog, parseManifest } = await import('../dist/catalog.mjs');

const SETTINGS = path.join(HOME, 'settings.json');
const reset = () => rmSync(SETTINGS, { force: true });

test('a first start installs and switches on the defaults', async () => {
  reset();
  const { settings, added } = await seedDefaultMods(['splash-lines']);
  assert.deepEqual(added, ['splash-lines']);
  assert.deepEqual(settings.installed, ['splash-lines']);
  assert.deepEqual(settings.enabled, ['splash-lines']);
  assert.deepEqual((await readSettings()).seeded, ['splash-lines'], 'and it is written down');
});

test('an update brings a new default to somebody who already has mods', async () => {
  reset();
  await writeSettings({
    installed: ['motion'], enabled: ['motion'], modSettings: {}, customCss: '', hotReload: true,
  });
  await seedDefaultMods(['splash-lines']);
  const after = await readSettings();
  assert.deepEqual(after.installed, ['motion', 'splash-lines']);
  assert.deepEqual(after.enabled, ['motion', 'splash-lines']);
});

test('switched off, it stays off at every later start', async () => {
  reset();
  await seedDefaultMods(['splash-lines']);
  await setModEnabled('splash-lines', false);
  const { added } = await seedDefaultMods(['splash-lines']);
  assert.deepEqual(added, []);
  assert.deepEqual((await readSettings()).enabled, []);
});

test('removed, it is not installed again either', async () => {
  reset();
  await seedDefaultMods(['splash-lines']);
  await setModInstalled('splash-lines', false);
  await seedDefaultMods(['splash-lines']);
  const after = await readSettings();
  assert.deepEqual(after.installed, []);
  assert.deepEqual(after.enabled, []);
});

test('nothing new to offer writes nothing', async () => {
  reset();
  await seedDefaultMods([]);
  assert.deepEqual(await readSettings(), await readSettings());
  const { added } = await seedDefaultMods([]);
  assert.deepEqual(added, []);
});

const manifest = (extra) => JSON.stringify({
  id: 'example-mod', name: 'X', type: 'plugin', version: '1.0.0', author: 'a',
  description: 'A mod long enough to describe itself properly.',
  entry: 'index.js', betterslackApi: 1,
  settings: [
    { key: 'lines', type: 'textarea', label: 'Lines', default: 'a\nb' },
    { key: 'name', type: 'text', label: 'Name' },
  ],
  ...extra,
});

test('a manifest may hand a textarea to the start screen, and nothing else', () => {
  const parsed = parseManifest(manifest({ splash: { setting: 'lines' }, defaultEnabled: true }), 'mod.json', 'plugin');
  assert.deepEqual(parsed.splash, { setting: 'lines' });
  assert.equal(parsed.defaultEnabled, true);
  assert.equal(parseManifest(manifest({}), 'mod.json', 'plugin').defaultEnabled, undefined);

  assert.throws(() => parseManifest(manifest({ splash: { setting: 'name' } }), 'mod.json', 'plugin'),
    /not a textarea setting/);
  assert.throws(() => parseManifest(manifest({ splash: { setting: 'missing' } }), 'mod.json', 'plugin'),
    /not a textarea setting/);
  assert.throws(() => parseManifest(manifest({ splash: 'lines' }), 'mod.json', 'plugin'), /"splash" must be/);
  assert.throws(() => parseManifest(manifest({ defaultEnabled: 'yes' }), 'mod.json', 'plugin'), /true or false/);
});

/** A mods root holding one plugin, so a Catalog has something real to scan. */
function modsRoot(id, extra) {
  const root = mkdtempSync(path.join(tmpdir(), 'betterslack-root-'));
  const dir = path.join(root, 'plugins', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'mod.json'), JSON.stringify({
    id, name: id, type: 'plugin', version: '1.0.0', author: 'a',
    description: 'A mod long enough to describe itself properly.',
    entry: 'index.js', betterslackApi: 1, ...extra,
  }));
  writeFileSync(path.join(dir, 'index.js'), 'export default { start() {} };\n');
  return root;
}

test('only the shipped catalogue decides what is a default', async () => {
  const builtin = modsRoot('shipped', { defaultEnabled: true });
  const user = modsRoot('mine', { defaultEnabled: true });
  const catalog = new Catalog(builtin, user);
  await catalog.refresh();
  assert.deepEqual(catalog.defaultIds(), ['shipped'], 'a folder under the home does not switch itself on');
});

test('a copy under the home neither drops nor makes a default', async () => {
  const builtin = modsRoot('shipped', { defaultEnabled: true });
  const user = modsRoot('shipped', {});
  const catalog = new Catalog(builtin, user);
  await catalog.refresh();
  assert.equal(catalog.get('shipped').origin, 'installed', 'the copy shadows the shipped one');
  assert.deepEqual(catalog.defaultIds(), ['shipped'], 'and the shipped one is still the default');
});

test('the catalogue ships Splash Lines on by default', async () => {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'mods');
  const catalog = new Catalog(root, mkdtempSync(path.join(tmpdir(), 'betterslack-empty-')));
  await catalog.refresh();
  assert.ok(catalog.defaultIds().includes('splash-lines'));
});
