// The screen that covers Slack while BetterSlack starts.
//
// It is a decoration over the whole application, which is the entire reason it
// is tested: a decoration with the power to hide someone's Slack has to be
// unable to hide it for ever, unable to throw inside boot, and unable to appear
// at a moment when there is nowhere to put it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { showSplash, splashLineFrom, splashLinesFrom } from '../dist/ui/splash.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

async function withDom(html, run) {
  const dom = new JSDOM(html, { pretendToBeVisual: true });
  // Node's own timers, deliberately: jsdom's are bound to its window, and
  // calling one with globalThis as its receiver recurses until the stack goes.
  const keys = ['document', 'window', 'MutationObserver', 'navigator'];
  const previous = keys.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]);
  for (const key of keys) {
    Object.defineProperty(globalThis, key, {
      value: dom.window[key] ?? dom.window, configurable: true, writable: true,
    });
  }
  try {
    return await run(dom);
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    dom.window.close();
  }
}

const hostIn = (dom) => dom.window.document.getElementById('betterslack-splash');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Long enough for the whole exit: a 500ms floor so the screen cannot appear and
 * vanish inside a frame, then a 260ms fade before the node is taken out.
 */
const EXIT_MS = 900;

test('it covers the app, in a shadow root of its own', async () => {
  await withDom('<!doctype html><html><head></head><body></body></html>', async (dom) => {
    const splash = showSplash();
    const host = hostIn(dom);
    assert.ok(host, 'it is on screen');
    // A shadow root, because at document-start Slack's stylesheet has not
    // loaded and a theme may repaint everything a moment later.
    assert.ok(host.shadowRoot, 'and isolated from whatever Slack does to the page');
    assert.ok(host.shadowRoot.querySelector('.mark svg'), 'with the mark in it');
    assert.equal(host.getAttribute('aria-hidden'), 'true', 'and out of the accessibility tree');
    splash.done();
  });
});

test('at document-start there is no body, and it waits for one', async () => {
  /*
   * The runtime is injected before Slack's markup exists, so `document.body` is
   * genuinely null here -- the same state that made `StyleManager` throw and
   * take the whole bundle down. Nothing is built until there is somewhere to
   * put it.
   */
  await withDom('<!doctype html><html></html>', async (dom) => {
    const { document: doc } = dom.window;
    doc.documentElement.remove();
    const splash = showSplash();
    assert.equal(hostIn(dom), null, 'nothing yet, and nothing thrown');

    const html = doc.createElement('html');
    html.append(doc.createElement('head'), doc.createElement('body'));
    doc.append(html);
    await wait(30);

    assert.ok(hostIn(dom), 'it appears as soon as the page does');
    splash.done();
  });
});

test('done() before it ever appeared leaves nothing behind', async () => {
  await withDom('<!doctype html><html></html>', async (dom) => {
    dom.window.document.documentElement.remove();
    showSplash().done();

    const { document: doc } = dom.window;
    const html = doc.createElement('html');
    html.append(doc.createElement('head'), doc.createElement('body'));
    doc.append(html);
    await wait(30);

    assert.equal(hostIn(dom), null, 'a cancelled splash does not turn up later');
  });
});

test('it names what is starting, so a slow mod is not a guess', async () => {
  await withDom('<!doctype html><html><head></head><body></body></html>', async (dom) => {
    const splash = showSplash();
    splash.progress('Motion', 6, 13);
    const text = hostIn(dom).shadowRoot.querySelector('.label').textContent;
    assert.match(text, /Motion/);
    // Counted from one: "6 of 13" while the seventh is the one being started
    // would be off by one on the only number anybody reads.
    assert.match(text, /7/);
    assert.match(text, /13/);
    splash.done();
  });
});

