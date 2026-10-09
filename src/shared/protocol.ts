// Wire format shared by the loader (Node) and the runtime (renderer).
//
// Renderer -> loader travels through a CDP Runtime binding, loader -> renderer
// through Runtime.evaluate. Both directions are plain JSON strings, so nothing
// here may reference Node or DOM types.

export const BINDING_NAME = '__betterslackSend';
export const RECEIVER_NAME = '__betterslackRecv';
export const MOD_API_VERSION = 1;

export type ModType = 'theme' | 'plugin';

export interface ModManifest {
  id: string;
  name: string;
  type: ModType;
  version: string;
  author: string;
  description: string;
  /** File to load, relative to the mod directory: a .css for themes, .js for plugins. */
  entry: string;
  /**
   * Themes only: plugin ids this theme needs to look right.
   *
   * A theme is CSS and nothing else. When a look genuinely needs behaviour --
   * reading who is signed in, adding a column Slack does not have -- that
   * behaviour belongs in a plugin, which is reviewed and installed as one, and
   * the theme points at it here. The panel offers to install and enable them
   * with the theme, and says so plainly when one is missing.
   *
   * Only themes may declare this, and only plugin ids, so there is no way to
   * build a cycle.
   */
  requires?: string[];
  /**
   * Settings the panel should offer, and their defaults.
   *
   * A mod reads the same keys through `api.settings`; this only says what the
   * panel should draw and what the value is when nobody has chosen one. Before
   * this, every adjustable thing was either a constant in the source or a
   * control the mod had to build for itself, which is why almost none of them
   * were adjustable at all.
   */
  settings?: ModSettingField[];

  /**
   * Plugins only: which of its settings hold an address `api.net` may reach.
   *
   * A page cannot read the answer of a server that sends no CORS headers, so
   * `api.net` has the loader make the request -- and the loader only makes it
   * to an address held by one of the settings named here. A reviewer reads one
   * line to know where a mod can talk; the address itself is the user's, typed
   * and shown in the panel like any other setting.
   *
   * Every key must be a declared `text` setting.
   */
  network?: { settings: string[] };

  /**
   * Catalogue mods only: installed and switched on for everybody, once.
   *
   * The repository is a catalogue and a fresh install starts empty -- except
   * for what is marked here. The loader checks at every start for a marked mod
   * it has never offered this person (`Settings.seeded`), installs it, switches
   * it on and writes it down, so a first install and an update that brings a
   * new marked mod both end with it running. Written down rather than
   * re-applied: somebody who then switches it off has said so, and the next
   * start does not switch it back on.
   *
   * Honoured for `builtin` mods only. A folder somebody else wrote does not get
   * to turn itself on.
   */
  defaultEnabled?: boolean;

  /**
   * Which of its settings holds lines the start screen may show.
   *
   * The start screen is up from the first frame, long before any plugin has
   * run, so a mod cannot put words on it by calling something -- by the time
   * it could, the screen is coming down. It names a setting instead, and the
   * runtime reads that setting's value (or its default) out of the boot
   * payload: one line of it, at random, under the mark. Every enabled mod
   * that names one is pooled.
   *
   * The key must be a declared `textarea` setting: one line per entry is the
   * shape, and the panel is where the user edits it.
   */
  splash?: { setting: string };

  /**
   * A square mark for the mod, as a file in its folder -- `icon.svg`.
   *
   * SVG rather than a bitmap: it is drawn at four sizes between the panel's
   * rows and the site's cards, it has to sit on both a light and a dark
   * surface, and `currentColor` lets it take the theme's ink for free. The
   * catalogue inlines its markup, so a row can draw it before the mod is
   * installed.
   */
  icon?: string;

  /**
   * The one-liner in other languages, keyed the way `api.i18n` keys anything.
   *
   * `description` stays required and is the English one: it is what the
   * catalogue, the site and the pull request template all read, and a mod that
   * described itself only in a language the reader does not have would be a
   * mod nobody installs.
   */
  descriptions?: Record<string, string>;

  /**
   * Pictures of it working, in the mod's own folder.
   *
   * Fetched only when somebody opens the mod, since a catalogue that carried
   * twenty screenshots would be a megabyte before anybody asked for one.
   */
  screenshots?: Array<{
    file: string;
    caption?: string;
    captions?: Record<string, string>;
  }>;

