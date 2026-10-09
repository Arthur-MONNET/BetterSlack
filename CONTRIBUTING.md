# Contributing a mod

Mods are distributed from this repository. To publish one, open a pull request
that adds a folder under `mods/`. Every mod is read by a maintainer before it
merges.

## Why the review is strict

A BetterSlack plugin runs inside an authenticated Slack tab. It can read every
message you can read, and it can talk to the network. There is no sandbox around
it and no permission prompt in front of it.

That means the code review **is** the security model. A plugin that would be
harmless in a browser extension store is not automatically acceptable here,
because there is no second line of defence behind it.

## Using the Slack API

Some mods need more than what is painted on screen. Slack's API refuses
cookie-only requests, so the desktop client authenticates with a token it keeps
in `localStorage`.

Mods must never read that token. Use `api.slack.web`, which is the audited
wrapper in `src/runtime/web-api.ts`: it reads the token in one place, can only
send requests to Slack's own origin, and never hands the token back to callers.
One file to review instead of one per mod.

Using the signed-in session to call Slack's own API is fine. Sending anything
derived from it anywhere else is not.

## Themes that require plugins

A theme is CSS. When a look needs behaviour, that behaviour goes in a plugin and
the theme lists it in `requires`. What a review looks for:

- **The plugin has to stand on its own.** It should read Slack's design tokens
  and be worth installing without the theme. A "plugin" that is really one
  theme's implementation detail belongs in neither.
- **The theme must not style the plugin's markup.** That couples them and breaks
  the plugin for everyone using a different theme.
- **Every id must exist here.** A theme naming a plugin nobody ships installs
  fine and then quietly looks wrong.
- **Say in the pull request why CSS could not do it.** "The account strip needs
  a display name and CSS cannot fetch one" is an answer. "It was easier" is not.

## Talking to a server of your own

A page cannot read the answer of a server that sends no CORS headers, which is
most of them. `api.net.request` has the loader make the request instead, and
only to an address held by a setting your manifest names:

```json
{
  "settings": [{ "key": "apiUrl", "type": "text", "label": "Server address" }],
  "network": { "settings": ["apiUrl"] }
}
```

The address is the user's: typed in the panel or in a form of your mod's, shown
on the mod's page, and never chosen by the mod -- a mod writes one of its
`network` settings only with what the user typed, and review checks it. That is
what lets a
reviewer read one line to know where your mod talks; it is a rule for review,
not a sandbox, since every plugin shares the page. Say in the pull request what
the server is and exactly what is sent to it -- and never anything that came
from Slack.

### A server that wants a token in a header

Never put a token in the address, and never keep one yourself. Declare the
header, and hand the secret to the loader once -- it keeps it where the page
cannot read it, and sends it only to the origin it was given for:

```json
{ "network": { "settings": ["gitUrl"], "credential": { "header": "PRIVATE-TOKEN" } } }
```

```js
await api.net.setCredential(tokenField.value, api.settings.get('gitUrl'));
tokenField.value = '';
```

`{ "header": "Authorization", "prefix": "Bearer " }` is the other common shape.
There is no call that reads the secret back; `hasCredential()` says only
whether one is held, and `clearCredential()` is signing out. Review checks that
the field is emptied once sent and that nothing about the token is logged, shown
in an error or written to a setting.

## On by default

A catalogue mod whose manifest says `"defaultEnabled": true` is installed and
switched on for every user, once: at the first start of a fresh install, and
at the first start after an update that brings it. Somebody who then switches
it off keeps it off. It is the maintainers' call, not a contributor's -- a pull
request that sets it is asking to run its code in everybody's Slack, so say
why in the description.

## Text a user reads

Every plugin here ships **English and French**, through `api.i18n.strings()`.
English is the source and the fallback, and a test fails a mod whose two tables
do not cover the same keys.

You are not expected to speak every language — two is the bar. If you add
another, add it to every plugin or none: one plugin speaking German inside an
otherwise English BetterSlack is worse than consistency.

The same goes for the mod's own page in the panel: `descriptions.fr` beside
`description`, and `README.fr.md` beside `README.md`. An icon and one
screenshot are expected too -- `pnpm shoot --mods` takes the picture against a
real client and files it in your folder, replacing every name, face, message
and channel on screen before it does. Nothing in this repository is
photographed as-is.

Do not print emoji shortcodes: `:tada:` on screen reads as a rendering that
failed. `api.slack.emojiUrl`, `api.slack.describeStatus` and
`api.slack.statusNode` draw an emoji when one can be found and nothing when it
cannot.

## What gets a pull request rejected

- Network calls to anywhere other than a clearly stated, purpose-obvious
  endpoint — and never with message content, tokens or workspace identifiers.
- Listening to Slack's realtime socket (`api.slack.events`) for anything other
  than what the mod visibly does with it. It carries every message in every
  conversation you are in, so a mod that asks for `message` and shows nothing
  from it is a mod nobody can check by using it.
- Reading `localStorage`, cookies, or the session token directly, instead of
  going through `api.slack.web`.
- Obfuscated, minified or generated code. Submit the source a human can read.
- Code fetched at runtime from a URL. The reviewed source must be the code that
  runs.
- Anything that changes what a message says, who it appears to be from, or
  whether it appears to have been sent.

If your mod genuinely needs one of these, say so explicitly in the pull request
description and explain why. It is a conversation, not an automatic no — but an
unexplained one is an automatic no.

## Checklist

