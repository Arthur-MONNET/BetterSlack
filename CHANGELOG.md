# Changelog

Written for the people upgrading. `pnpm release` seeds each section from the
commits since the last tag; the release then rewrites it into something worth
reading.

## 3.7.1 — 2026-10-09

### Added

- **splash-lines:** 265 more lines, 367 in all, with sections for moderation and customer service

## 3.7.0 — 2026-10-09

### Added

- **plugins:** Splash Lines, a random line on the start screen, on for everybody by default

### Fixed

- **panel:** a textarea setting sits right under its label

### Other

- **site:** rebuild the API previews after the textarea fix

## 3.6.0 — 2026-10-02

### Added

- **Quelio:** the week's progress toward the Quelio objective, today's suggested departure and the state of the lunch break, in a slim bar in Slack's top bar, with the week's details one click away. It talks to a quelio-api server whose address you give it. The company's rules (counted hours, paid breaks, lunch, earliest departure, Friday) are settings, and an afternoon off can be marked. It asks only on working days within the counted hours, at most once an hour, and remembers a server's "wait" across restarts.
- **`api.net.request`:** a mod can read a server that sends no CORS headers, through the loader, only at an address one of its own settings holds. The mod's page in the panel shows where it talks.

## 3.5.0 — 2026-10-02

### Added

- BetterSlack's icon in the Dock on macOS: the mark on a white plate, on BetterSlack.app and on the Slack it launches. Putting it on Slack needs the App Management permission, which BetterSlack asks for once, with a button to the right pane in System Settings; the About tab offers it again.
- A theme can bring its own app icon and start screen (`--betterslack-app-icon`, `--betterslack-splash-*`). Switching to one that changes the icon offers to relaunch BetterSlack, since macOS shows a running app's new icon only after a restart.
- **Windows XP 1.1.0:** its own icon, the mark drawn in Luna, and XP's boot screen while Slack starts.

### Fixed

- **splash:** a theme's start screen is on the very first frame, rather than BetterSlack's own screen first.
- **custom-sounds:** when another sound setting comes to share a custom sound's base sound, the custom one moves to a free sound, so the two no longer both play your file.
- **history:** no longer writes edited message text to the log.

### Other

- Dead and duplicated code removed across the loader, the runtime and five mods; the documentation describes the current behaviour only, and stale statements in it are corrected.

## 3.4.2 — 2026-10-02

### Added

- **sidebar-account:** your face and name open your conversation with yourself

### Fixed

- **runtime:** installing from Browse takes the published version

## 3.4.1 — 2026-10-02

### Added

- **panel:** check for updates by hand, from the About tab

### Fixed

- **custom-sounds:** "None" can be chosen on a list that opens at its bottom
- **custom-sounds:** a picker opens at once, with "None" in it
- **custom-sounds:** "None" is always offered, and Preferences no longer jumps
- **custom-sounds:** notification sounds play your file on a Mac
- **loader:** a Slack preference reaches the layer Slack rebuilds from

## 3.4.0 — 2026-10-01

### Added

- **plugins:** Custom Sounds, your own files in every sound list
- **api:** api.data, a folder of files per mod

### Fixed

- **demo-mode:** redesigned link previews and Preferences' lists are swept
- **api:** a menu too long for either side scrolls, and follows a resize

## 3.3.0 — 2026-10-01

### Added

- **themes:** Windows XP, in Luna Blue, Olive Green and Silver

## 3.2.1 — 2026-10-01

### Fixed

- **loader:** Slack answers for its own microphone on macOS
- **app:** a call no longer kills Slack on macOS

## 3.2.0 — 2026-08-25

### History works everywhere now

The plugin only knew what your client had drawn, so anything that happened
while you were in another channel was simply missing. It listens to Slack's own
realtime connection instead: a message edited or deleted, a reaction taken
back, somebody renaming a channel or changing their status, in **any**
conversation you are in — open or not, in the workspace on screen or not.

**Nothing is marked as read by any of it.** Being told a message exists is not
opening it, which is the whole reason this is not a plugin that visits your
conversations to look at them.

