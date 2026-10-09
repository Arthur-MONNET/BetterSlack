// BetterSlack loader.
//
// Starts Slack with a debugging port, attaches over CDP and injects the runtime
// into every Slack client target. Everything the renderer cannot do for itself
// (touch the filesystem, run code the page CSP would refuse) is served from
// here over a Runtime binding.

import { execFile, spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { CdpConnection, CdpSession, sleep, waitForClientTarget, type TargetInfo } from './cdp.js';
import { Catalog, scanRoot, parseManifest } from './catalog.js';
import { downloadFile, saveBytes } from './download.js';
import { applyIcon, bundleOf, chooseIcon, clearIcon, launcherBundles } from './app-icon.js';
import { listData, readData, removeData, writeData } from './mod-data.js';
import { netRequest } from './net.js';
import { findSlack, launchSlack, SlackNotFoundError, stopSlack,
  slackVersion,
} from './slack.js';
import { applyDesktopPrefs, prefsSupported, readDesktopPrefs } from './slack-settings.js';
import { applyUpdate, checkForUpdate } from './update.js';
import {
  fetchModFiles, findModUpdates, folderFor, inspectRemote, manifestFrom,
  type ModUpdate,
  updateIsReachable,
} from './mod-updates.js';
// Shared with the runtime so a theme's @import behaves the same in Slack's
// other windows as it does in the client.
import { inlineCssImports } from '../runtime/themes.js';
// Inlined by the build: see the loader options in scripts/build.mjs.
import LOADER_ART from '../../assets/loader.webm';
import {
  ensureUserRoot,
  exportBackup,
  importBackup,
  lastBootFailed,
  markBootHealthy,
  markBootStarted,
  mergeSettings,
  readSettings,
  setModEnabled,
  setModInstalled,
  seedDefaultMods,
  USER_MODS_ROOT,
} from './store.js';
import {
  BINDING_NAME,
  RECEIVER_NAME,
  type DockIconState,
  type Envelope,
  type Event as PushEvent,
  type SlackEvent,
  type LoaderInfo,
  type ModRecord,
  type ModFiles,
  type Request,
  type UpdateStatus,
} from '../shared/protocol.js';

/** BETTERSLACK_VERBOSE=1 forwards everything the page logs, not only its errors. */
const verbose = process.env.BETTERSLACK_VERBOSE === '1';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const BUILTIN_MODS_ROOT = path.join(REPO_ROOT, 'mods');
const RUNTIME_BUNDLE = path.join(HERE, 'runtime.js');
/**
 * Written in by the build from package.json -- see scripts/build.mjs. A
 * constant here is one `pnpm release` does not bump, and the update check
 * compares it against the published package.json: a stale one reports an
 * update for ever and installing it changes nothing.
 */
declare const __BETTERSLACK_VERSION__: string;
const VERSION = __BETTERSLACK_VERSION__;

/** Where a copy of this checks whether it is current. */
/*
 * The repository, which every update check and every mod install goes through.
 *
 * Worth one line of care when it changes: a blanket search-and-replace once
 * pointed this at a repository that did not exist yet, and the failure mode is
 * an update button that quietly stops working rather than anything that looks
 * broken. GitHub redirects a renamed repository, so an older copy still
 * resolves.
 */
const REPO = 'AirOne-dev/BetterSlack';

/** How often the watchdog asks the renderer whether it is still there. */
const WATCHDOG_INTERVAL_MS = 30_000;
/**
 * How often to look for a newer BetterSlack and newer mods.
 *
 * An hour, and deliberately not less: what it feeds is a dot on a button, and
 * nobody acts on an update in the minute it is published. Slack is left running
 * for days, though, so it cannot be a one-shot at boot either.
 */
const UPDATE_SWEEP_MS = 60 * 60 * 1000;
const DEFAULT_BRANCH = 'master';

interface Args {
  verbose: boolean;
  /** Start with nothing applied, whatever the settings say. */
  safe: boolean;
  /** Boot, ask the runtime how it is, print it and leave. */
  healthcheck: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { verbose: false, safe: false, healthcheck: false };
  for (const a of argv) {
    if (a === '--verbose' || a === '-v') args.verbose = true;
    else if (a === '--safe') args.safe = true;
    else if (a === '--healthcheck') args.healthcheck = true;
    else if (a === '--help' || a === '-h') {
      console.log(
        `betterslack ${VERSION}\n\n` +
          `  --verbose   log every message crossing the bridge\n` +
          `  --safe      start with every mod off, and say so in the panel\n` +
          `  --healthcheck  boot, report what loaded, and exit (used by pnpm test:live)\n\n` +
          `BetterSlack starts Slack itself and talks to it over a private CDP pipe.\n` +
          `There is no debugging port, so no other process can reach the connection.\n`,
      );
      process.exit(0);
    }
  }
  return args;
}

interface Attachment {
  session: CdpSession;
  /** Identifier returned by Page.addScriptToEvaluateOnNewDocument, if any. */
  scriptId?: string;
  /** In-flight repair, so two load events cannot inject twice. */
  healing?: Promise<void>;
  /**
   * Which of Slack's realtime event types this renderer asked for.
   *
   * Empty until a mod asks, and the tap is not even switched on before then:
   * `Network.enable` is what makes Chromium report frames at all, so a client
   * with nothing listening does not pay for the machinery.
   */
  watch: Set<string>;
  /** Whether `Network.enable` has been sent on this session. */
  tapping?: boolean;
}

class Loader {
  private catalog: Catalog;
  /** Enabled mods already reported as unreadable, so the log says it once. */
  private reportedUnreadable = new Set<string>();
  private attachments = new Map<string, Attachment>();
  /**
   * Slack's other windows -- the huddle preview, mostly. They are separate
   * renderers, so nothing injected into the client reaches them, and they
   * would otherwise sit there in Slack's default colours in the middle of a
   * themed app. They get the stylesheet only: no runtime, no panel, no plugins.
   */
  private auxiliary = new Map<string, CdpSession>();
  private runtimeSource = '';
  private info!: LoaderInfo;
  /** Filled in once the version check answers; undefined until then. */
  private update: UpdateStatus | undefined;
  /** What the last mod-update sweep found, for a renderer that attaches later. */
  private modUpdates: ModUpdate[] = [];

  constructor(
    /*
     * Not readonly: restarting Slack replaces it. The alternative -- handing
     * over to a detached copy of the loader, as an update does -- works, but
     * it takes the terminal with it, and a restart offered from a settings
     * dialog should not cost you the log you are watching.
     */
    private connection: CdpConnection,
    private readonly slackPath: string,
    private readonly verbose: boolean,
    private readonly safeRequested: boolean = false,
    private readonly healthcheck: boolean = false,
    private slackPrefsAtLaunch: Record<string, unknown> = {},
    /** How to get a fresh Slack and a connection to it. Set by main(). */
    private relaunch: (() => Promise<CdpConnection>) | null = null,
  ) {
    this.catalog = new Catalog(BUILTIN_MODS_ROOT, USER_MODS_ROOT);
  }

  async start(): Promise<void> {
    this.runtimeSource = await fs.readFile(RUNTIME_BUNDLE, 'utf8');
    await ensureUserRoot();
    await this.catalog.refresh();
    for (const problem of this.catalog.errors) console.warn(`[betterslack] skipped mod - ${problem}`);

    /*
     * The catalogue's defaults, before anything reads the settings for the
     * bootstrap -- so a first start, and the first start after an update that
     * brought one, already has it running. Once per person: `seedDefaultMods`
     * remembers what it has offered, and leaves alone anything switched off.
     * Builtin only: a folder from somewhere else does not get to switch itself on.
     */
    const seeded = await seedDefaultMods(this.catalog.defaultIds()).catch((err) => {
      console.warn(`[betterslack] could not switch on the default mods: ${err}`);
      return null;
    });
    if (seeded?.added.length) console.log(`[betterslack] switched on by default: ${seeded.added.join(', ')}`);

    this.info = {
      version: VERSION,
      sessionId: `${process.pid}-${Date.now().toString(36)}`,
      modsRoot: BUILTIN_MODS_ROOT,
      userModsRoot: USER_MODS_ROOT,
      skipped: [...this.catalog.errors],
      slackPath: this.slackPath,
      slackVersion: await slackVersion(this.slackPath),
      transport: 'CDP pipe (no network port)',
      root: REPO_ROOT,
      safeMode: this.safeRequested,
      // What the Slack now running was launched with, read by main() after it
      // had written whatever was wanted. Not the same as what is wanted now:
      // the two disagree exactly when a restart would change something.
      slackPrefsAtLaunch: this.slackPrefsAtLaunch,
    };

    /*
     * A run that never reported itself healthy is assumed to have been taken
     * down by a mod, and the next one comes up bare.
     *
     * This is the escape hatch the two renderer freezes did not have: the only
     * way out was killing Slack and editing settings.json by hand. The marker
     * is written now and removed when the renderer says it is up.
     */
    if (!this.safeRequested && (await lastBootFailed())) {
      this.info.safeMode = true;
      this.info.safeModeReason =
        'the last start never finished, so nothing was loaded this time';
      console.warn(`[betterslack] ${this.info.safeModeReason}`);
    }
    if (this.info.safeMode) {
      console.log('[betterslack] safe mode: no mods will be applied');
    }
    await markBootStarted();

    const mods = this.catalog.list();
    console.log(
      `[betterslack] ${mods.filter((m) => m.type === 'theme').length} theme(s), ` +
        `${mods.filter((m) => m.type === 'plugin').length} plugin(s) available`,
    );

    /*
     * Both checks go out on the network, so nothing waits for them: they run
     * beside the attach loop and push their answers when they have them. A
     * renderer that attaches later gets both from the boot payload instead.
     */
    void this.sweepForUpdates();
    /*
     * And again every hour, because a badge that is only ever right at the
     * moment Slack started is a badge that is usually wrong: this is somebody's
     * messaging app, left running for days. Hourly is two requests an hour --
     * `git fetch` (or one raw package.json) and one registry -- against a check
     * whose whole output is a dot.
     *
     * Unref'd so it is never what keeps the process alive: the loader exits
     * when Slack does, not when a timer says it may.
     */
    setInterval(() => void this.sweepForUpdates(), UPDATE_SWEEP_MS).unref?.();

    this.catalog.watch(async (changedIds) => {
      const settings = await readSettings();
      if (!settings.hotReload) return;
      for (const id of changedIds) {
        const files = await this.catalog.readSource(id).catch(() => null);
        if (files === null) continue;
        console.log(`[betterslack] reloading "${id}"`);
        this.broadcast({ type: 'mod.changed', id, files });
      }
      this.broadcast({ type: 'catalog.changed', mods: this.catalog.list() });
    });

    await this.attachLoop();
  }

  /** Keep every Slack client target injected, including ones opened later. */
  private async attachLoop(): Promise<void> {
    for (;;) {
      if (this.restarting) {
        await sleep(300);
        continue;
      }
      if (this.connection.isClosed) {
        console.log('[betterslack] Slack closed, exiting');
        return;
      }
      let targets: TargetInfo[] = [];
      try {
        targets = await this.connection.targets();
      } catch {
        if (this.restarting) continue;
        console.log('[betterslack] Slack closed, exiting');
        return;
      }
      const pages = targets.filter((t) => t.type === 'page');
      const clients = pages.filter((t) => /app\.slack\.com/.test(t.url));
      for (const target of clients) {
        if (!this.attachments.has(target.targetId)) await this.attach(target);
      }
      // Everything else Slack opens. They start as about:blank and are filled
      // in afterwards, so the styles go in on every load rather than once.
      for (const target of pages) {
        if (clients.includes(target) || this.auxiliary.has(target.targetId)) continue;
        await this.attachAuxiliary(target);
      }
      await sleep(1500);
    }
  }

  /**
   * Stop Slack, start it again, and carry on driving it.
   *
   * For the preferences Slack reads when it creates a window -- the translucent
   * one above all -- which can never take effect in place. Everything that
   * makes this loader itself keeps running: the catalogue watcher, the
   * terminal, the settings. Only the connection and the sessions are rebuilt,
   * because they belong to a process that no longer exists.
   *
   * `restarting` gates the attach loop rather than stopping it: the loop reads
   * `this.connection` every round, so it picks the new one up on its own once
   * this returns, and a round that runs mid-swap would otherwise attach to a
   * closed connection and log a failure that means nothing.
   */
  private restarting = false;

  private async restartSlack(): Promise<void> {
    if (this.restarting || !this.relaunch) return;
    this.restarting = true;
    console.log('[betterslack] restarting Slack');
    try {
      for (const { session } of this.attachments.values()) session.close();
      for (const session of this.auxiliary.values()) session.close();
      this.attachments.clear();
      this.auxiliary.clear();
      this.connection.close();

      await stopSlack();
      // Whatever a mod asked to be kept set, written before the window that
      // will read it exists. This is the entire point of restarting.
      if (prefsSupported()) {
        const settings = await readSettings();
        await applyDesktopPrefs(settings.slackPrefs ?? {});
      }
      this.connection = await this.relaunch();
      this.slackPrefsAtLaunch = await readDesktopPrefs();
      this.info.slackPrefsAtLaunch = this.slackPrefsAtLaunch;
      console.log('[betterslack] Slack is back');
    } catch (err) {
      console.error(`[betterslack] could not restart Slack: ${(err as Error).message}`);
    } finally {
      this.restarting = false;
    }
  }

  /**
   * Hand the client to a script, so a set of screenshots is one launch.
   *
   * Restarting Slack between frames is what the first version of this did, and
   * it took minutes for pictures that differ by which mod is switched on --
   * something the runtime can do in place through `window.__betterslack`. The
   * recipe lives with what it is photographing (`scripts/shoot-site.mjs`) and
   * this stays a way in: evaluate, shoot, wait.
   */
  private async runShotScript(session: CdpSession): Promise<void> {
    // The runtime assigns `window.__betterslack` on the last line of boot, so
    // there is nothing to drive until it answers.
    for (let i = 0; i < 60; i += 1) {
      const ready = await session.evaluate<boolean>('Boolean(window.__betterslack)').catch(() => false);
      if (ready) break;
      await sleep(500);
    }

    /*
     * Slack in the background is Slack that is not rendering: its own dialogs
     * never open and a deep link that should slide a profile in does nothing.
     * A recipe that drives the client has to have it in front.
     */
    await session.send('Page.bringToFront').catch(() => undefined);

    const file = path.resolve(process.env.BETTERSLACK_SHOT_SCRIPT!);
    try {
      const recipe = (await import(pathToFileURL(file).href)) as {
        default: (page: {
          evaluate: <T>(expression: string) => Promise<T>;
          shoot: (name: string, size?: string, delayMs?: number, hover?: string) => Promise<void>;
          shootWindow: (match: string, name: string, size?: string) => Promise<boolean>;
          evaluateWindow: <T>(match: string, expression: string) => Promise<T | null>;
          click: (selector: string, index?: number) => Promise<string>;
          sleep: (ms: number) => Promise<void>;
        }) => Promise<void>;
      };
      await recipe.default({
        evaluate: (expression) => session.evaluate(expression),
        shoot: (name, size, delayMs, hover) => this.shoot(session, name, size, delayMs ?? 0, hover),
        /*
         * A window a mod opened is a separate renderer, so the client's session
         * cannot photograph it -- and `screencapture` misses it, since Slack
         * routinely puts it on another Space. The loader is already attached to
         * every page target, so it is the only thing that can.
         */
        /*
         * Drive a window a mod opened, the same way `shootWindow` photographs
         * one. The theme builder's interesting frame is a click past its door,
         * and the client's session cannot reach into another renderer.
         */
        evaluateWindow: async (match, expression) => {
          for (const [, other] of this.auxiliary) {
            const here = await other
              .evaluate<string>('[location.href, document.title, window.name].join(" ")')
              .catch(() => '');
            if (!here.includes(match)) continue;
            return other.evaluate(expression);
          }
          return null;
        },
        shootWindow: async (match, name, size) => {
          for (const [, other] of this.auxiliary) {
            // A window a mod opens with `window.open('', name)` is about:blank
            // with a title in the user's language, so neither the URL nor the
            // title identifies it. `window.name` is the name the mod chose.
            const here = await other
              .evaluate<string>('[location.href, document.title, window.name].join(" ")')
              .catch(() => '');
            if (!here.includes(match)) continue;
            await this.shoot(other, name, size, 0);
            return true;
          }
          return false;
        },
        /*
         * A real click, because some of Slack's own controls ignore a
         * synthetic one -- the workspace switcher reported success on
         * `element.click()` and stayed exactly where it was.
         */
        click: async (selector, index = 0) => {
          // Only what is actually drawn: Slack keeps copies of its own controls
          // in menus that are not open, and the first match in document order
          // was one of those -- zero by zero, and a click aimed at its middle
          // lands on the window and reports success.
          const at = await session.evaluate<{ x: number; y: number; why?: string } | null>(
            `(() => { const all = [...document.querySelectorAll(${JSON.stringify(selector)})]`
            + `   .map((el) => el.getBoundingClientRect())`
            + `   .filter((box) => box.width >= 2 && box.height >= 2 && box.bottom > 0 && box.top < innerHeight);`
            + ` const box = all[${Number(index) || 0}];`
            + ` if (!box) { const raw = [...document.querySelectorAll(${JSON.stringify(selector)})]`
            + `     .map((el) => { const r = el.getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height) + '@' + Math.round(r.top); });`
            + `   return { x: 0, y: 0, why: all.length + ' visible of ' + raw.length + ' [' + raw.join(' ') + '] in ' + innerWidth + 'x' + innerHeight }; }`
            + ` return { x: box.left + box.width / 2, y: box.top + box.height / 2 }; })()`,
          );
          if (!at || at.why) return at?.why ?? 'nothing matched';
          const where = { x: at.x, y: at.y, button: 'left', clickCount: 1, buttons: 1 };
          await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y, buttons: 0 });
          await session.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...where });
          await session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...where });
          return 'clicked';
        },
        sleep,
      });
      console.log('[betterslack] the shot script finished');
    } catch (err) {
      console.error(`[betterslack] shot script failed: ${(err as Error).message}`);
      process.exitCode = 1;
    }
    process.exit(process.exitCode ?? 0);
  }

  /**
   * Write a PNG of one renderer, for the screenshots the site is built from.
   *
   * The viewport is forced to a fixed size first. Without it every picture
   * depends on how wide whoever took it happened to have Slack open, and the
   * catalogue ends up with thumbnails that do not match each other -- which is
   * exactly what the first attempt at refreshing them produced.
   */
  private async shoot(
    session: CdpSession,
    name: string,
    size?: string,
    delayMs?: number,
    hover?: string,
  ): Promise<void> {
    const dir = process.env.BETTERSLACK_SHOT;
    if (!dir) return;
    const delay = delayMs ?? Number(process.env.BETTERSLACK_SHOT_DELAY ?? 6000);

    await sleep(delay);
    try {
      await this.forceViewport(session, size ?? process.env.BETTERSLACK_SHOT_SIZE ?? '1800x1128');
      /*
       * A message action only exists while the pointer is over the message,
       * and Slack draws that toolbar from CSS `:hover` -- which no synthetic
       * event reaches. This is a real pointer, and it has to be moved *after*
       * the viewport override, since that is what the coordinates are in.
       */
      if (hover) {
        /*
         * The last match that is comfortably inside the window. Asking for a
         * particular one by index does not survive Slack's virtual list --
         * `:nth-last-of-type` matched nothing at all, since each row is an only
         * child of its own wrapper -- and the last match is usually behind the
         * composer.
         */
        const at = await session.evaluate<{ x: number; y: number } | null>(
          `(() => { const all = [...document.querySelectorAll(${JSON.stringify(hover)})]`
          + `   .map((el) => el.getBoundingClientRect())`
          + `   .filter((box) => box.height > 12 && box.top >= 0 && box.bottom <= innerHeight);`
          /*
           * Away from the top bar and the composer if anything is -- a message
           * half under the composer is a poor thing to photograph -- but a
           * control strip button lives at the very bottom, and insisting on
           * the margin left nothing to hover at all. Note the comment is out
           * here: the expression below is concatenated into a single line, so
           * a `//` inside it comments out everything after it.
           */
          + ` const comfy = all.filter((box) => box.top > 120 && box.bottom < innerHeight - 220);`
          + ` const box = (comfy.length ? comfy : all).at(-1); if (!box) return null;`
          + ` return { x: box.left + box.width / 2, y: box.top + box.height / 2 }; })()`,
        );
        if (!at) throw new Error(`nothing matches ${hover} to hover`);
        await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y, buttons: 0 });
        await sleep(700);
      }
      const picture = await this.capture(session);
      const file = path.join(dir, `${name.replace(/[^\w-]+/g, '-').slice(0, 60)}.webp`);
      await fs.writeFile(file, picture);
      console.log(`[betterslack] wrote ${file}`);
    } catch (err) {
      console.warn(`[betterslack] could not photograph ${name}: ${(err as Error).message}`);
    } finally {
      await session.send('Emulation.clearDeviceMetricsOverride').catch(() => undefined);
    }
  }

  /**
   * Draw the page at the size the picture will be published at.
   *
   * Cropping a taller frame afterwards takes the crop from the middle, which
   * is how the top bar and the composer went missing from every panel shot on
   * the site. Forcing the viewport also means a picture does not depend on how
   * wide whoever took it happened to have Slack open.
   */
  private async forceViewport(session: CdpSession, size: string): Promise<void> {
    const [width, height] = size.split('x').map((n) => Number(n) || 0);
    if (!width || !height) return;
    await session.send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 2, mobile: false,
    });
    // Slack reflows, and the frame after a reflow is not the one to keep.
    await sleep(1500);
  }

  /*
   * WebP, and Chromium is the encoder.
   *
   * Measured on one of these frames: the same picture is 472 kB as a PNG,
   * 132 kB as a 1400-wide JPEG, and 160 kB as a WebP at the full 3200x2000 --
   * so the retina resolution costs almost nothing and there is no downscale.
   * That matters twice over: a downscale here means `sips`, which is macOS-only
   * and cannot write WebP at all, and asking Chromium for the format it already
   * supports leaves the screenshot pipeline with no external tool in it.
   *
   * 78 is measured too: 70 saves 12 kB and starts showing on Slack's text,
   * 85 costs 28 kB for nothing anybody can see.
   */
  private async capture(session: CdpSession): Promise<Buffer> {
    const shot = await session.send<{ data: string }>('Page.captureScreenshot', {
      format: 'webp',
      quality: 78,
    });
    return Buffer.from(shot.data, 'base64');
  }

  private async attach(target: TargetInfo): Promise<void> {
    let session: CdpSession;
    try {
      session = await this.connection.attach(target.targetId);
    } catch (err) {
      console.warn(`[betterslack] could not attach to ${target.targetId}: ${(err as Error).message}`);
      return;
    }
    const attachment: Attachment = { session, watch: new Set() };
    this.attachments.set(target.targetId, attachment);
    session.on('__closed', () => this.attachments.delete(target.targetId));
    this.listenForSlackEvents(attachment);


    await session.send('Runtime.enable');
    await session.send('Page.enable');
    await session.send('Runtime.addBinding', { name: BINDING_NAME });

    session.on('Runtime.bindingCalled', (params: { name: string; payload: string }) => {
      if (params.name !== BINDING_NAME) return;
      void this.handleMessage(session, params.payload);
    });

    /*
     * The page's own errors, in the terminal.
     *
     * Without this the only way to see why a mod failed is to open DevTools
     * inside Slack, which is precisely what is hard when the failure is at
     * boot. Uncaught exceptions always print; console noise does not, because
     * Slack's own client is chatty -- BETTERSLACK_VERBOSE=1 lifts that.
     */
    session.on('Runtime.exceptionThrown', (params: {
      exceptionDetails?: { exception?: { description?: string }; text?: string };
    }) => {
      const details = params.exceptionDetails;
      console.error(`[betterslack] page error: ${details?.exception?.description ?? details?.text ?? '?'}`);
    });

    session.on('Runtime.consoleAPICalled', (params: {
      type: string;
      args?: Array<{ value?: unknown; description?: string }>;
    }) => {
      if (params.type !== 'error' && params.type !== 'warning' && !verbose) return;
      const text = (params.args ?? [])
        .map((arg) => String(arg.value ?? arg.description ?? ''))
        .join(' ');
      if (!verbose && !text.includes('betterslack')) return;
      console.log(`[betterslack] page ${params.type}: ${text}`);
    });

    // A document-start script is what keeps themes from flashing, but it is not
    // something to rely on alone: a reload driven by another DevTools client
    // drops it, and Slack navigates on its own. Re-check after every load and
    // put the runtime back if it is missing.
    session.on('Page.loadEventFired', () => void this.ensureInjected(attachment));
    session.on('Page.frameStoppedLoading', () => void this.ensureInjected(attachment));

    // BETTERSLACK_NO_BOOTSCRIPT=1 reproduces the path taken when the document-start
    // script did not run: the runtime goes in against a finished document.
    if (process.env.BETTERSLACK_NO_BOOTSCRIPT !== '1') await this.refreshBootScript(attachment);
    await this.inject(attachment);

    console.log(`[betterslack] injected into ${target.title || target.url}`);

    if (this.healthcheck) void this.reportHealth(session);
    if (process.env.BETTERSLACK_SHOT_SCRIPT) void this.runShotScript(session);
    // Not when a recipe is running: it says what to photograph and when, and a
    // stray frame of the client lands in the folder it is filling.
    if (process.env.BETTERSLACK_SHOT && !process.env.BETTERSLACK_SHOT_SCRIPT) {
      void this.shoot(session, process.env.BETTERSLACK_SHOT_NAME ?? 'client');
    }
    else this.watch(session);

    if (process.env.BETTERSLACK_DIAGNOSE === '1') {
      // Enabled up front: enabling it once the thread is already busy never
      // takes, which is why the first attempt at this came back empty.
      await session.send('Debugger.enable').catch(() => undefined);
      void this.diagnose(session);
    }

  }

  /**
   * Ask the runtime how it is, print it, and leave.
   *
   * `--healthcheck` exists so the whole stack can be tested against a real
   * Slack rather than a jsdom impression of one: every freeze this project has
   * had was invisible to the unit tests and obvious here, and it was being
   * checked by hand.
   */
  /** Installed mods with a newer version published; null if it could not ask. */
  private async findModUpdates(): Promise<ModUpdate[] | null> {
    const installed = (await readSettings()).installed;
    const records = this.catalog.list().filter((mod) => installed.includes(mod.id));
    return findModUpdates(records, { repo: REPO, branch: DEFAULT_BRANCH }, VERSION);
  }

  /**
   * Look for a newer BetterSlack and newer mods, and tell the renderer.
   *
   * The two are checked together and kept apart: they update by different
   * routes and one being blocked does not stop the other. Both are pushed even
   * when nothing was found, since "there is no longer an update" is exactly as
   * much of a change to a badge as "there is one" -- a mod updated from the
   * panel has to clear its own dot.
   *
   * Everything fails soft. Offline, on a fork, behind a proxy: the check says
   * it does not know and the badge stays as it was.
   */
  private async sweepForUpdates(): Promise<void> {
    await Promise.all([
      checkForUpdate({ root: REPO_ROOT, version: VERSION, repo: REPO, branch: DEFAULT_BRANCH })
        .then((status) => {
          const wasBehind = this.update?.behind === true;
          this.update = status;
          // Once per arrival, not once an hour for ever: this line is the only
          // notice somebody running from a terminal gets.
          if (status.behind && !wasBehind) {
            console.log(
              `[betterslack] an update is available${status.commits ? ` (${status.commits} commit(s))` : ''}` +
                `${status.headline ? `: ${status.headline}` : ''}`,
            );
          }
          this.broadcast({ type: 'update.status', status });
        })
        .catch(() => undefined),
      this.findModUpdates()
        .then((updates) => {
          // Nothing said, nothing changed: the registry was unreachable, and
          // the badge keeps whatever the last sweep that did reach it found.
          if (updates === null) return;
          const key = (list: ModUpdate[]) => list.map((u) => `${u.id}@${u.to}`).join(',');
          const changed = key(this.modUpdates) !== key(updates);
          this.modUpdates = updates;
          if (updates.length && changed) {
            console.log(`[betterslack] mod update(s): ${updates.map((u) => `${u.name} ${u.to}`).join(', ')}`);
          }
          this.broadcast({ type: 'mods.updates', updates });
        })
        .catch(() => undefined),
    ]);
  }

  private async reportHealth(session: CdpSession): Promise<void> {
    // Long enough for Slack to build its client and the mods to mount, since
    // the interesting failures happen in that window.
    await sleep(12_000);

    const raw = await session
      .evaluate<string>('JSON.stringify(window.__betterslack ? window.__betterslack.health() : null)')
      .catch((err: Error) => `!${err.message}`);

    if (typeof raw === 'string' && raw.startsWith('!')) {
      console.error(`[betterslack] health: the renderer did not answer — ${raw.slice(1)}`);
      console.error('[betterslack] this is what a wedged renderer looks like; see CLAUDE.md');
      process.exitCode = 1;
    } else {
      const health = JSON.parse(raw ?? 'null') as {
        enabled: string[];
        applied: string[];
        errors: Array<[string, string]>;
        launcher: boolean;
        safeMode: boolean;
      } | null;
      if (!health) {
        console.error('[betterslack] health: no runtime in the page');
        process.exitCode = 1;
      } else {
        const missing = health.enabled.filter((id) => !health.applied.includes(id));
        console.log(`[betterslack] health: ${JSON.stringify(health)}`);
        if (!health.launcher) {
          console.error('[betterslack] health: the panel button never mounted');
          process.exitCode = 1;
        }
        if (health.errors.length > 0) {
          console.error(`[betterslack] health: ${health.errors.length} mod(s) failed to start`);
          process.exitCode = 1;
        }
        if (!health.safeMode && missing.length > 0) {
          console.error(`[betterslack] health: enabled but not applied — ${missing.join(', ')}`);
          process.exitCode = 1;
        }
      }
    }

    await markBootHealthy();
    await stopSlack().catch(() => undefined);
    process.exit(process.exitCode ?? 0);
  }

  /**
   * Keep asking whether the renderer is still answering.
   *
   * A wedged renderer is silent: no error, no console, a grey window. Both
   * freezes this project has had were found by noticing that Runtime.evaluate
   * never came back, by hand, after the fact. This notices for you, names the
   * mods that were on at the time, and leaves the marker that makes the next
   * start a safe one.
   */
  private watch(session: CdpSession): void {
    void (async () => {
      let complained = false;
      for (;;) {
        await sleep(WATCHDOG_INTERVAL_MS);
        if (session.isClosed || this.connection.isClosed) return;

        const alive = await session
          .evaluate<number>('1', false)
          .then(() => true)
          .catch(() => false);

        if (alive) {
          complained = false;
          continue;
        }
        if (complained) continue;
        complained = true;

        const settings = await readSettings().catch(() => null);
        console.error(
          '[betterslack] the renderer stopped answering — Slack is wedged, not slow.' +
            (settings ? ` Mods on at the time: ${settings.enabled.join(', ') || 'none'}.` : ''),
        );
        console.error('[betterslack] the next start will come up in safe mode.');
        // Re-arm what app.ready cleared: whatever just happened, starting bare
        // next time is the only way back that does not involve a text editor.
        await markBootStarted();
      }
    })();
  }

  /** Give one of Slack's other windows the active theme, and nothing else. */
  /**
   * Ask the client what it looks like, a few seconds apart.
   *
   * The failure this exists for is a renderer whose main thread is blocked: no
   * error is thrown, nothing reaches the console, and Runtime.evaluate simply
   * never returns -- which is itself the diagnosis, and cannot be observed from
   * inside the page. BETTERSLACK_DIAGNOSE=1.
   */
  private async diagnose(session: CdpSession): Promise<void> {
    for (const delay of [3000, 8000, 16000]) {
      await sleep(delay);
      if (session.isClosed) return;
      const report = await session
        .evaluate<string>(
          'JSON.stringify({' +
            ' ready: document.readyState,' +
            ' client: !!document.querySelector(".p-client_container"),' +
            ' runtime: !!window.__betterslack,' +
            ' panel: !!document.querySelector("#betterslack-control-button"),' +
            ' styles: document.querySelectorAll("style[data-betterslack-style]").length,' +
            ' nodes: document.getElementsByTagName("*").length' +
            '})',
        )
        .catch((err) => `unreachable -- ${(err as Error).message}`);
      console.log(`[betterslack] diagnose +${delay / 1000}s: ${report}`);

      // A renderer that will not answer is one whose main thread is busy. The
      // debugger can interrupt it where evaluate cannot, and the call frames it
      // comes back with name whatever is looping.
      if (report.startsWith('unreachable')) {
        await this.whereIsItStuck(session);
        return;
      }
    }
  }

  /** Interrupt a busy renderer and print what it is executing. */
  private async whereIsItStuck(session: CdpSession): Promise<void> {
    const frames = new Promise<string>((resolve) => {
      const timer = setTimeout(() => resolve('the debugger could not interrupt it either'), 15000);
      session.on('Debugger.paused', (params: {
        callFrames?: Array<{ functionName?: string; url?: string; location?: { lineNumber: number } }>;
      }) => {
        clearTimeout(timer);
        resolve(
          (params.callFrames ?? [])
            .slice(0, 12)
            .map((f, i) => `    ${i}. ${f.functionName || '(anonymous)'} ` +
              `${f.url || 'inline'}:${(f.location?.lineNumber ?? 0) + 1}`)
            .join('\n'),
        );
      });
    });
    await session.send('Debugger.pause').catch(() => undefined);
    console.log(`[betterslack] the renderer is stuck in:\n${await frames}`);
  }

  private async attachAuxiliary(target: TargetInfo): Promise<void> {
    let session: CdpSession;
    try {
      session = await this.connection.attach(target.targetId);
    } catch {
      return; // it may have closed already; it is only a huddle window
    }
    this.auxiliary.set(target.targetId, session);
    session.on('__closed', () => this.auxiliary.delete(target.targetId));

    await session.send('Runtime.enable').catch(() => undefined);
    await session.send('Page.enable').catch(() => undefined);
    // A window a mod opened for itself is still a renderer that can throw, and
    // it has no panel and no DevTools of its own to say so.
    session.on('Runtime.exceptionThrown', (params: {
      exceptionDetails?: { exception?: { description?: string }; text?: string };
    }) => {
      const details = params.exceptionDetails;
      console.error(
        `[betterslack] error in ${target.title || 'another window'}: ` +
          `${details?.exception?.description ?? details?.text ?? '?'}`,
      );
    });
    /*
     * A window a mod opened is a renderer of its own, and it is routinely on
     * another Space or another display -- screencapture takes a picture of the
     * desktop, not of the window, so it is no help at all. CDP renders the page
     * itself. BETTERSLACK_SHOT=<dir> is how the theme builder's own interface was
     * looked at while it was being built, and how the site's screenshots are
     * taken -- see shoot(), which the client uses too.
     */
    // Not while a recipe is running: it says what to photograph and when, and
    // a window Slack opened mid-run would otherwise drop a frame of its own
    // into the folder the recipe is filling -- under whatever Slack calls it.
    if (process.env.BETTERSLACK_SHOT && !process.env.BETTERSLACK_SHOT_SCRIPT) {
      void this.shoot(session, target.title || 'window');
    }
    const paint = () => void this.paintAuxiliary(session);
    session.on('Page.loadEventFired', paint);
    session.on('Page.frameStoppedLoading', paint);
    paint();
    console.log(`[betterslack] theming ${target.title || 'an auxiliary window'}`);
  }

  private async paintAuxiliary(session: CdpSession): Promise<void> {
    /*
     * Two windows must never be painted from here.
     *
     * A window a mod opened for itself says so, and is left alone: a theme
     * builder repainted by the theme being edited becomes unreadable exactly
     * when you need to read it.
     *
     * And the client itself. Slack's main window exists as about:blank for a
     * moment before it navigates, so the attach loop can catch it on the way up
     * and file it as auxiliary; without this it would then carry the theme
     * twice, once raw from here and once from the runtime.
     */
    const skip = await session
      .evaluate<boolean>(
        '!!document.documentElement.hasAttribute("data-betterslack-window")' +
          ' || !!document.querySelector(".p-client_container")' +
          ' || !!window.__betterslack',
      )
      .catch(() => true); // unreadable: leave it alone rather than guess
    if (skip) return;

    const css = await this.buildThemeCss();
    // Re-applied wholesale each time, keyed by one element, so a reload or a
    // second call cannot leave two stylesheets fighting.
    const script = `(() => {
      const id = 'betterslack-aux-theme';
      let node = document.getElementById(id);
      if (!node) {
        node = document.createElement('style');
        node.id = id;
        (document.head || document.documentElement).append(node);
      }
      node.textContent = ${JSON.stringify(css)};
    })()`;
    await session.evaluate(script, false).catch(() => undefined);
  }

  /** Every enabled theme, then the user's own CSS, in the order they apply. */
  private async buildThemeCss(): Promise<string> {
    const settings = await readSettings();
    const parts: string[] = [];
    for (const id of settings.enabled) {
      const record = this.catalog.get(id);
      if (record?.type !== 'theme') continue;
      const files = await this.catalog.readSource(id).catch(() => null);
      if (files) parts.push(inlineCssImports(files, record.entry));
    }
    if (settings.customCss.trim()) parts.push(settings.customCss);
    return parts.join('\n\n');
  }

  /** Re-register the document-start script so it carries current settings. */
  private async refreshBootScript(attachment: Attachment): Promise<void> {
    const bootstrap = await this.buildBootstrap();
    if (attachment.scriptId) {
      await attachment.session
        .send('Page.removeScriptToEvaluateOnNewDocument', { identifier: attachment.scriptId })
        .catch(() => undefined);
    }
    const res = await attachment.session
      .send<{ identifier: string }>('Page.addScriptToEvaluateOnNewDocument', { source: bootstrap })
      .catch(() => undefined);
    attachment.scriptId = res?.identifier;
  }

  private async inject(attachment: Attachment): Promise<void> {
    const bootstrap = await this.buildBootstrap();
    await attachment.session.evaluate(bootstrap).catch((err: Error) => {
      console.warn(`[betterslack] injection into the live document failed: ${err.message}`);
    });
  }

  private ensureInjected(attachment: Attachment): Promise<void> {
    // Page.loadEventFired and Page.frameStoppedLoading both fire for one
    // navigation; without this guard they race and inject twice.
    if (attachment.healing) return attachment.healing;
    const work = (async () => {
      if (attachment.session.isClosed) return;
      // Compare session ids, not mere presence: a runtime left behind by a
      // previous loader run is still on the page with a dead bridge and a stale
      // copy of the settings, and would happily overwrite them.
      const current = await attachment.session
        .evaluate<string | null>('window.__betterslack ? window.__betterslack.sessionId : null', false)
        .catch(() => this.info.sessionId); // on error, do nothing rather than double-inject
      if (current === this.info.sessionId) return;
      console.log(
        current === null
          ? '[betterslack] runtime went missing after a navigation, re-injecting'
          : '[betterslack] replacing a runtime left over from a previous session',
      );
      await this.inject(attachment);
    })().finally(() => {
      attachment.healing = undefined;
    });
    attachment.healing = work;
    return work;
  }

  /**
   * The bootstrap carries settings and the source of every enabled mod, so
   * themes are applied on the first paint instead of after a round trip.
   */
  private async buildBootstrap(): Promise<string> {
    const settings = await readSettings();
    const mods = this.catalog.list();
    const sources: Record<string, ModFiles> = {};
    for (const id of settings.enabled) {
      const files = await this.catalog.readSource(id).catch((err) => {
        // Once per mod: the bootstrap is rebuilt on every settings change.
        if (!this.reportedUnreadable.has(id)) {
          this.reportedUnreadable.add(id);
          console.warn(`[betterslack] enabled mod "${id}" is unreadable: ${err.message}`);
        }
        return null;
      });
      if (files !== null) sources[id] = files;
    }
    const boot = {
      version: VERSION, settings, mods, sources, info: this.info,
      update: this.update,
      // A renderer that attaches after the first sweep would otherwise wait an
      // hour for the push, and show no badge in the meantime.
      modUpdates: this.modUpdates,
    };
    return `window.__BETTERSLACK_BOOT__ = ${JSON.stringify(boot)};\n${this.runtimeSource}`;
  }

  private async handleMessage(session: CdpSession, raw: string): Promise<void> {
    let envelope: Envelope;
    try {
      envelope = JSON.parse(raw) as Envelope;
    } catch {
      console.warn('[betterslack] dropped an unparseable message from the renderer');
      return;
    }
    const request = envelope.payload as Request;
    if (this.verbose) console.log(`[betterslack] <- ${request.type}`);

    let result: unknown;
    let error: string | undefined;
    try {
      result = await this.dispatch(request, session);
    } catch (err) {
      error = (err as Error).message;
      console.warn(`[betterslack] ${request.type} failed: ${error}`);
    }
    if (envelope.rid === undefined) return;
    if (this.verbose) console.log(`[betterslack] -> ${request.type} ${error ?? 'ok'}`);
    await this.post(session, { rid: envelope.rid, payload: { result, error } });
  }

  private async dispatch(request: Request, session: CdpSession): Promise<unknown> {
    switch (request.type) {
      case 'settings.set': {
        const saved = await mergeSettings(request.settings);
        /*
         * Written through immediately as well as before the next launch. Most
         * of these do nothing until Slack restarts, but writing now means the
         * file already agrees with the panel -- and a preference that a mod
         * says it set, and that is not in the file, is a preference somebody
         * will spend an afternoon on.
         */
        if (request.settings.slackPrefs && prefsSupported()) {
          const result = await applyDesktopPrefs(saved.slackPrefs ?? {});
          if (result === 'failed') {
            console.warn('[betterslack] could not write Slack\'s settings file');
          }
        }
        // The document-start script embeds a snapshot of the settings; without
        // this, the next reload would come back with whatever was enabled when
        // the loader first attached.
        await this.refreshAllBootScripts();
        return saved;
      }

      case 'mod.setInstalled': {
        const saved = await setModInstalled(request.id, request.installed);
        await this.refreshAllBootScripts();
        this.broadcast({ type: 'settings.changed', settings: saved });
        return saved;
      }

      case 'mod.enable': {
        const saved = await setModEnabled(request.id, request.enabled);
        await this.refreshAllBootScripts();
        // A theme can bring its own app icon: the launcher takes it now, and
        // Slack's tile at its next start, which the runtime offers.
        if (this.catalog.list().find((mod) => mod.id === request.id)?.type === 'theme') {
          await refreshLauncherIcon().catch(() => undefined);
        }
        // Other windows are holding their own copy of the list; tell them.
        this.broadcast({ type: 'settings.changed', settings: saved });
        return saved;
      }

      case 'mod.source':
        return this.catalog.readSource(request.id);

      case 'mod.install':
        return this.install(request.id, request.manifest, request.files, request.source);

      case 'mod.uninstall':
        return this.uninstall(request.id);

      case 'file.download': {
        const result = await downloadFile(request.url, request.filename);
        console.log(`[betterslack] saved ${result.path} (${Math.round(result.bytes / 1024)} kB)`);
        return result;
      }

      case 'data.write': {
        const entry = await writeData(request.id, request.name, request.base64);
        console.log(`[betterslack] ${request.id} kept ${entry.name} (${Math.round(entry.bytes / 1024)} kB)`);
        return entry;
      }
      case 'data.read':
        return readData(request.id, request.name);
      case 'data.list':
        return listData(request.id);
      case 'data.remove':
        return removeData(request.id, request.name);
      case 'net.request': {
        // Whether the mod is on and which address its `network` settings
        // hold, read now rather than from what the page sent.
        const settings = await readSettings();
        return netRequest(
          this.catalog.get(request.modId),
          settings.enabled.includes(request.modId),
          settings.modSettings[request.modId] ?? {},
          request,
        );
      }

      case 'app.screenshot': {
        /*
         * The picture is taken of the renderer that asked for it.
         *
         * The page cannot photograph itself -- there is no such call in a
         * page -- so this is the loader doing what `pnpm shoot` does, through
         * the same forced viewport, and writing the result where a download
         * would have gone.
         */
        try {
          await this.forceViewport(session, request.size ?? '1600x1000');
          const picture = await this.capture(session);
          const saved = await saveBytes(picture, request.filename ?? 'slack.webp');
          console.log(`[betterslack] photographed the window into ${saved.path}`);
          return saved;
        } finally {
          // Always, or the client is left drawn at the picture's size.
          await session.send('Emulation.clearDeviceMetricsOverride').catch(() => undefined);
        }
      }

      case 'app.art':
        return LOADER_ART;

      case 'app.dockIcon': {
        if (request.action === 'settings') {
          if (process.platform !== 'darwin') return { ok: false };
          execFile('open', [APP_MANAGEMENT_PANE], () => undefined);
          return { ok: true };
        }
        if (request.action === 'retry') {
          // Dressed now, taken off again shortly: the tile itself only changes
          // when Slack starts, which is the restart the runtime offers next.
          const state = await dressIcons(this.slackPath);
          if (state === 'ok') undressSlackLater(this.slackPath);
          return { state };
        }
        return { state: dockIcon, pending: await dockIconPending().catch(() => false) };
      }

      case 'app.update': {
        /*
         * Pull, rebuild, and come back as the new version.
         *
         * The loader is itself one of the bundles being replaced, so it cannot
         * pick up the update in place: it stops Slack, spawns a detached copy
         * of the new entry point and exits. The replacement launches Slack
         * again, which is why the answer goes back before any of that starts --
         * the renderer is about to go away with it.
         */
        const result = await applyUpdate({ root: REPO_ROOT, repo: REPO, branch: DEFAULT_BRANCH });
        if (!result.ok) return result;

        setTimeout(() => {
          console.log('[betterslack] updated; restarting');
          void stopSlack().finally(() => {
            const entry = path.join(REPO_ROOT, 'bin/betterslack.mjs');
            spawn(process.execPath, [entry], {
              cwd: REPO_ROOT,
              detached: true,
              stdio: 'ignore',
            }).unref();
            process.exit(0);
          });
        }, 400);
        return result;
      }

      case 'app.relaunch': {
        const bundle = launchedFromBundle();
        if (!bundle) {
          setTimeout(() => void this.restartSlack(), 400);
          return { ok: true };
        }
        /*
         * Slack first, then this process; the new launch is asked of
         * LaunchServices by a detached shell once this one has gone, since an
         * `open` while the old instance still runs only brings it forward.
         */
        setTimeout(() => {
          console.log('[betterslack] relaunching');
          void stopSlack().finally(() => {
            spawn('/bin/sh', ['-c', 'sleep 1; open -a "$0"', bundle], {
              detached: true,
              stdio: 'ignore',
            }).unref();
            process.exit(0);
          });
        }, 400);
        return { ok: true };
      }

      case 'slack.restart': {
        /*
         * Answered before anything happens: the renderer that asked is about
         * to go away with the window it is in, and a reply that arrives after
         * that is a reply nobody hears.
         */
        setTimeout(() => void this.restartSlack(), 400);
        return { ok: true };
      }

      case 'backup.export':
        return exportBackup();

      case 'backup.import': {
        const result = await importBackup(request.archive);
        if (result.ok) {
          // The renderer's copy of everything just changed underneath it.
          this.broadcast({ type: 'settings.changed', settings: await readSettings() });
          await this.catalog.refresh();
          this.broadcast({ type: 'catalog.changed', mods: this.catalog.list() });
        }
        return result;
      }

      case 'mods.asset':
        return this.catalog.readAsset(request.id, request.file);

      case 'mods.inspectRemote':
        return inspectRemote(request.url);

      case 'updates.check': {
        // The same sweep the hour runs, so the panel's button and the badge
        // can never disagree about what there is.
        await this.sweepForUpdates();
        return { app: this.update ?? null, mods: this.modUpdates };
      }

      case 'mods.checkUpdates': {
        // The panel asking is not a different question from the badge asking,
        // so the answer is kept: an unreachable registry leaves both alone.
        const updates = await this.findModUpdates();
        if (updates !== null) this.modUpdates = updates;
        return updates;
      }

      case 'mods.update': {
        const record = this.catalog.list().find((mod) => mod.id === request.id);
        if (!record) return { ok: false, detail: 'no such mod' };

        const source = { repo: REPO, branch: DEFAULT_BRANCH };

        /*
         * Refused before anything is downloaded, not after it has failed.
         *
         * A mod updates itself out of the branch into whatever BetterSlack is
         * running here, so the published version can call something this build
         * has never had. Writing it anyway buys a plugin that throws on its
         * first click, which reads as "this plugin is broken" rather than "this
         * plugin is newer than your app".
         */
        const reachable = await updateIsReachable(record.id, source, VERSION);
        if (!reachable.ok) {
          return {
            ok: false,
            detail: `needs BetterSlack ${reachable.needs}, and this is ${VERSION}`,
            needsBetterSlack: reachable.needs,
          };
        }

        const files = await fetchModFiles(source, folderFor(record));
        if (!files) return { ok: false, detail: 'could not read it from GitHub' };
        const manifest = manifestFrom(files);
        if (!manifest || manifest.id !== record.id) {
          return { ok: false, detail: 'the download is not that mod' };
        }
        // Through the same path the Browse shelf uses, which re-validates the
        // manifest here: files off the network are untrusted whichever button
        // asked for them.
        await this.install(record.id, manifest, files);
        console.log(`[betterslack] updated "${record.id}" to ${manifest.version}`);
        return { ok: true, detail: manifest.version };
      }

      case 'slack.watch': {
        const attachment = [...this.attachments.values()].find((a) => a.session === session);
        if (!attachment) return null;
        attachment.watch = new Set(request.types.filter((type) => typeof type === 'string'));
        /*
         * Switched on the first time somebody asks, and never off again.
         *
         * `Network.enable` is what makes Chromium report frames, and the
         * buffers are set to nothing because the only thing wanted here is the
         * frame events: left at their defaults, Chromium holds every response
         * body in this client in memory for a `getResponseBody` nobody calls.
         */
        if (attachment.watch.size > 0 && !attachment.tapping) {
          attachment.tapping = true;
          await session.send('Network.enable', {
            maxTotalBufferSize: 1,
            maxResourceBufferSize: 1,
            maxPostDataSize: 1,
          }).catch(() => { attachment.tapping = false; });
        }
        return { ok: true, detail: String(attachment.watch.size) };
      }

      case 'app.ready':
        // The renderer got all the way up, so this run is not the one that
        // needs a safe start next time.
        await markBootHealthy();
        return null;

      default: {
        const never: never = request;
        throw new Error(`unknown request ${JSON.stringify(never)}`);
      }
    }
  }

  private async install(
    id: string,
    manifest: unknown,
    files: ModFiles,
    source?: string,
  ): Promise<ModRecord[]> {
    // Re-validate here: the renderer fetched this from the network, so the
    // manifest is untrusted input no matter how it looked on the other side.
    const type = (manifest as { type?: unknown }).type === 'plugin' ? 'plugin' : 'theme';
    const parsed = parseManifest(JSON.stringify(manifest), `<install:${id}>`, type);
    if (parsed.id !== id) throw new Error(`manifest id "${parsed.id}" does not match "${id}"`);

    const dir = path.join(USER_MODS_ROOT, `${parsed.type}s`, parsed.id);
    await fs.mkdir(dir, { recursive: true });
    // Where it came from is written into the manifest, not held in memory: a
    // mod nobody here has read must still say so after a restart.
    const written = source ? { ...parsed, origin: 'third-party', source } : parsed;
    await fs.writeFile(path.join(dir, 'mod.json'), JSON.stringify(written, null, 2), 'utf8');
    for (const [rel, contents] of Object.entries(files)) {
      // Re-checked here rather than trusted: this writes to disk from a message
      // the renderer sent, so a "../" in a key must not escape the folder.
      if (path.isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) {
        throw new Error(`refusing to write outside the mod folder: ${rel}`);
      }
      const target = path.join(dir, rel);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, contents, 'utf8');
    }
    console.log(`[betterslack] installed "${parsed.id}" into ${dir}`);
    return this.catalog.refresh();
  }

  private async uninstall(id: string): Promise<ModRecord[]> {
    const record = this.catalog.get(id);
    if (!record) throw new Error(`unknown mod "${id}"`);
    if (record.origin === 'builtin') {
      throw new Error(`"${id}" ships with the repository; disable it instead of uninstalling`);
    }
    await fs.rm(path.join(USER_MODS_ROOT, record.path), { recursive: true, force: true });
    const settings = await readSettings();
    await mergeSettings({ enabled: settings.enabled.filter((x) => x !== id) });
    console.log(`[betterslack] uninstalled "${id}"`);
    return this.catalog.refresh();
  }

  private async post(session: CdpSession, envelope: Envelope): Promise<void> {
    const json = JSON.stringify(envelope);
    await session
      .evaluate(`window.${RECEIVER_NAME} && window.${RECEIVER_NAME}(${JSON.stringify(json)})`, false)
      .catch(() => undefined);
  }

  /**
   * Slack's own realtime events, forwarded to the renderer.
   *
   * Slack keeps a socket per workspace and pushes everything that happens in
   * every conversation you are in down it -- a message, an edit, a deletion, a
   * reaction -- whether or not that conversation is open. Measured against a
   * live client: a `message` for a channel in a workspace the window was not
   * even showing arrived while the client sat on another one. It is how the
   * unread badges move without you looking.
   *
   * **It has to be read here, because the page cannot read it.** Slack's own
   * bundle opens the socket before anything else runs, so patching `WebSocket`
   * in the renderer catches nothing -- which is why an earlier attempt at this
   * from the page came back empty. The debugging protocol reports the frames
   * whatever the bundle does.
   *
   * **And reading is not reading.** Being told about a message is not opening
   * it: Slack marks a conversation read when its client sends
   * `conversations.mark`, and nothing here sends anything at all.
   *
   * Two things this must never do, both about the same secret: the socket's
   * URL carries the `xoxc` token as a query parameter, so the URL is never
   * logged and never leaves this function -- only the workspace id is taken
   * out of it -- and frames are only forwarded for the types a mod asked for.
   */
  private listenForSlackEvents(attachment: Attachment): void {
    const { session } = attachment;
    /** Socket id to workspace, so an event says which Slack it belongs to. */
    const teams = new Map<string, string>();

    session.on('Network.webSocketCreated', (params: { requestId?: string; url?: string }) => {
      // `gateway_server=T025V5WN2-3` names the workspace, and is the only part
      // of that URL worth keeping. The rest of it is the token.
      const team = /[?&]gateway_server=(T[A-Z0-9]+)/.exec(String(params?.url ?? ''))?.[1];
      if (params?.requestId && team) teams.set(params.requestId, team);
    });

    session.on('Network.webSocketFrameReceived', (params: {
      requestId?: string;
      response?: { opcode?: number; payloadData?: string };
    }) => {
      if (attachment.watch.size === 0) return;
      // Opcode 1 is text. Slack sends JSON; anything else is not for us.
      if (params?.response?.opcode !== 1) return;
      let event: SlackEvent;
      try {
        event = JSON.parse(String(params.response.payloadData)) as SlackEvent;
      } catch {
        return;
      }
      if (typeof event?.type !== 'string' || !attachment.watch.has(event.type)) return;
      const team = params.requestId ? teams.get(params.requestId) : undefined;
      void this.post(session, { payload: { type: 'slack.event', event: { ...event, teamId: team } } });
    });
  }

  private broadcast(event: PushEvent): void {
    for (const { session } of this.attachments.values()) {
      void this.post(session, { payload: event });
    }
  }

  private async refreshAllBootScripts(): Promise<void> {
    await Promise.all([...this.attachments.values()].map((a) => this.refreshBootScript(a)));
    // A theme switched on or off has to reach the other windows too.
    await Promise.all([...this.auxiliary.values()].map((s) => this.paintAuxiliary(s)));
  }

  dispose(): void {
    this.catalog.dispose();
    for (const { session } of this.attachments.values()) session.close();
    for (const session of this.auxiliary.values()) session.close();
  }
}