1. Folder layout, where `<id>` matches your `mod.json` `id` exactly:

   ```
   mods/themes/<id>/mod.json + <entry>.css
   mods/plugins/<id>/mod.json + <entry>.js
   ```

   Plus, for the panel's page: `icon.svg`, `screenshot.webp`, `README.md` and
   `README.fr.md`, each named in the manifest --
   [docs/guide/plugin.md](docs/guide/plugin.md) has the shape.

   A mod is a folder, not a file: `entry` is only where the app starts
   reading. Split the rest however you like -- `import './lib/x.js'` in a
   plugin, `@import './tokens.css'` in a theme -- as long as every path is
   relative and stays inside your folder. There is no npm and no CDN in the
   page, so a bare specifier (`import 'lodash'`) is rejected, as is a path
   that climbs out of the folder or a cycle.

2. `pnpm validate-mods` passes.
3. **A `test.mjs` next to your `mod.json`, and `pnpm test -- <id>`
   passes.** Every mod ships tests. There is no way to opt out: a mod with no
   `test.mjs` fails the structure check immediately.
4. `pnpm registry` has been run and `mods/registry.json` is committed.
5. Tested against the current Slack release. Put the version you tested in
   `slackVersion`. A mod's page says so when it names a Slack newer than the one
   running, so the number is read rather than filed.
6. **You do not write down which BetterSlack your mod needs.** It is computed
   from the API you call -- every entry in `docs/api/` carries the release it
   arrived in -- and published in `mods/registry.json`, where an older install
   reads it and refuses an update it could not run. Declare `needsBetterSlack`
   only to raise that answer, for something reading the source cannot see; a
   declaration below what your code actually calls fails `pnpm validate-mods`,
   naming the calls.
7. The description is one sentence that says what a user gets, not how it works.
8. **Bump `version` whenever you change a mod that is already in the catalogue.**
   The panel updates mods one at a time by comparing what is installed against
   `mods/registry.json` on the default branch, so a fix shipped without a bump
   reaches nobody.

`pnpm new-mod plugin my-plugin "What a user gets"` writes a folder that already
passes every check above — manifest, entry, test, registry entry — which is the
shortest way to start from something green.

### What CI does with your pull request

Two workflows look at mods, and both consider **only the mods your branch
touches** — somebody else's failing mod cannot block your merge, and yours
cannot block theirs:

| Workflow | Per changed mod | Checks |
| --- | --- | --- |
| **Mod structure** | `node scripts/check-structure.mjs <id>` | manifest, entry file exists and imports, a real `start()` export, every relative import lands on a file that is there, CSS parses, `test.mjs` present, registry entry current |
| **Mod tests** | `pnpm test -- <id>` | your own tests |

Each mod gets its own job, so a failure names the mod at fault. Both workflows
end in a job with a stable name (`mod structure`, `mod tests`) — those are the
ones branch protection requires, because matrix job names change with every
pull request.

One exception: if a branch changes the shared runtime API or the test harness,
*every* mod is tested, because the contract they are written against has
changed.

Run the same thing locally before pushing:

```bash
node scripts/changed-mods.mjs           # what CI will pick up
pnpm check-structure -- <id>
pnpm test -- <id>
```

If your mod adds anything to the plugin API, add its file to `docs/api/` in the
same change — one file per entry, and the build fails if the folder and the
TypeScript disagree about what exists. The format is in
[CLAUDE.md](CLAUDE.md#the-api-documentation-format); the page at
`site/api.html` is built from those files, so documenting an entry is what puts
it on the site.

Or `pnpm check`, which runs the whole gate — typecheck, build, manifests,
registry, site, core tests, every mod's tests, structure — in the order the
pieces depend on each other.

### Writing the tests

`tests/harness.mjs` gives you a DOM shaped like Slack's and a recording stand-in
for `api`, so a test never needs Slack, Electron or a network:

```js
import { createTestApi, installDom } from '../../../tests/harness.mjs';
import plugin from './index.js';

const dom = installDom();
const { api, recorded } = createTestApi();
await plugin.start(api);
recorded.messageActions[0].onClick({ permalink: 'https://…' });
// then assert on recorded.toasts, recorded.composerLink, the DOM, …
dom.cleanup();
```

Themes get their checks for free — a three-line `test.mjs` calling
`themeChecks()` from `tests/theme.mjs` covers balanced braces, no remote
resources, and no hashed Slack class names.

## Writing mods that survive Slack updates

Read these before you write anything:

- **[docs/guide/](docs/guide/)** — the walkthrough: install, a plugin, a theme.
- **[docs/api.md](docs/api.md)** — the API, with an example per entry.
- **[docs/themes.md](docs/themes.md)** — Slack's four colour token families and
  the CSS traps. A theme that skips this comes out half-styled.

The short version:

- Anchor on **`data-qa`** attributes, then design tokens. A mod pinned to a
  hashed class name like `circleButton__cMiUK` breaks on Slack's next build.
- `eval()` and `new Function()` throw — Slack's CSP has no `'unsafe-eval'`, and
  `validate-mods` rejects them up front.
- Use `api.helpers.mount`, never a raw `MutationObserver`: Slack re-renders
  constantly and a naive observer inserts duplicates.
- Start from `api.helpers`. A pull request that hand-rolls something the API
  already provides will be asked why.
- Register teardown through `api.onDispose`, or the helpers that return one.

## Local development

```bash
pnpm install && pnpm build
pnpm start
```

pnpm, not npm: esbuild fetches its platform binary in an install script, and
`pnpm-workspace.yaml` is what allows that script to run. If you have no pnpm,
`corepack enable` gets you one on a Node older than 25 (later ones ship no
Corepack), and `npm i -g pnpm` on any of them.

Edit files in `mods/` and they reload in Slack immediately. Mods in
`~/.betterslack/mods/` shadow the repo copies, which is convenient for iterating on
something already merged.