  /**
   * A markdown file in the mod's folder, rendered in the panel and on the site.
   *
   * The description says what a user gets in a sentence; this is where the
   * rest goes -- what it does not do, what it costs, which setting to reach
   * for. `readmes` names the translations, the same way `descriptions` does.
   */
  readme?: string;
  readmes?: Record<string, string>;

  /** Manifest schema version. Mods declaring a newer version are refused. */
  betterslackApi: number;
  /** Optional: minimum tested Slack version, informational only. */
  slackVersion?: string;
  /**
   * The oldest BetterSlack this mod can run on.
   *
   * Normally absent and computed instead -- scripts/api-floor.mjs reads what the
   * mod calls and the registry publishes the answer, because a hand-written
   * floor is the field everyone forgets. Declaring one here may *raise* that
   * answer, for what reading the source cannot see, and validate-mods refuses a
   * declaration below it.
   */
  needsBetterSlack?: string;
  tags?: string[];
}

/**
 * A mod's files, keyed by path relative to its folder.
 *
 * Mods are folders, not files: `index.js` may import `./colour.js`, and a theme
 * may `@import './rail.css'`. The loader reads the whole folder and the runtime
 * stitches it back together, because the alternative -- one file per mod -- is
 * what made the theme builder a two-thousand-line wall.
 */
export type ModFiles = Record<string, string>;

/**
 * What the catalogue carries beyond the manifest: the small things a row or a
 * card needs before anybody installs anything.
 *
 * Inlined because they are text and they are tiny -- an icon is a few hundred
 * bytes and a readme a few thousand. Screenshots are neither, and are fetched
 * one at a time through `mods.asset`.
 */
export interface ModAssets {
  iconSvg?: string;
  readmeText?: string;
  readmeTexts?: Record<string, string>;
}

/**
 * One setting, as the panel will draw it.
 *
 * Deliberately few types. Anything a mod can express with a checkbox, a number,
 * a word, a colour or a choice belongs here; anything more belongs in the mod's
 * own window, where it can be explained properly.
 *
 * `cssVar` is how a **theme** has settings at all. A theme is CSS and runs no
 * code -- that is the rule, and a `script` field was built once and removed for
 * being a second, weaker plugin model -- so a theme cannot read a value and act
 * on it. It names the custom property instead, and the runtime writes
 * `:root { <cssVar>: <value> }` after the theme's own stylesheet. The theme is
 * still only CSS; the panel does the writing.
 *
 * Plugins may declare it too, and it costs them nothing to ignore: they read
 * the same key through `api.settings` as they always did.
 */
/**
 * The words on a setting, in the reader's language.
 *
 * Same shape as `descriptions` and `readmes` on the manifest, and for the same
 * reason: a mod is required to speak English and French, and its settings are
 * the half of it a reader meets while changing something. English stays
 * required and is the fallback -- a setting labelled only in a language the
 * reader has not got is a control nobody dares touch.
 */
export interface Localised {
  labels?: Record<string, string>;
  hints?: Record<string, string>;
}

export type ModSettingField = Localised & (
  | { key: string; type: 'boolean'; label: string; hint?: string; default?: boolean }
  | {
    key: string;
    type: 'number';
    label: string;
    hint?: string;
    default?: number;
    min?: number;
    max?: number;
    step?: number;
  }
  | {
    key: string;
    type: 'text';
    label: string;
    hint?: string;
    default?: string;
    placeholder?: string;
    cssVar?: string;
  }
  | { key: string; type: 'colour'; label: string; hint?: string; default?: string; cssVar?: string }
  /*
   * Several lines of text. Drawn as a textarea under its label rather than
   * beside it, with a button that opens the same text in a dialog -- a list of
   * a hundred lines is not edited through a box six lines tall.
   */
  | {
    key: string;
    type: 'textarea';
    label: string;
    hint?: string;
    default?: string;
    placeholder?: string;
  }
  | {
    key: string;
    type: 'choice';
    label: string;
    hint?: string;
    default?: string;
    options: Array<{ value: string; label: string; labels?: Record<string, string> }>;
  }
);