/**
 * The stylesheets of the themes switched on, in the order they apply -- read
 * straight off disk, since this runs before there is a catalogue or a client.
 * An installed copy of a mod wins over the shipped one, as everywhere else.
 */
async function enabledThemeCss(): Promise<Array<{ css: string }>> {
  const settings = await readSettings().catch(() => null);
  if (!settings) return [];
  const byId = new Map<string, { root: string; record: { path: string; entry: string; type: string } }>();
  for (const [root, origin] of [[BUILTIN_MODS_ROOT, 'builtin'], [USER_MODS_ROOT, 'installed']] as const) {
    const scan = await scanRoot(root, origin).catch(() => ({ mods: [] as ModRecord[] }));
    for (const record of scan.mods) byId.set(record.id, { root, record });
  }
  const out: Array<{ css: string }> = [];
  for (const id of settings.enabled) {
    const found = byId.get(id);
    if (!found || found.record.type !== 'theme') continue;
    const css = await fs.readFile(path.join(found.root, found.record.path, found.record.entry), 'utf8').catch(() => '');
    out.push({ css });
  }
  return out;
}

/**
 * Whether Slack.app took the icon the last time it was dressed.
 *
 * `refused` is App Management: writing into another app's signed bundle is
 * kTCCServiceSystemPolicyAppBundles, which macOS refuses silently until the
 * user switches it on for BetterSlack. The runtime asks for it on this answer.
 */
