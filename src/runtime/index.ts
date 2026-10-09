// Runtime entry point, injected into the Slack renderer by the loader.
//
// This file runs at document-start on every navigation, so it must be cheap and
// it must never assume the DOM is ready.

import { ModManager, type BootPayload } from './manager.js';
import { Bridge } from './rpc.js';
import { installLauncher } from './ui/launcher.js';
import { showSplash, splashLineFrom, splashVarsFrom } from './ui/splash.js';
import { LAUNCHER_CSS, PANEL_CSS } from './ui/styles.js';
import { Panel } from './ui/panel.js';
import { offerDockIcon } from './ui/dock-icon.js';

declare global {
  interface Window {
    __BETTERSLACK_BOOT__?: BootPayload;
    __betterslack?: BetterSlackGlobal;
  }
}

declare global {
  interface Window {
    /** Set synchronously by whichever boot got here first. See boot(). */
    __BETTERSLACK_BOOTING__?: string;
  }
}

/** What `health()` answers: enough to say whether this run is sound. */
export interface Health {
  version: string;
  safeMode: boolean;
  /** Mods the settings say should be on. */
  enabled: string[];
  /** Plugins actually loaded, and stylesheets actually attached. */
  applied: string[];
  /** Mods that would not start, with why. */
  errors: Array<[string, string]>;
  /** Whether the panel's own button made it into Slack's chrome. */
  launcher: boolean;
}

interface BetterSlackGlobal {
  version: string;
  /** Which loader run created this instance. */
  sessionId: string;
  manager: ModManager;
  panel: Panel;
  open(): void;
  close(): void;
  dispose(): Promise<void>;
  /**
   * A summary of this run, for the live test and the watchdog.
   *
   * Deliberately on the global rather than behind the bridge: the point is to
   * be answerable from outside, over CDP, when something has gone wrong enough
   * that the bridge may not be moving.
   */
  health(): Health;
}