/** What a mod from outside this repository looks like before it is installed. */
export interface RemoteMod {
  manifest: ModManifest;
  files: ModFiles;
  /** owner/name, for the record and for the warning. */
  repo: string;
  /** Where in it the mod was found. */
  folder: string;
  /** Files that will be executed, so the number is not a surprise. */
  scripts: string[];
  /** Total size, because "one small mod" and 400kB are different things. */
  bytes: number;
}

export interface ModRecord extends ModManifest, ModAssets {
  /**
   * Where the mod came from.
   *
   * `builtin` = shipped in this repository, so it went through review.
   * `installed` = written by the user or installed from the catalogue.
   * `third-party` = fetched from somebody else's repository, which nobody here
   * has read. The panel says so, permanently, on the row.
   */
  origin: 'builtin' | 'installed' | 'third-party';
  /** For a third-party mod: where it came from, shown wherever it is listed. */
  source?: string;
  /** Path relative to the mods root, e.g. "themes/midnight". */
  path: string;
}

/**
 * A Slack desktop preference a mod is allowed to read and write.
 *
 * `restart` says the value is read when a window is created, so it cannot take
 * effect in place; `defaults` says it must be mirrored into Slack's own
 * defaults snapshot, which is what it falls back to.
 */
export interface SlackPref {
  key: string;
  type: 'boolean' | 'string' | 'number';
  restart: boolean;
  defaults: boolean;
  note: string;
}

/**
 * The preferences BetterSlack will touch, and nothing else.
 *
 * Slack's `root-state.json` is not a preferences file: it also holds the
 * workspaces you are signed in to and how to reach them. A plugin runs
 * unsandboxed in an authenticated Slack, so this is a named list rather than
 * "the settings object" -- the loader refuses any other key by name, which is
 * a better failure than a mod quietly writing somewhere it should not.
 *
 * Shared rather than duplicated: the loader enforces it, `api.slack.desktop`
 * publishes it, and one list means a key cannot be offered and then refused.
 */
export const SLACK_PREFS: readonly SlackPref[] = [
  { key: 'windowVibrancy', type: 'boolean', restart: true, defaults: true, note: 'A translucent window: macOS vibrancy, Windows 11 acrylic. Off by default.' },
  { key: 'userTheme', type: 'string', restart: false, defaults: false, note: 'Slack\'s own light/dark choice.' },
  { key: 'systemThemeSyncEnabled', type: 'boolean', restart: false, defaults: false, note: 'Follow the operating system\'s light/dark setting.' },
  { key: 'launchOnStartup', type: 'boolean', restart: false, defaults: false, note: 'Start Slack when you sign in.' },
  { key: 'runFromTray', type: 'boolean', restart: false, defaults: false, note: 'Keep Slack in the menu bar or tray when its window closes.' },
  { key: 'hideOnStartup', type: 'boolean', restart: false, defaults: false, note: 'Start without showing the window.' },
  { key: 'autoHideMenuBar', type: 'boolean', restart: false, defaults: false, note: 'Windows and Linux: hide the menu bar until Alt.' },
  { key: 'useHwAcceleration', type: 'boolean', restart: true, defaults: true, note: 'GPU acceleration.' },
  { key: 'shouldUseHighContrastColors', type: 'boolean', restart: false, defaults: false, note: 'Higher-contrast colours throughout.' },
  { key: 'spellcheckerLanguage', type: 'string', restart: false, defaults: false, note: 'Language tag the spell checker uses.' },
  { key: 'notificationMethod', type: 'string', restart: true, defaults: false, note: 'How desktop notifications are delivered. Read by the main process at launch.' },
  { key: 'notificationPlayback', type: 'string', restart: true, defaults: false, note: 'Who plays a notification\'s sound: "web" is Slack, in the page; "system" hands it to the operating system with the files Slack ships. Read at launch -- and on macOS 12 and later Slack forces "system" at every launch, so a value written here does not survive there.' },
  { key: 'zoomLevel', type: 'number', restart: true, defaults: false, note: 'Interface zoom, in Chromium steps.' },
];