let dockIcon: DockIconState = 'unsupported';

/** The SVG Slack's tile is wearing: the one Slack.app had when Slack last started. */
let dockIconShown: string | null = null;

/** BetterSlack's icon -- or the theme's -- on Slack and on the launcher. */
async function dressIcons(slackPath: string): Promise<DockIconState> {
  if (process.platform !== 'darwin') return dockIcon;
  const svg = chooseIcon(await enabledThemeCss());
  const slack = bundleOf(slackPath);
  const took: string[] = await applyIcon(svg, [...(slack ? [slack] : []), ...launcherBundles()]).catch(() => []);
  dockIcon = !slack ? 'unsupported' : took.includes(slack) ? 'ok' : 'refused';
  if (dockIcon === 'ok') dockIconShown = svg;
  return dockIcon;
}

/*
 * A theme switched while Slack runs.
 *
 * The launcher takes the new icon at once. Slack's tile cannot: the Dock draws
 * a running app with the icon it had when it launched, and keeps doing so
 * through anything short of the app starting again -- the bundle's icon reads
 * back as the new one through NSWorkspace while the tile keeps the old, across
 * `killall Dock`, a touch of the bundle, `lsregister -f` and
 * `noteFileSystemChanged`. Restarting the Dock brings back the launch icon and
 * drops Slack's unread badge. So the runtime offers to restart Slack instead,
 * when `dockIconPending` says it would change something.
 */
