---
name: Your first plugin
title: Getting started
order: 2
---

A plugin is one folder and one file. This builds a working one from nothing —
a button in Slack's channel header that says hello — and then shows where each
piece comes from.

Everything here is live in the client as you save it. Mods hot-reload: the
loader watches `mods/`, so there is no build step and no restart for anything
under it.

## 1. Make the folder

There is a generator, and it writes a mod that already passes the checks:

```bash
pnpm new-mod plugin hello "Says hello from the channel header"
```

If you would rather see every file, the rest of this page is what it wrote.

## 2. `mods/plugins/hello/mod.json`

```json
{
  "id": "hello",
  "name": "Hello",
  "type": "plugin",
  "version": "1.0.0",
  "author": "your-github-handle",
  "description": "One sentence about what a user gets, not how it works.",
  "entry": "index.js",
  "betterslackApi": 1
}
```

`id` has to match the folder name. `pnpm validate-mods` says so if it does not.

## 3. `mods/plugins/hello/index.js`

A plugin is an ES module with one export. `start` is handed the API and may be
async; anything it registers is undone when the mod is switched off.

```js
const ICON = `<svg viewBox="0 0 20 20" aria-hidden="true">
  <circle cx="10" cy="10" r="7" fill="none"
          stroke="currentColor" stroke-width="1.6"/>
</svg>`;

export default {
  start(api) {
    api.slack.addToolbarButton('channelHeader', {
      id: 'hello',
      label: 'Say hello',
      icon: ICON,
      onClick: () => api.ui.toast('Hello', { variant: 'success' }),
    });
  },
};
```

That is the whole mod. Open the panel with `⌘⇧M`, install it from **Browse**,
switch it on, and the button is in the channel header.

## 4. Give it a setting

Settings are declared in the manifest and drawn by the panel — you do not build
a form. Add this to `mod.json`:

```json
{
  "settings": [
    {
      "key": "greeting",
      "type": "text",
      "label": "What to say",
      "labels": { "fr": "Ce qu’il faut dire" },
      "default": "Hello"
    }
  ]
}
```

`label`, `hint` and a choice's option labels each take a table of languages
beside them -- `labels`, `hints` -- exactly as `description` takes
`descriptions`. English stays required and is the fallback, and a test fails a
mod whose settings are English only.

Read the value where you need it:

```js
const greeting = api.settings.get('greeting', 'Hello');
api.ui.toast(greeting, { variant: 'success' });
```

When the user changes a setting, the plugin is restarted with the new value.
A plugin that registers `api.settings.onChange` is told instead and keeps
running, for when a restart would show.

The types are `boolean`, `number`, `text`, `textarea`, `colour` and `choice`.
A `textarea` is for a list: it is drawn under its label at the width of the
row, counts its lines, and has an **Expand** button that opens it in a dialog
of its own, with **Restore the original** to put the manifest's text back.

### A line on the start screen

The start screen is up before any plugin runs, so a plugin cannot put words on
it by calling something. It names a `textarea` setting instead, and the
runtime picks one of its lines at random each time Slack starts:

```json
{
  "splash": { "setting": "lines" },
  "settings": [
    { "key": "lines", "type": "textarea", "label": "Lines", "default": "# Greetings\nHello\nWelcome back" }
  ]
}
```

One line per entry; blank lines and lines starting with `#` are skipped. The
user's value is read when there is one and the default when there is not, and
every switched-on mod that names a setting is pooled. Splash Lines is the
worked example.

Settings are for preferences. A file -- a sound somebody picked, a picture, an
export -- goes in `api.data`, the mod's own folder on disk:

```js
const { name } = await api.data.write(file.name, file);
const blob = await api.data.read(name);
```

## 5. Speak the reader's language

Every shipped plugin has English and French, and a test fails a mod whose
tables do not cover the same keys. English is required, and is what an unknown
language falls back to.

```js
const t = api.i18n.strings({
  en: { hello: 'Hello' },
  fr: { hello: 'Bonjour' },
});
api.ui.toast(t('hello'));
```

## 6. Reach for the helpers before the DOM

`api.helpers` is where most of a mod's work already exists. The four that come
up most:

```js
// A persisted flag plus a class on <html>, so the behaviour can be pure CSS.
await api.helpers.toggle({
  key: 'quiet',
  className: 'hello-quiet',
  whenOn: 'html.hello-quiet .p-channel_sidebar { display: none }',
});

// Keep a node in a container Slack keeps re-rendering away.
api.helpers.mount('.p-view_header__actions', 'hello-mark',
  () => api.dom.h('span', {}, ['·']));

// A shortcut, with a guard that gates the match rather than the handler.
api.helpers.hotkey('mod+shift+h', () => api.ui.toast('Hello'), { when: () => true });

// Run for every match now and for every one that arrives later.
api.helpers.each('[data-qa="message_container"]', (message) => { /* … */ });
```

Never write a raw `MutationObserver` to insert something. Slack re-renders
constantly and you will get duplicates; `mount` and `each` handle it, and give
up loudly rather than looping if a container fights back.

## 7. More than one file

Once a plugin is more than a screenful, split it. Import relative paths and
BetterSlack resolves them:

```
mods/plugins/my-plugin/
  mod.json        "entry": "index.js"
  index.js        import { render } from './ui/panel.js';
  ui/panel.js     import { format } from '../lib/format.js';
  lib/format.js
  test.mjs
```