export interface Settings {
  /**
   * Mod ids the user has installed. The repository is a catalogue, not a set of
   * pre-installed mods: a fresh install starts with only the mods marked
   * `defaultEnabled` and you install what you want. `enabled` is always a
   * subset of this.
   */
  installed: string[];
  /** Mod ids that are currently on. */
  enabled: string[];
  /** Per-mod key/value bags, owned by the mod itself. */
  modSettings: Record<string, Record<string, unknown>>;
  /** User's own CSS, applied last so it always wins. */
  customCss: string;
  /** Reapply mods automatically when their file changes on disk. */
  hotReload: boolean;
  /**
   * How the panel orders a shelf: `recent`, `az`, `za` or `enabled`.
   *
   * Kept here rather than in the panel, because it is a preference and not a
   * filter -- somebody who wants their list alphabetical wants it alphabetical
   * tomorrow too. The search box and the tag chips are the other way round and
   * stay where they are: you clear those.
   *
   * A string rather than a union, so a settings file written by a newer build
   * cannot make an older one refuse to parse: the panel falls back to the
   * default when it does not recognise the value.
   */
  panelSort?: string;
  /**
   * Consecutive failures per mod, cleared as soon as one applies cleanly.
   *
   * A mod that throws on start is skipped after the second time rather than
   * being retried at every launch: a broken mod should cost you one bad start,
   * not every start.
   */
  modFailures?: Record<string, number>;
  /**
   * Slack's own desktop preferences, as BetterSlack keeps them.
   *
   * Slack has this built in and switched off: on macOS its main process passes
   * `vibrancy: "titlebar"` -- and drops the opaque `backgroundColor` -- when
   * `settings.windowVibrancy` is true in its own root-state.json, and on
   * Windows 11 the same flag turns on `backgroundMaterial: "acrylic"` with
   * `transparent: true`. That file is plain JSON in Application Support, well
   * outside the signed `app.asar`, so this changes a preference rather than
   * patching anything.
   *
   * Only the keys a mod has actually set are in here, and only keys from the
   * allow-list in `src/loader/slack-settings.ts` -- that file holds a great
   * deal more than preferences, including the workspaces you are signed in to.
   * The loader writes them through as they change and again before every
   * launch, so "set" means "keep it this way" rather than "poke it once".
   */
  slackPrefs?: Record<string, unknown>;
  /**
   * Whether BetterSlack has already asked for App Management, which putting
   * its icon on Slack's Dock tile needs. Asked once at startup; the About tab
   * offers it again for anyone who said later.
   */
  dockIconAsked?: boolean;
  /**
   * Catalogue mods marked `defaultEnabled` that have already been installed
   * and switched on for this person, once.
   *
   * What makes "on by default" a default rather than a rule: a mod in here is
   * never switched on again by the loader, so switching it off or removing it
   * holds across every later start and update.
   */
  seeded?: string[];
}

/** Whether Slack's Dock tile wears BetterSlack's icon, as `app.dockIcon` answers. */
export type DockIconState = 'ok' | 'refused' | 'unsupported';

export const DEFAULT_SETTINGS: Settings = {
  installed: [],
  enabled: [],
  modSettings: {},
  customCss: '',
  hotReload: true,
  panelSort: 'recent',
  modFailures: {},
  slackPrefs: {},
};

/** Requirements of `manifest` that are not currently enabled. */
export function missingRequirements(manifest: ModManifest, settings: Settings): string[] {
  return (manifest.requires ?? []).filter((id) => !settings.enabled.includes(id));
}