async function refreshLauncherIcon(): Promise<void> {
  if (process.platform !== 'darwin') return;
  await applyIcon(chooseIcon(await enabledThemeCss()), launcherBundles());
}

/** Whether Slack's tile would change if Slack started again now. */
async function dockIconPending(): Promise<boolean> {
  if (process.platform !== 'darwin' || dockIcon !== 'ok') return false;
  return chooseIcon(await enabledThemeCss()) !== dockIconShown;
}

/**
 * The BetterSlack.app this loader was started from, or null. LaunchServices
 * puts the bundle id in the environment of what it launches, and launch.sh
 * passes it on to Node; a checkout started with pnpm has none.
 */
function launchedFromBundle(): string | null {
  if (process.platform !== 'darwin' || process.env.__CFBundleIdentifier !== 'dev.airone.betterslack') return null;
  return launcherBundles()[0] ?? null;
}

/** Where macOS lists the apps allowed to modify other apps. */
const APP_MANAGEMENT_PANE = 'x-apple.systempreferences:com.apple.preference.security?Privacy_AppBundles';

/*
 * Off Slack again once it has started. The Dock has read the icon by then and
 * keeps that tile until Slack quits; Slack.app goes back to exactly what was
 * shipped, which is what a signature check and Slack's own updater expect.
 * Measured: still the custom tile well after the icon was taken off.
 */