- **An edited message answers for itself.** Slack's own *(edited)* is now the
  way in: click it and what the message used to say unfolds underneath, each
  wording with the time it was written.
- **A deleted message stays where it was**, struck through, with the face and
  the name of whoever wrote it, in Slack's own message layout — so your theme
  styles it like everything else.
- **A reaction says who.** Reading the screen never could; the connection does.
  A reaction nobody can be named for is not recorded at all.
- **Messages are drawn the way Slack draws them** — mentions as names, channels
  as links you can click, emoji as emoji, bold as bold.
- **What an app does to its own messages is ignored**, so a deploy bot
  rewriting the same line all day no longer fills the page. There is a setting
  if you want it.
- **Each card can be forgotten on its own**, beside the button that clears
  everything.

### Everything keeps working when you switch workspace

Slack does not reload when you change workspace, so anything a mod remembered
belonged to the one you left. Four were quietly wrong and are fixed: the
account strip showed the previous workspace's profile, channel notes could
surface under someone else's channel, and two plugins served people and
profiles from the workspace you had gone from.

### Every setting is translated

Mods are required to ship English and French, and the forms you actually change
things in were English only — all of them. That is fixed, and a test now
refuses a mod that does it again.

### For people writing mods

- `api.slack.events` — Slack's realtime events, as named listeners:
  `onMessage`, `onMessageChanged`, `onMessageDeleted`, `onReaction`,
  `onMembership`, `onConversation`, `onUserChanged`, `onPresence`, and more.
- `api.slack.onTeamChange` — the workspace changed under you; drop what you
  cached.
- `api.slack.renderMrkdwn` — Slack's own markup, drawn rather than shown raw.
- `api.helpers.disclosure` — make something Slack already draws open and close,
  with a caret and a panel that folds. Motion animates it if it is installed.
- `api.slack.addMessageAction` takes a `when`, so a button only appears on the
  messages it has something to say about.

## 3.1.1 — 2026-08-24

### Fixed

- **3.1.0 could not be installed.** `pnpm-workspace.yaml` had lost the key that
  lets esbuild run its install script, so a fresh checkout — which is what
  `install.sh` makes — stopped with `ERR_PNPM_IGNORED_BUILDS: esbuild` before
  it could build anything. An existing install is unaffected; if you took 3.1.0
  and it would not build, this is why, and running the installer again is all
  it needs.

  The key was removed on the strength of a note claiming pnpm does not read it.
  Measured instead, against the pnpm this project pins, one key at a time:
  `allowBuilds` alone works, `onlyBuiltDependencies` alone fails with exactly
  that error, both work. The measurement is written down where the claim was.

## 3.1.0 — 2026-08-24

### Added

- **History, a new plugin: everything Slack changes and never tells you about.**
  A message rewritten, a message deleted, a reaction taken back, a channel or a
  sidebar section renamed, somebody changing their display name or their
  status, somebody joining or leaving. Slack does all of it silently, and the
  only person who notices is the one looking for something that is not where it
  was.

  It is a view of its own, with its tab in Slack's rail under Home and Activity:
  one page you can search across everything a row shows, filter by family and
  sort five ways, and a badge on the tab counting what has arrived since you
  last looked. A deleted message also stays where it was, struck through,
  instead of the gap closing over it.

  Everything is kept on your machine, in BetterSlack's own settings file,
  capped, and the page empties it. It makes no request except the ones it
  cannot avoid — the member list of the channel you are in and the statuses of
  people you have seen, both every five minutes and both switchable off.

  Two things it deliberately does not claim to know. Who took a reaction back:
  Slack says that only in a tooltip built on hover, in the reader's language and
  with names rather than ids, so the emoji and the count are what is recorded.
  And what somebody is called: the name drawn beside a message is doubled on
  some messages and not on others, so display names come from `users.info`
  rather than from the screen.

  It also knows what it cannot see, and says so rather than pretending to be a
  record: it reads the screen every second and a half, so anything that changed
  while you were in another channel was never on your screen and is not there.