/** Requests the renderer sends to the loader. */
export type Request =
  /**
   * Stop Slack and start it again, keeping this loader.
   *
   * For the settings that are read when a window is created and can therefore
   * never take effect in place. The renderer asking for this is about to be
   * torn down with the page, so the answer goes out before anything happens.
   */
  /** One file out of a mod's folder, as a data URL. For screenshots. */
  | { type: 'mods.asset'; id: string; file: string }
  | { type: 'slack.restart' }
  | { type: 'settings.set'; settings: Partial<Settings> }
  /**
   * Deliberately granular. Sending the whole `enabled` array back would make
   * two Slack windows overwrite each other: whichever wrote last would erase
   * anything the other had turned on since it last read.
   */
  | { type: 'mod.enable'; id: string; enabled: boolean }
  /** Add or remove a catalogue mod from the installed set. */
  | { type: 'mod.setInstalled'; id: string; installed: boolean }
  /** Every file of a mod, keyed by relative path. */
  | { type: 'mod.source'; id: string }
  /** `source` marks it as coming from outside this repository, for good. */
  | { type: 'mod.install'; id: string; manifest: ModManifest; files: ModFiles; source?: string }
  | { type: 'mod.uninstall'; id: string }
  /**
   * Fetch a URL and save it. The renderer cannot do this itself: Slack's CDN
   * serves avatars without CORS headers, so `fetch` from the page fails even
   * though an <img> loads fine. The loader has no such restriction.
   */
  | { type: 'file.download'; url: string; filename: string }
  /**
   * A mod's own files, under ~/.betterslack/data/<id>/. `id` is filled in by
   * the runtime from the mod making the call, never by the mod, so one mod
   * cannot reach another's folder. Bytes travel as base64: the bridge is JSON.
   */
  | { type: 'data.write'; id: string; name: string; base64: string }
  | { type: 'data.read'; id: string; name: string }
  | { type: 'data.list'; id: string }
  | { type: 'data.remove'; id: string; name: string }
  /**
   * One HTTP request on a mod's behalf, to an address held by one of the
   * settings its manifest names under `network`. The rules are in
   * `loader/net.ts`; the answer is a `NetResult`.
   */
  | { type: 'net.request'; modId: string; url: string; method?: 'GET' | 'POST'; form?: Record<string, string> }
  /**
   * Photograph the window and put the picture in the download folder.
   *
   * The renderer cannot photograph itself, so this is the loader doing it over
   * CDP -- the same call `pnpm shoot` makes, at the same forced size, which is
   * the only way to get a frame the site and the READMEs can use without
   * cropping it afterwards.
   */
  | { type: 'app.screenshot'; size?: string; filename?: string }
  /** Pull, rebuild and relaunch. Answers before it restarts, or with why not. */
  | { type: 'app.update' }
  /**
   * The start screen's animation, as base64.
   *
   * Asked for rather than shipped in the boot payload: that payload and the
   * runtime bundle are both injected at document-start on every navigation, and
   * ~95kB of video does not belong in either. The screen draws the still mark
   * until this answers, which is a few milliseconds later.
   */
  | { type: 'app.art' }
  /**
   * Slack's Dock tile on macOS. `status` answers whether Slack.app took the
   * icon at its last launch; `settings` opens App Management in System
   * Settings, the permission writing into Slack.app needs; `retry` tries again
   * now, so the answer to "did that work" does not wait for the next launch.
   */
  | { type: 'app.dockIcon'; action?: 'status' | 'settings' | 'retry' }
  /**
   * Start BetterSlack again, launcher and all, when it was started from
   * BetterSlack.app -- the only way its own Dock tile takes a new icon, since
   * the Dock draws a running app with the icon it launched with. Otherwise,
   * from a checkout, just Slack.
   */
  | { type: 'app.relaunch' }
  /** Everything in ~/.betterslack worth keeping, as one JSON document. */
  | { type: 'backup.export' }
  /** Put one back. Replaces settings and user mods; never touches the install. */
  | { type: 'backup.import'; archive: string }
  /**
   * Read a mod from a GitHub URL, without installing it.
   *
   * Two steps on purpose: this fetches and describes, the panel asks, and only
   * then does `mod.install` write anything. Consent has to come between reading
   * and installing, or it is not consent.
   */
  | { type: 'mods.inspectRemote'; url: string }
  /** Which installed mods have a newer version published. */
  | { type: 'mods.checkUpdates' }
  /**
   * Look for a newer BetterSlack and newer mods now, rather than at the next
   * hourly sweep. The answers also go out as the usual `update.status` and
   * `mods.updates` events, so every badge moves with them.
   */
  | { type: 'updates.check' }
  /** Fetch one mod's folder from the branch and install it over the old one. */
  | { type: 'mods.update'; id: string }
  /** The renderer saying it got all the way up, which clears the crash marker. */
  | { type: 'app.ready' }
  /**
   * Which of Slack's own realtime events the renderer wants forwarded.
   *
   * A filter rather than a firehose, set by the runtime from what the enabled
   * mods have asked for, and re-sent whenever that changes. Empty means
   * nothing is forwarded at all, which is the state a client with no mod
   * listening should be in: the tap costs nothing when nobody is on it.
   */
  | { type: 'slack.watch'; types: string[] };

