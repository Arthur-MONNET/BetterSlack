// What Splash Lines promises.
//
// The line on the start screen is drawn by the runtime, from the setting the
// manifest names -- that half is tested in tests/splash.test.mjs against the
// real function. What is left here is the list itself and the palette command.

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assertPluginShape, createTestApi, readModFiles } from '../../../tests/harness.mjs';
import plugin, { linesOf, pick } from './index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILES = readModFiles(here);
const MANIFEST = JSON.parse(readFileSync(path.join(here, 'mod.json'), 'utf8'));
const SHIPPED = MANIFEST.settings.find((field) => field.key === 'lines').default;

test('it is a plugin', () => {
  assertPluginShape(assert, plugin);
});

test('the manifest hands the list to the start screen, and is on by default', () => {
  assert.deepEqual(MANIFEST.splash, { setting: 'lines' });
  assert.equal(MANIFEST.defaultEnabled, true);
});

test('a line is a line: blank ones and # headings are skipped, edges trimmed', () => {
  assert.deepEqual(linesOf('# MEP\n  Il s\'agissait bien d\'un cache.  \n\n#JL\nVu avec JL.\n'), [
    'Il s\'agissait bien d\'un cache.',
    'Vu avec JL.',
  ]);
  assert.deepEqual(linesOf(undefined), []);
});

test('it ships with at least a hundred lines, none of them twice', () => {
  const lines = linesOf(SHIPPED);
  assert.ok(lines.length >= 100, `only ${lines.length}`);
  assert.equal(new Set(lines).size, lines.length, 'a line appears twice');
});

test('every shipped line fits the start screen in two lines at most', () => {
  // The screen draws a line at most 560px wide in 15px bold, about 70
  // characters a row; past two rows it reads as a paragraph, not a punchline.
  for (const line of linesOf(SHIPPED)) {
    assert.ok(line.length <= 140, `too long for the screen: ${line}`);
  }
});

test('pick takes one of them, and never runs off the end', () => {
  assert.equal(pick(['a', 'b', 'c'], () => 0), 'a');
  assert.equal(pick(['a', 'b', 'c'], () => 0.999999), 'c');
  assert.equal(pick(['a', 'b', 'c'], () => 1), 'c');
  assert.equal(pick([], () => 0.5), null);
});

test('the palette command shows a line from the list', async () => {
  const harness = createTestApi({ files: FILES, locale: 'fr-FR', settings: { lines: '# x\nVu avec JL.\n' } });
  await plugin.start(harness.api);
  const command = harness.recorded.commands.find((entry) => entry.id === 'another');
  assert.ok(command, 'the command is registered');
  await command.run();
  assert.equal(harness.recorded.toasts.at(-1).message, 'Vu avec JL.');
});

test('an empty list says so rather than showing nothing', async () => {
  const harness = createTestApi({ files: FILES, settings: { lines: '\n# only a heading\n' } });
  await plugin.start(harness.api);
  await harness.recorded.commands.find((entry) => entry.id === 'another').run();
  assert.match(harness.recorded.toasts.at(-1).message, /empty/);
});