- **`api.slack.addView`, for a mod that wants a whole view rather than a
  button.** The tab in Slack's rail beside its own, a page over the whole tab
  panel with only the workspace rail left beside it, one tab lit at a time, and
  clicking another of Slack's tabs to leave. It carries four pieces of Slack a
  mod should not have to: where the rail is and what an entry in it looks like,
  that the rail sits under the element this project has frozen the renderer
  next to twice, that the conversation stacks at `z-index: 201`, and that
  Slack's own tab has to be put out by hand because the route has not changed.

  What is under a view is hidden rather than covered, and that one is not a
  detail: covered, Slack keeps the conversation on screen and marks a message
  arriving in it as read while you are reading something else.

### Changed

- **Documentation is written once.** `docs/guide/` is the source — it is what
  the site publishes — and `docs/getting-started.md` is now the signpost to it
  rather than a second telling of the same three walkthroughs. The copies had
  already come apart: the guide's test example imported two functions the test
  harness does not export, so anyone following it got an import error.

- **A mod is held to the rule the panel has always been held to**: it may not
  ask for a translation key it does not have. Adding that check found that the
  key extraction had never looked at DevTools at all — that mod writes its
  table on one line, and an empty set compared equal to an empty set.

- **`api.slack.selectors` is what mods anchor on.** It was published and called
  by nothing while three mods wrote the same strings out by hand, which is the
  copy nobody updates when Slack renames something. The test harness handed
  mods an empty table, so a mod that did the right thing would have queried
  `undefined` and passed.

- **`api.slack.onProfilePane` is gone.** No mod called it, and an entry in the
  reference that nothing in the catalogue exercises is an entry nothing checks.

- **Dead code, dead CSS and dead files removed throughout**, and every "it used
  to be" in a comment turned back into the constraint it was evidence for. Two
  documentation examples were broken by copy and paste: `api.ui.confirm` reads
  `message`, not `body`, and a modal action takes `variant: 'primary'`.

### Fixed

- **The Pages workflow did not rebuild the site for a guide change.** Its
  `paths:` filter named `docs/api/` and not `docs/guide/`, so the one check
  that catches a stale page did not run for the change it exists to catch.

- **`pnpm-workspace.yaml` carried an `allowBuilds` key pnpm does not read**, and
  seven screenshots in `site/shots/mods` were byte-identical copies of frames
  the site build already writes, named by nothing and published to Pages.

## 3.0.5 — 2026-08-24

### Fixed

- **The account strip opened one tooltip on its status emoji, not several.**
  It keeps a single button and re-describes it whenever your status changes, and
  each description was left attached — so after a few changes, hovering the
  emoji opened a stack of them. Describing an element now replaces whatever was
  there.

## 3.0.4 — 2026-08-24

### Added

- **Hovering a status emoji says what it means.** The member column and the
  account strip show a status as a picture and nothing else — there is no room
  for the sentence in a row that narrow — so hovering one now opens the tooltip
  Slack's own sidebar opens: the emoji, the status, and when it runs out. It
  wraps at the width Slack's does, and the emoji in the strip opens one tooltip
  rather than two.

### Fixed

- **A tooltip no longer keeps listeners while it is not on screen.** They are
  registered when it appears and removed when it goes, which matters because a
  tooltip is attached per element and the member column builds one per row: on a
  page that scrolls as much as Slack does, the old ones added up.

## 3.0.3 — 2026-08-21

### Fixed

- **Updating from the panel failed with "the update could not be built here"**
  on any machine whose Node is a 25. corepack was removed from Node in that
  version — its `bin` holds `node`, `npm` and `npx` and nothing else — and the
  update built itself with `corepack pnpm`. It now falls back to `npx` and the
  pinned pnpm, which needs nothing the machine has not already got.

  **If you are seeing that message, this release cannot reach you through the
  update button.** The button builds the new version using the code that is
  already running, so the fault is in the copy doing the updating. Run the
  installer once and it is over:

  ```bash
  cd <where you cloned BetterSlack> && ./install.sh
  ```

  Updating from the panel works normally after that. Nothing you have installed
  or configured is touched — it lives in `~/.betterslack`, which the installer
  does not go near.