const UNDRESS_AFTER_MS = 45_000;
let undressTimer: ReturnType<typeof setTimeout> | null = null;
function undressSlackLater(slackPath: string): void {
  if (process.platform !== 'darwin') return;
  const slack = bundleOf(slackPath);
  if (!slack) return;
  // One timer: an earlier one firing while the Dock is still reading a newer
  // icon would hand the tile Slack's own.
  if (undressTimer) clearTimeout(undressTimer);
  undressTimer = setTimeout(() => void clearIcon(slack), UNDRESS_AFTER_MS);
  undressTimer.unref?.();
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  let slackPath: string;
  try {
    slackPath = findSlack();
  } catch (err) {
    if (err instanceof SlackNotFoundError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  // The pipe descriptors only exist if we spawn Slack ourselves, so an already
  // running instance has to be restarted. That is also what keeps the loader
  // from ever needing a debugging port.
  console.log('[betterslack] starting Slack...');
  await stopSlack();
  /*
   * Before Slack starts, never after: the window's material is chosen when the
   * window is created, and Slack rewrites its own settings file at other times
   * -- including on quit -- so the wanted state is re-applied at every launch
   * rather than written once and hoped for.
   */
  if (prefsSupported()) {
    const settings = await readSettings();
    const result = await applyDesktopPrefs(settings.slackPrefs ?? {});
    if (result === 'written') {
      console.log(
        `[betterslack] wrote Slack's own preferences: ${Object.keys(settings.slackPrefs ?? {}).join(', ')}`,
      );
    } else if (result === 'failed') {
      console.warn('[betterslack] could not write Slack\'s settings file; it is left as it was');
    }
  }
  /*
   * Read *after* writing, and this is the point of it: these are the values
   * the window about to open is created with, whatever anyone wants later. A
   * mod compares the two to know whether offering a restart would change
   * anything.
   */
  const slackPrefsAtLaunch = await readDesktopPrefs();

  /*
   * One way to start Slack, used for the first launch and for every restart a
   * mod asks for. The child is kept here so the shutdown handler and the next
   * launch both know which process they are talking about.
   */
  await dressIcons(slackPath);
  let child = launchSlack({ slackPath });
  undressSlackLater(slackPath);
  const relaunch = async (): Promise<CdpConnection> => {
    await dressIcons(slackPath);
    child = launchSlack({ slackPath });
    undressSlackLater(slackPath);
    const next = CdpConnection.fromChild(child);
    await waitForClientTarget(next, 90_000);
    return next;
  };

  let connection: CdpConnection;
  try {
    connection = CdpConnection.fromChild(child);
    await waitForClientTarget(connection, 90_000);
  } catch (err) {
    console.error(`[betterslack] ${(err as Error).message}`);
    child.kill();
    process.exit(1);
  }

  const loader = new Loader(
    connection, slackPath, args.verbose, args.safe, args.healthcheck, slackPrefsAtLaunch, relaunch,
  );
  const shutdown = () => {
    console.log('\n[betterslack] detaching (Slack keeps running; mods stay until you reload it)');
    loader.dispose();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await loader.start();
  loader.dispose();
}

main().catch((err) => {
  console.error('[betterslack] fatal:', err);
  process.exit(1);
});