test('it cannot stay for ever', () => {
  // A screen over the whole app that never lifts is worse than no screen at
  // all, and this project has already had two ways to be locked out of Slack.
  const source = read('src/runtime/ui/splash.ts');
  assert.match(source, /const CEILING_MS = 20_000;/, 'there is a ceiling');
  assert.match(source, /const ceiling = setTimeout\(/, 'and it is armed when the splash goes up');
  assert.match(source, /clearTimeout\(ceiling\)/, 'and disarmed when it comes down normally');

  const boot = read('src/runtime/index.ts');
  // A boot that threw would otherwise leave the app behind a logo.
  assert.match(boot, /catch \(err\) \{\s*\n[\s\S]{0,220}?splash\.done\(\);\s*\n\s*throw err;/);
});

test('nothing in it is built while the module is being evaluated', () => {
  /*
   * This file is imported at document-start. `createI18n` reads the language
   * off `document.documentElement`, which is null there -- a translator built
   * at module scope threw and took the whole bundle down, which is how the
   * runtime ended up arriving through the loader's re-injection fallback
   * against a half-built DOM, which is where both renderer freezes came from.
   */
  const source = read('src/runtime/ui/splash.ts');
  assert.doesNotMatch(
    source,
    /^const \w+ = createI18n\(/m,
    'the translator must be built on first use, not on import',
  );
  assert.match(source, /translator \?\?= createI18n\(\)/, 'lazily, and cached');
});

test('the still mark is what is on screen until the animation arrives', async () => {
  /*
   * And what stays if it never does. The animation is asked for over the bridge
   * rather than shipped in the runtime bundle -- that bundle is a string run at
   * document-start on every navigation and the video is ~95kB -- so there is
   * always a moment with no video, and there may be a boot with none at all.
   */
  await withDom('<!doctype html><html><head></head><body></body></html>', async (dom) => {
    const splash = showSplash(Promise.resolve(null));
    const stage = hostIn(dom).shadowRoot.querySelector('.stage');
    assert.ok(stage.querySelector('.mark svg'), 'the mark is drawn immediately');
    await wait(30);
    assert.equal(stage.querySelector('video'), null, 'and no video was added for a refused answer');
    assert.equal(stage.classList.contains('stage--art'), false);
    splash.done();
  });
});

test('a refused or broken animation is never swapped in over the mark', async () => {
  await withDom('<!doctype html><html><head></head><body></body></html>', async (dom) => {
    // jsdom decodes nothing, so `canplay` never fires -- which is exactly the
    // failure being guarded: the class that hides the mark is added by that
    // event and by nothing else.
    const splash = showSplash(Promise.resolve('AAAA'));
    await wait(40);
    const stage = hostIn(dom).shadowRoot.querySelector('.stage');
    assert.ok(stage.querySelector('video'), 'the element is there');
    assert.equal(
      stage.classList.contains('stage--art'), false,
      'but the mark is only hidden once the video says it can play',
    );
    splash.done();
  });
});

test('an animation that arrives after the screen has gone is dropped', async () => {
  await withDom('<!doctype html><html><head></head><body></body></html>', async (dom) => {
    let deliver;
    const splash = showSplash(new Promise((resolve) => { deliver = resolve; }));
    splash.done();
    await wait(30);
    deliver('AAAA');
    await wait(30);
    // The host is still there for a moment -- there is a 500ms floor so the
    // screen cannot blink -- but nothing may be added to it on the way out.
    assert.equal(
      hostIn(dom)?.shadowRoot.querySelector('video') ?? null, null,
      'a late answer does not decorate a screen that is leaving',
    );
    await wait(EXIT_MS);
    assert.equal(hostIn(dom), null, 'and then it is gone');
  });
});

test('the video is inlined in the loader, not in the runtime', () => {
  /*
   * src/runtime/index.ts says at the top that it runs at document-start on
   * every navigation and must be cheap. ~95kB of video in it would be a
   * decoration overruling that; the loader is a file on disk that starts once.
   */
  const build = read('scripts/build.mjs');
  const loaderBlock = build.slice(build.indexOf('const loader = {'), build.indexOf('const runtime = {'));
  const runtimeBlock = build.slice(build.indexOf('const runtime = {'), build.indexOf('const runtimeModules'));
  assert.match(loaderBlock, /'\.webm': 'base64'/, 'the loader inlines it');
  assert.doesNotMatch(runtimeBlock, /webm/, 'the renderer bundle does not');

  const splash = read('src/runtime/ui/splash.ts');
  assert.doesNotMatch(splash, /import .*\.webm/, 'and the screen is handed it rather than importing it');
});

test('without a theme picture the stage is BetterSlack\'s own', async () => {
  await withDom('<!doctype html><html><head></head><body></body></html>', async (dom) => {
    const splash = showSplash(Promise.resolve(null));
    await wait(40);
    const stage = hostIn(dom).shadowRoot.querySelector('.stage');
    assert.equal(stage.classList.contains('stage--theme'), false);
    assert.ok(stage.querySelector('.mark svg'));
    splash.done();
  });
});

test('a theme\'s start screen is on the very first frame, read from the boot payload', async () => {
  const { splashVarsFrom } = await import('../dist/ui/splash.mjs');
  const xp = read('mods/themes/windows-xp/theme.css');
  const payload = {
    settings: { enabled: ['discord-dark', 'windows-xp', 'some-plugin'] },
    mods: [{ id: 'discord-dark', type: 'theme' }, { id: 'windows-xp', type: 'theme' }, { id: 'some-plugin', type: 'plugin' }],
    sources: {
      'discord-dark': { 'theme.css': ':root { --betterslack-splash-background: #111; }' },
      'windows-xp': { 'theme.css': xp },
      // A plugin's stylesheet is not a theme's say.
      'some-plugin': { 'style.css': ':root { --betterslack-splash-background: red; }' },
    },
  };
  const vars = splashVarsFrom(payload);
  assert.match(vars, /--betterslack-splash-art: url\("data:image\/svg\+xml,[^"]+"\);/);
  assert.match(vars, /--betterslack-splash-background: #000000;/, 'the last theme wins');
  assert.equal(splashVarsFrom({ settings: { enabled: [] }, mods: [], sources: {} }), '');

  await withDom('<!doctype html><html><head></head><body></body></html>', async (dom) => {
    const splash = showSplash(Promise.resolve('AAAA'), vars);
    const root = hostIn(dom).shadowRoot;
    assert.ok(root.querySelector('.stage').classList.contains('stage--theme'), 'themed before anything is awaited');
    assert.ok(root.querySelector('style').textContent.includes(':host { --betterslack-splash'), 'on the host itself');
    await wait(30);
    assert.equal(root.querySelector('video'), null, 'and the default animation never goes in');
    splash.done();
  });
});

/** The slice of the boot payload a mod's start-screen lines are read from. */
const payloadWith = ({ enabled = ['lines-mod'], saved } = {}) => ({
  settings: {
    enabled,
    modSettings: saved === undefined ? {} : { 'lines-mod': { lines: saved } },
  },
  mods: [{
    id: 'lines-mod',
    splash: { setting: 'lines' },
    settings: [{ key: 'lines', type: 'textarea', default: '# Shipped\nfrom the manifest\n' }],
  }, { id: 'other', settings: [{ key: 'lines', default: 'not named by a splash field' }] }],
});

test("a mod's lines come from its setting, or from its manifest until somebody edits it", () => {
  assert.deepEqual(splashLinesFrom(payloadWith()), ['from the manifest']);
  assert.deepEqual(splashLinesFrom(payloadWith({ saved: 'one\n\n  two  \n# a heading' })), ['one', 'two']);
  assert.deepEqual(splashLinesFrom(payloadWith({ saved: '' })), [], 'an emptied list stays empty');
  assert.deepEqual(splashLinesFrom(payloadWith({ enabled: [] })), [], 'a mod that is off says nothing');
  assert.equal(splashLineFrom(payloadWith({ saved: 'a\nb\nc' }), () => 0.5), 'b');
  assert.equal(splashLineFrom(payloadWith({ saved: 'a\nb\nc' }), () => 1), 'c', 'never past the end');
  assert.equal(splashLineFrom({ settings: null, mods: [] }), '', 'a payload it cannot read costs nothing');
});

test('the line is on the screen, between the mark and the progress', async () => {
  await withDom('<!doctype html><html><head></head><body></body></html>', async (dom) => {
    const splash = showSplash(undefined, '', 'Vu avec JL. Revu avec JL.');
    const root = hostIn(dom).shadowRoot;
    const line = root.querySelector('.line');
    assert.equal(line?.textContent, 'Vu avec JL. Revu avec JL.');
    assert.ok(line.previousElementSibling.classList.contains('stage'), 'under the mark');
    assert.ok(line.nextElementSibling.classList.contains('label'), 'above the progress');
    splash.done();
    await wait(EXIT_MS);
  });
});

test('no line, no empty box', async () => {
  await withDom('<!doctype html><html><head></head><body></body></html>', async (dom) => {
    const splash = showSplash();
    assert.equal(hostIn(dom).shadowRoot.querySelector('.line'), null);
    splash.done();
    await wait(EXIT_MS);
  });
});

test('the boot wires the line in, and safe mode shows none', () => {
  const source = read('src/runtime/index.ts');
  assert.match(source, /payload\.info\.safeMode \? '' : splashLineFrom\(payload\)/);
});