- **A failed update now says what went wrong.** The message put the command that
  failed on screen and threw away the line underneath it, which was the reason.
  That is why the fault above read as a shrug rather than as three words you
  could have searched for.

## 3.0.2 — 2026-08-21

### Changed

- **The start screen is animated properly now.** The mark on it is a drawn loop
  rather than one assembled out of the SVG's own shapes. It plays with a
  transparent background over whatever your theme paints, and falls back to the
  still mark if it cannot be played — including when your machine has asked for
  reduced motion, where it is deliberately not played at all.

### Fixed

- **The start screen drew the mark wrong while it animated.** Three of its four
  arms are placed by a transform attribute, and a CSS transform replaces that
  rather than adding to it, so those three jumped back to unrotated positions
  for as long as the animation ran. It looked like a logo coming apart, and was.

### Other

- A pushed tag now becomes a release on GitHub, with this file's section for
  that version as its notes. Nothing to copy by hand.

## 3.0.1 — 2026-08-21

### Added

- **runtime:** a start screen, up until the last mod is in
- **panel:** the mark at the head of the dialog
- **panel:** two shelves and a sort, and each notice on its tab
- **updates:** a badge for anything out of date, refreshed hourly

### Fixed

- **panel:** focus is a border, not a halo
- **updates:** say which version, not how many commits
- **member-sidebar:** a mod that meant to touch channels broke four Slack views
- **install:** a Node that passes engines may still not run pnpm

### Changed

- **panel:** borrow Slack's field and Slack's select

### Documentation

- the registry a client reads can lag a release, and why

## 3.0.0 — 2026-08-21

Installing BetterSlack is one script now, and a mod can say which BetterSlack
it needs.

Nothing in the plugin API changed: `betterslackApi` is still 1, and no method
was removed or renamed. The major number is about the front door — where an
install lives and how you get one.

### Installing

- **`./install.sh` on macOS and Linux, `install.ps1` on Windows.** Clone the
  repository, run it, done. Nothing has to be installed first — not Node, not
  pnpm. If the machine has no Node recent enough, the installer fetches the
  current LTS from nodejs.org, checks it against the digest published beside it,
  and keeps it to itself: nothing is added to your `PATH` and no other project
  sees it.
- **An install lives in `~/.betterslack/app` and weighs about 6 MB.** It does not
  refer back to the clone, so the clone can be deleted once the installer has
  run. Keep it only to work on BetterSlack itself.
- **Linux and Windows have launchers at last.** Linux gets an applications-menu
  entry and a `betterslack` command; Windows gets a Start menu shortcut, plus a
  `.cmd` to run from a terminal when you want to watch it work. Everything is
  written under your home directory.
- **`pnpm build-app` is gone.** The installer builds the macOS app itself. Every
  remaining `pnpm` command is for working on BetterSlack, not for using it.
- Updating is running the installer again. Uninstalling is deleting
  `~/.betterslack` and the launcher.

### Mods say which BetterSlack they need

- **Worked out from the API a mod calls**, not written down and forgotten. Every
  entry in the reference now records the release it arrived in, and a mod's
  floor is the highest of the ones it touches.
- **An update that needs a newer BetterSlack is refused, and says so** — naming
  the version wanted and the version you have. A mod updates itself out of the
  catalogue into whatever version you are running, so before this a mod that
  started calling something new simply broke on the first click, with an error
  that read as "this plugin is broken".
- **`slackVersion` is compared.** Every mod declared the Slack it was written
  against and nothing ever read it. A mod's page now says so when it names a
  Slack newer than the one running — and says nothing where the running version
  cannot be read honestly, rather than inventing a mismatch.

### Fixed

- **The macOS app could do nothing at all when you double-clicked it.** It ran
  the first `node` on the launcher's `PATH`, which on a machine with nvm is
  whatever `default` points at — frequently a version too old to parse
  BetterSlack, which then died on a syntax error into a log file nothing puts on
  screen. A Node is chosen by version now, and when none is suitable you get a
  dialog naming what is needed instead of silence.