/**
 * What `net.request` answers with: the status and the parsed JSON body, or why
 * there is none.
 *
 * A failure is a value rather than a rejection. A rejection crosses the bridge
 * as a sentence, and a mod has to tell "the loader refused" from "the server is
 * down" from "it took too long" without matching on English.
 */
export type NetResult =
  | { status: number; json: unknown }
  | { error: NetError };

/**
 * - `blocked`: the address is not one this mod's `network` settings hold, or
 *   it is not https.
 * - `invalid`: the request itself is malformed -- a method or a form the
 *   loader does not send.
 * - `timeout`, `network`: the server did not answer, or could not be reached.
 * - `too-large`: the answer was bigger than the loader will hold.
 */
export type NetError = 'blocked' | 'invalid' | 'timeout' | 'network' | 'too-large';

/**
 * How long the loader waits on the server before answering `timeout`.
 *
 * Here rather than in the loader because the renderer has to wait longer than
 * this, or the bridge gives up first and the mod gets a rejection instead of an
 * answer. Long, because the server on the other end may itself be signing in
 * somewhere before it answers.
 */
export const NET_TIMEOUT_MS = 25_000;

/** Push notifications the loader sends to the renderer unprompted. */
export type Event =
  | { type: 'mod.changed'; id: string; files: ModFiles }
  | { type: 'catalog.changed'; mods: ModRecord[] }
  | { type: 'settings.changed'; settings: Settings }
  /** Sent once the version check finishes, which is after boot: it goes out on
   *  the network and nothing should wait for it. */
  | { type: 'update.status'; status: UpdateStatus }
  /**
   * Which installed mods have a newer version published.
   *
   * Pushed rather than only answered, because the thing it feeds is a badge:
   * something you are meant to notice without having gone looking. Asked for by
   * the panel instead, the only way to find out a mod had moved on would be to
   * open the panel and read, and the badge on the launcher could never count
   * them at all.
   */
  | { type: 'mods.updates'; updates: ModUpdate[] }
  /**
   * One of Slack's own realtime events, as Slack sent it.
   *
   * Slack keeps a socket per workspace and pushes everything that happens in
   * every conversation you are in down it -- a message, an edit, a deletion, a
   * reaction -- whether or not that conversation is open. It is how the unread
   * badges in the sidebar move without you looking. Reading it is passive:
   * being told about a message is not reading it, and nothing here ever sends
   * `conversations.mark`, so nothing is marked read.
   *
   * It arrives here rather than in the page because the page cannot see it.
   * The socket is opened by Slack's own bundle before anything else runs, so
   * patching `WebSocket` in the renderer catches nothing -- measured. The
   * loader reads the frames off the debugging protocol instead, which sees
   * them whatever the bundle does.
   *
   * The socket's URL carries the `xoxc` token, and it is never sent here or
   * logged anywhere: only the parsed frame travels, and only for the types the
   * renderer asked for.
   */
  | { type: 'slack.event'; event: SlackEvent };

/**
 * A frame off one of Slack's realtime sockets.
 *
 * Slack's own shape, passed through rather than translated: `type` and an
 * optional `subtype` (`message_changed`, `message_deleted`), a `channel`, and
 * for a reaction an `item` holding the message it is about. Everything else is
 * whatever Slack sent, because a translation layer here would be a second
 * place to keep in step with an API nobody publishes.
 */
export interface SlackEvent {
  type: string;
  subtype?: string;
  channel?: string;
  ts?: string;
  user?: string;
  /** The workspace the socket belongs to, which the frame itself may not say. */
  teamId?: string;
  [key: string]: unknown;
}

export interface Envelope {
  /** Correlation id; absent on pushed events. */
  rid?: number;
  payload: unknown;
}

/**
 * What the loader knows about this copy being current.
 *
 * `behind` is only ever true when the check is certain. Offline, on a fork, on
 * a branch that tracks nothing: all of those answer "do not know", and the
 * panel shows nothing rather than a badge nobody can act on.
 */