Three rules, all enforced by `pnpm validate-mods`:

- **Relative specifiers only** -- `./x.js`, `../lib/x.js`. There is no npm and
  no CDN in the page; a bare `import 'lodash'` has nothing to resolve to.
- **Stay inside your folder.** `../../other-plugin/index.js` is rejected: mods
  are installed one at a time, and yours may be the only one there.
- **No cycles.** A file may not import, directly or transitively, something that
  imports it back.

Why the rules: the page has no `'unsafe-eval'`, so a plugin is loaded as a real
ES module through a `blob:` URL -- and a blob URL has no directory for a
relative path to resolve against. BetterSlack reads your whole folder, builds a
blob per file leaves-first, and rewrites each relative specifier to the blob URL
of the file it names. The module you wrote is the module that runs; only the
specifiers change. `.css` files in the folder ship too, so a stylesheet can live
in a real `.css` file: `api.css(api.assets.text('ui/panel.css'))`.

A theme splits the same way, with `@import './tokens.css'` instead of an
`import`, and is stitched into one stylesheet in the order it was imported.

## 8. The page a reader sees

Everything above is the minimum. What turns a row in a list into a page somebody
reads is optional, and every mod in this repository has all of it -- a theme as
much as a plugin:

```json
{
  "icon": "icon.svg",
  "descriptions": { "fr": "Une phrase, dans la langue du lecteur." },
  "screenshots": [{
    "file": "screenshot.webp",
    "captions": { "en": "What the picture shows.", "fr": "Ce que montre l'image." }
  }],
  "readme": "README.md",
  "readmes": { "fr": "README.fr.md" }
}
```

- `icon` is an SVG in the mod's folder, inlined into the catalogue: it costs no
  request and cannot be missing when the panel draws.
- `descriptions` and `readmes` are keyed by language. English is what a reader
  falls back to, so `description` and `readme` stay required.
- `screenshots` are read one at a time, only when the page is opened, and the
  manifest's order is the order they are drawn in.
- The README is also a file people read in the repository, so it opens with the
  mod's name and its description; the panel drops both, since they are already
  the heading and the paragraph above it.
- `pnpm shoot --mods -- --only=my-plugin` takes the picture, against a real
  workspace with every name, face and message on screen replaced first.

Every path must stay inside the mod's folder -- the loader refuses anything that
climbs out -- and `pnpm validate-mods` checks that each file exists.

## 9. Read a real one

[`channel-notes`](https://github.com/AirOne-dev/BetterSlack/blob/master/mods/plugins/channel-notes/index.js)
is the worked example: a button, a modal, settings, a confirm, a toast, and no
CSS at all.
[`motion`](https://github.com/AirOne-dev/BetterSlack/blob/master/mods/plugins/motion/index.js)
is the one to read for `helpers.toggle` and a stylesheet built in one `api.css`
call.
[`quote-reply`](https://github.com/AirOne-dev/BetterSlack/blob/master/mods/plugins/quote-reply/index.js)
is the shortest useful one.

## 10. Test it

A mod's test runs against a recording fake API — no Slack, no browser:

```bash
pnpm test -- hello
```

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestApi, installDom } from '../../../tests/harness.mjs';
import plugin from './index.js';

test('adds a button to the channel header', async () => {
  const dom = installDom();
  try {
    const { api, recorded } = createTestApi();
    await plugin.start(api);
    assert.equal(recorded.toolbarButtons[0].toolbar, 'channelHeader');

    recorded.toolbarButtons[0].button.onClick();
    assert.ok(recorded.toasts.some((toast) => toast.variant === 'success'));
  } finally {
    dom.cleanup();
  }
});
```

`installDom` gives you a Slack-shaped document and `createTestApi` a recording
stand-in for the api, so a test needs no Slack, no Electron and no network.
Assert on what a user would notice, not on how you got there.

A theme's test is three lines, because the shared checks come for free:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { themeChecks } from '../../../tests/theme.mjs';

themeChecks(test, assert, import.meta.url);
```

jsdom cannot see the failures that matter most -- a mod that wedges the
renderer, a mod that throws on start. `pnpm test:live` boots the real Slack,
asks the runtime what actually loaded and turns the answer into an exit code. It
closes Slack afterwards, which is why it is not part of `pnpm test`.

## 11. Ship it

```bash
pnpm check
```

One command: types, build, manifests, the registry, the site, and every test.
It regenerates `mods/registry.json`, which is committed — a dirty tree after it
means the catalogue had drifted, and the fix is to commit it.

Then open a pull request. A human reads it, and that review is the security
model: a plugin runs unsandboxed in an authenticated Slack tab.
`CONTRIBUTING.md` lists what gets rejected.

## Three things that will catch you out

- **`eval()` and `new Function()` throw.** Slack's Content Security Policy has
  no `'unsafe-eval'`. They *work* in a DevTools console, which misleads.
- **Anchor on `data-qa` attributes**, then on design tokens. A class like
  `circleButton__cMiUK` is CSS-module output and changes every Slack build;
  `p-channel_sidebar__channel` is stable.
- **Switching workspace does not reload the client.** Same page, same mods, new
  team id. Anything cached then belongs to the workspace the user has left, so
  drop per-workspace state in `api.slack.onTeamChange`, and ask
  `api.slack.currentTeamId()` rather than parsing the URL.