- **BetterSlack reported version 2.0.0 whatever it was.** The number was a
  constant `pnpm release` never touched, and the update check compares it
  against the published one: it announced an update permanently, and installing
  that update could never clear it.
- **A failed update no longer gives its entire command line as the reason**, and
  it puts a working copy in place rather than refusing when the version being
  moved to predates the new install layout.
- **Instructions naming commands that do not exist**: the launcher's own dialog
  pointed at `pnpm build-app --install`, `pnpm new-mod` ended by telling authors
  to run `pnpm test:mod`, which has never been a script, and an install with no
  source tree was told to rebuild itself.

### Upgrading from 2.x

- Run `./install.sh` once. An app bundle built the old way keeps working from
  its checkout, but the checkout-anchored layout is no longer what anything
  describes, and the installer replaces it in place.
- If you scripted `pnpm build-app`, call `./install.sh` instead.
- Mods need no changes.

## 2.1.0 — 2026-08-19

### Added

- **themes:** settings, without a theme running any code
- **member-sidebar:** drag its edge, with Slack's own handle
- draw the list you saw last time, and confirm it behind you
- **palette:** say it is still looking, instead of that nothing matches
- the mark you drew, everywhere the old one was
- **build-app:** install into /Applications, asking for root only if refused
- **palette:** people carry their status, and a menu draws above its dialog
- **panel:** say which mod folders were skipped, and let the list be sorted
- **sidebar-account:** the status emoji opens Slack's own status dialog
- **slack:** statuses, emoji and all, in both mods that show people
- drop Focus Mode, rebuild Discord Light on Discord Dark

### Fixed

- read the workspace the client is showing, not the one the URL names
- an attribute filter that left out the one attribute that changes
- **member-sidebar:** drop an answer that arrived after the workspace moved
- **runtime:** our stylesheets before the plugins, and statuses that update
- **sidebar-account:** the status emoji was being drawn as your face
- **site:** the doc list is a drawer on a phone, not a 220px window
- **site:** the knobs are a list, not a boxed grid
- **site:** the tab says Doc, and five code blocks were never coloured
- **panel:** the update notice was a stripe, and updating looked broken

### Documentation

- **api:** currentTeamId, and why it is not a regex over the URL
- **api:** audit all 96 entries, and date every page
- describe the current state, and say which Applications folder
- a guide on the doc page, and answers to two fair questions

### Other

- **catalog:** the reason a mod was refused has to reach the person

## 2.0.1 — 2026-08-19

### Added

- update CLAUDE.md, pnpm-workspace.yaml, and .nvmrc
- **site:** the API reference is one page, one panel at a time, and it renders Slack's own widgets
- **site:** the API page is a playground, and the navbar is three things
- **site:** an API reference generated from the API, with the kit running on the page
- **demo-mode:** a camera beside the switch
- **demo-mode:** a switch in the top bar, off until you press it
- **demo-mode:** a Slack full of people who do not exist
- **site:** the catalogue shows every mod, not only the themes
- **panel:** every mod has a page
- **shots:** one picture per mod, taken in a real Slack and emptied of it
- **catalogue:** a mod can describe itself properly

### Fixed

- **ci:** both jobs were broken by something other than the code
- **site:** the API list would not scroll, and the demos read like a component library now
- **site:** the page was laid out 569px wide on a 390px screen
- **build-app:** the app cannot live in the folder it is not allowed to read
- **build-app:** compile the launcher, so macOS treats it as an application
- **build-app:** the guard that explains a failure was why nothing was explained
- **build-app:** say why the launcher cannot read its own repository

### Changed

- **api:** the markdown is the source, and the page is built from it
- **shots:** WebP everywhere, and Chromium is the encoder

### Documentation

- audit every claim against the code it describes
- **api:** finish the folder — real descriptions, the tools back, and 67 previews
- the screenshot pipeline, the mod page, and what the audit found

### Other

- Fix site & documentation
- one command before pushing, and three package.json entries that were noise
- delete what nothing could reach, and give seven mods a second frame