export interface UpdateStatus {
  kind: 'git' | 'package' | 'unknown';
  behind: boolean;
  commits?: number;
  /**
   * The published version, when it is genuinely newer than the one running.
   *
   * Filled in for both kinds of install, so the notice can say "3.1.0, and you
   * have 3.0.0" rather than counting commits at somebody who has never made
   * one. Absent when the branch has moved without the version moving with it,
   * which is the ordinary state of a default branch between releases -- there,
   * the count of changes is the only honest measure there is.
   */
  latest?: string;
  headline?: string;
  note?: string;
  updatable: boolean;
}

/**
 * One installed mod with a newer version on the default branch.
 *
 * Declared here rather than beside the check, since both sides read it: the
 * loader fills it in and the panel draws it.
 */
export interface ModUpdate {
  id: string;
  /** What is installed now. */
  from: string;
  /** What the branch has. */
  to: string;
  name: string;
  /** Which shelf it belongs to, so the panel can badge the right tab. */
  type: 'theme' | 'plugin';
  /**
   * Set when the new version needs a BetterSlack newer than this one.
   *
   * The update is still reported rather than hidden. A mod that quietly stops
   * updating is a mod the reader thinks is up to date; one that says "needs
   * 2.2.0, you have 2.1.0" tells them what to do about it.
   */
  blockedBy?: { needs: string; running: string };
}

export interface LoaderInfo {
  version: string;
  /**
   * Identifies one loader run. A runtime injected by a previous run survives in
   * the page after that loader exits, so the new one uses this to recognise a
   * stale instance and replace it instead of trusting its state.
   */
  sessionId: string;
  modsRoot: string;
  userModsRoot: string;
  /**
   * Mod folders that were found and refused, with the reason.
   *
   * A mod that fails to parse is dropped from the catalogue, so it is simply
   * not in Browse -- and the explanation only existed in the loader's terminal,
   * which is not where somebody wondering why a mod is missing is looking.
   * Carried here so the panel can say it where the mod would have been.
   */
  skipped: string[];
  slackPath: string;
  /**
   * The Slack this is, or null where it cannot be read honestly (Linux).
   *
   * Null means "say nothing": an unknown version compared against a mod's
   * declared one invents a mismatch, and a warning that fires where nothing is
   * wrong teaches people to ignore the one that is real.
   */
  slackVersion?: string | null;
  /** How the loader talks to Slack, shown in the About tab. */
  transport: string;
  /**
   * Nothing was applied this run.
   *
   * Either asked for (`--safe`) or decided: a run that never reported itself
   * healthy is assumed to have been taken down by a mod, and the next one comes
   * up bare so there is something to click. Twice now a mod has frozen the
   * renderer outright, and the only way out was killing Slack and editing the
   * settings file by hand.
   */
  safeMode: boolean;
  /** Why, when it was not asked for. */
  safeModeReason?: string;
  /** Where this copy lives, so the panel can say what it would update. */
  root: string;
  /**
   * Slack's desktop preferences as they were when this Slack was launched.
   *
   * Not the same as what is wanted now: several of them -- the window's
   * material above all -- are read when a window is created, so the two
   * disagree exactly when a restart would change something. That is the only
   * honest moment to offer one.
   */
  slackPrefsAtLaunch: Record<string, unknown>;
}

/**
 * Is `wanted` a later Slack than `have`?
 *
 * Compared over the components `wanted` actually states, so a mod that says
 * 4.51 is satisfied by 4.51.191 -- mods declare two parts and Slack ships
 * three, and a plain string or full-length compare would call every one of them
 * a mismatch. `have` being null or unparseable answers false: unknown is not
 * out of date.
 */
export function slackVersionIsNewer(wanted: string, have: string | null | undefined): boolean {
  if (!have) return false;
  const a = wanted.split('.').map((part) => Number.parseInt(part, 10));
  const b = have.split('.').map((part) => Number.parseInt(part, 10));
  if (a.some(Number.isNaN) || b.some(Number.isNaN)) return false;
  for (let i = 0; i < a.length; i += 1) {
    if ((b[i] ?? 0) !== a[i]) return (b[i] ?? 0) < a[i]!;
  }
  return false;
}