async function boot(): Promise<void> {
  const payload = window.__BETTERSLACK_BOOT__;
  if (!payload) return;

  /*
   * Claim the document before anything is awaited.
   *
   * `window.__betterslack` is only assigned at the *end* of this function, so two
   * boots that overlap -- the document-start script and the loader injecting
   * into the same live page, which is exactly what happens when a navigation
   * is caught mid-flight -- both find it empty, both build a Bridge, and both
   * start every plugin. The second Bridge overwrites the receiver on `window`,
   * and the first runtime's plugins are left holding a dead one: every request
   * they make is answered into a Map nobody reads, and times out fifteen
   * seconds later. Their buttons are still on screen, so the app looks fine
   * until something asks the loader a question.
   *
   * Found by way of a theme gallery that came up blank: six answers delivered
   * by the loader, six timeouts in the page.
   */
  if (window.__BETTERSLACK_BOOTING__ === payload.info.sessionId) return;
  window.__BETTERSLACK_BOOTING__ = payload.info.sessionId;

  const existing = window.__betterslack;
  if (existing) {
    // Same loader run injecting twice into one document: nothing to do, and
    // going further would double every observer.
    if (existing.sessionId === payload.info.sessionId) return;
    // A different run: the old instance's bridge is dead and its settings are
    // stale, so it has to go before the new one starts.
    await existing.dispose().catch((err) => {
      console.warn('[betterslack] could not dispose the previous runtime', err);
    });
    delete window.__betterslack;
  }

  const bridge = new Bridge();
  const manager = new ModManager(bridge, payload);

  /*
   * Cover the start.
   *
   * Between here and the last plugin mounting, Slack draws itself, a theme
   * repaints it, and buttons appear one at a time as their mods start. Each of
   * those is correct and the sequence looks like something going wrong.
   *
   * Never awaited, and it puts nothing on screen until there is a body to put
   * it in: this is a decoration, and a decoration may not be able to hold up
   * the runtime or throw inside it.
   */
  const splash = showSplash(
    // Asked for straight away and never waited on: the screen draws the still
    // mark until this answers, and keeps drawing it if it never does.
    bridge.request<string>({ type: 'app.art' }).catch(() => null),
    // Safe mode applies no theme, so its start screen wears none either.
    payload.info.safeMode ? '' : splashVarsFrom(payload),
    // A line a switched-on mod keeps for this screen. Safe mode runs no mod, so
    // it shows none of theirs either.
    payload.info.safeMode ? '' : splashLineFrom(payload),
  );

  /*
   * Every stylesheet BetterSlack owns, before a single plugin runs.
   *
   * `applyInitial` waits for Slack's client and then starts the plugins, so
   * anything installed after it lands *after* the first buttons are on screen.
   * PANEL_CSS went in there and LAUNCHER_CSS came later still, with
   * `installLauncher` -- and LAUNCHER_CSS is the only place a toolbar button's
   * icon is given a size. Every mod's button therefore appeared unstyled for as
   * long as the client took to build, then snapped into place.
   *
   * Both are static strings and need no DOM, so they go in first.
   * `installLauncher` sets the same key again when it mounts the button, which
   * is the same operation and not a second node.
   */
  manager.styles.set('plugin', '__panel', PANEL_CSS);
  manager.styles.set('plugin', '__launcher', LAUNCHER_CSS);

  // Themes are pure CSS and can go in before the DOM exists, which is what
  // keeps Slack from flashing its default palette on the way up.
  try {
    await manager.applyInitial((name, done, total) => splash.progress(name, done, total));
  } catch (err) {
    // The screen comes down on the way out of any failure, or a boot that threw
    // would leave the whole app behind a logo.
    splash.done();
    throw err;
  }
  const panel = new Panel(manager);
  // So a mod can open it without reaching into the page for it.
  manager.openPanel = (tab) => (tab ? panel.openAt(tab) : panel.open());
  // "Configure X" from the palette: the panel already knows how to draw a
  // manifest's settings, so the palette points at it rather than growing its
  // own form.
  manager.openMod = (id) => panel.openMod(id);

  let unmountUi: (() => void) | undefined;
  const mountUi = () => {
    unmountUi = installLauncher({
      onActivate: () => panel.toggle(),
      styles: manager.styles,
      /*
       * Everything there is to be told about, as one number: a BetterSlack
       * behind the one on GitHub, plus every installed mod that has moved on.
       *
       * Both arrive after boot and are refreshed hourly by the loader, so the
       * button is repainted rather than rebuilt when they do. Counting the mods
       * is the point of the count: with only the app in it this was a badge
       * that read 1 or nothing, which a dot would have said just as well.
       *
       * A blocked mod update -- one needing a newer BetterSlack -- is counted
       * like any other. It is still something that changed under the reader,
       * the panel says which version it wants, and the app update that unblocks
       * it is in the same number.
       */
      badge: () => (manager.update?.behind ? 1 : 0) + manager.modUpdates.length,
      onBadgeChange: (repaint) => manager.onChange(repaint),
    });
  };

  // Actually mount it. This call went missing when the palette moved out into a
  // plugin, and it took more with it than the button: `installLauncher` is also
  // what installs LAUNCHER_CSS, which is where every toolbar button's icon gets
  // its 20px. Without the call there was no BetterSlack button, and every mod's
  // button drew its icon at whatever size the SVG happened to carry.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountUi, { once: true });
  } else {
    mountUi();
  }

  // Everything the user was waiting for is now on screen: the themes are in,
  // every plugin has had its turn, and the launcher is in Slack's rail.
  splash.done();

  window.__betterslack = {
    version: payload.version,
    sessionId: payload.info.sessionId,
    manager,
    panel,
    open: () => panel.open(),
    close: () => panel.close(),
    health: () => ({
      version: payload.version,
      safeMode: payload.info.safeMode === true,
      enabled: [...manager.getSettings().enabled],
      applied: [
        ...manager.loadedPluginIds(),
        ...manager.getSettings().enabled.filter((id) => manager.styles.has('theme', id)),
      ],
      errors: [...manager.errors.entries()],
      launcher: Boolean(document.getElementById('betterslack-control-button')),
    }),
    dispose: async () => {
      panel.close();
      unmountUi?.();
      await manager.dispose();
    },
  };

  // The loader clears its crash marker on this. Sent after everything above,
  // so "up" means the panel exists and the mods have had their turn.
  bridge.notify({ type: 'app.ready' });

  // Once the start screen has lifted, never in front of it: the one question
  // BetterSlack asks at startup, and only when Slack's Dock icon was refused.
  setTimeout(() => void offerDockIcon(manager), 2500);

  console.log(
    `%c BetterSlack ${payload.version} %c ${payload.settings.enabled.length} mod(s) active — ⌘⇧M `,
    'background:#611f69;color:#fff;border-radius:3px 0 0 3px;padding:2px 4px',
    'background:#222;color:#ddd;border-radius:0 3px 3px 0;padding:2px 4px',
  );
}

void boot().catch((err) => {
  // Let the next attempt through: a boot that threw owns nothing.
  delete window.__BETTERSLACK_BOOTING__;
  console.error('[betterslack] boot failed', err);
});
