// The screen that covers Slack while BetterSlack is starting.
//
// Between the renderer coming up and the last plugin mounting there are several
// seconds in which Slack draws itself, then a theme repaints it, then buttons
// appear one at a time as their mods start. Every one of those is correct and
// the sequence looks like something going wrong. This covers it, and lifts when
// the mods are in.
//
// Three rules, each of which is the reason it is written this way rather than
// as fifteen lines of innerHTML:
//
//   * It runs at document-start, where `document.body` is genuinely null. So
//     nothing is built until there is somewhere to put it, and `done()` before
//     that simply cancels the whole thing.
//   * It covers the entire app, so it may never be what traps somebody. There
//     is a hard ceiling on how long it can stay, it is removed in a `finally`,
//     and it stops taking pointer events the moment it starts fading.
//   * It is in a shadow root with its own colours. At document-start Slack's
//     stylesheet has not loaded and its tokens do not exist yet -- so every
//     colour here carries a literal fallback, and picks the token up by itself
//     a moment later when a theme lands.

import { createI18n } from '../i18n.js';
import { MARK_SVG } from './mark.js';
import { PANEL_STRINGS } from './strings.js';

const HOST_ID = 'betterslack-splash';

/** What `splashVarsFrom` reads: the slice of the boot payload that names themes. */
interface ThemeSource {
  settings: { enabled: string[] };
  mods: Array<{ id: string; type: string }>;
  sources: Record<string, Record<string, string>>;
}

const SPLASH_VAR = /(--betterslack-splash-[a-z-]+)\s*:\s*((?:"[^"]*"|'[^']*'|[^;"'}])+)/g;

/**
 * The start screen a switched-on theme declares, read out of its stylesheet
 * text in the boot payload, as declarations for the splash's own host.
 *
 * Read from the text rather than off the computed style because the theme's
 * stylesheet reaches the document a beat after the splash does -- at
 * document-start there is no head to put it in -- and in that beat the
 * default screen would show. The payload already carries every enabled
 * theme's source, so the first frame can be the theme's. The last theme wins,
 * as its stylesheet does in the client.
 */
export function splashVarsFrom(payload: ThemeSource): string {
  const found = new Map<string, string>();
  try {
    for (const id of payload.settings.enabled) {
      if (payload.mods.find((mod) => mod.id === id)?.type !== 'theme') continue;
      for (const [file, text] of Object.entries(payload.sources[id] ?? {})) {
        if (!file.endsWith('.css')) continue;
        const css = text.replace(/\/\*[\s\S]*?\*\//g, '');
        for (const match of css.matchAll(SPLASH_VAR)) found.set(match[1]!, match[2]!.trim());
      }
    }
  } catch {
    return '';
  }
  return [...found].map(([name, value]) => `${name}: ${value};`).join(' ');
}

/** What `splashLineFrom` reads: the slice of the boot payload that names a mod's lines. */
interface LineSource {
  settings: { enabled: string[]; modSettings: Record<string, Record<string, unknown>> };
  mods: Array<{
    id: string;
    splash?: { setting: string };
    settings?: Array<{ key: string; default?: unknown }>;
  }>;
}

/**
 * The lines a switched-on mod has for the start screen, pooled across mods.
 *
 * A mod names a `textarea` setting in its manifest (`splash`), and this reads
 * that setting out of the boot payload -- the user's value, or the manifest's
 * default when they have never touched it. Read here rather than handed over
 * by the mod because the screen is up from the first frame and no plugin has
 * run yet; by the time one could say anything, the screen is coming down.
 *
 * One line per entry. Blank lines and lines starting with # are skipped, so a
 * long list can be kept in sections.
 */
export function splashLinesFrom(payload: LineSource): string[] {
  const lines: string[] = [];
  try {
    for (const id of payload.settings.enabled) {
      const mod = payload.mods.find((candidate) => candidate.id === id);
      const key = mod?.splash?.setting;
      if (!mod || !key) continue;
      const saved = payload.settings.modSettings[id]?.[key];
      const fallback = mod.settings?.find((field) => field.key === key)?.default;
      const text = typeof saved === 'string' ? saved : typeof fallback === 'string' ? fallback : '';
      for (const raw of text.split('\n')) {
        const line = raw.trim();
        if (line && !line.startsWith('#')) lines.push(line);
      }
    }
  } catch {
    return [];
  }
  return lines;
}

/** One of them, at random, or nothing at all when there are none. */
export function splashLineFrom(payload: LineSource, random: () => number = Math.random): string {
  const lines = splashLinesFrom(payload);
  if (lines.length === 0) return '';
  return lines[Math.min(lines.length - 1, Math.floor(random() * lines.length))]!;
}

/** Long enough for a slow client, short enough that a wedged one still clears. */
const CEILING_MS = 20_000;

/**
 * Below this it is a blink rather than a screen.
 *
 * Safe mode applies nothing at all, so without a floor the overlay would appear
 * and vanish inside one frame, which reads as a flash of something broken.
 */
const FLOOR_MS = 500;

const FADE_MS = 260;

const CSS = `
:host {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 22px;
  /* Slack's own surface once it exists, and its shade until then. */
  background: var(--betterslack-splash-background, var(--dt_color-base-pry, #1a1d21));
  opacity: 1;
  transition: opacity ${FADE_MS}ms ease-out;
  font-family: Lato, Slack-Lato, -apple-system, BlinkMacSystemFont, sans-serif;
}
:host(.betterslack-splash--out) { opacity: 0; pointer-events: none; }

/*
 * The still mark, and the animation over it.
 *
 * The mark is what is on screen for the first few milliseconds, while the
 * animation is being asked for -- and it is what stays if the answer never
 * comes or the video will not decode. So there is never an empty box, and
 * there is no second animation to keep in step with the first.
 */
.stage { position: relative; width: 88px; height: 88px; }
.mark, .art {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}
.mark svg { width: 100%; height: 100%; display: block; }
.art { opacity: 0; transition: opacity 180ms ease-out; object-fit: contain; }

/*
 * A theme's own start screen. Its declarations are written onto the host by
 * showSplash, and the stage takes the size the theme asks for -- a boot screen
 * is wider than a logo.
 */
.theme-art {
  position: absolute;
  inset: 0;
  display: none;
  background: var(--betterslack-splash-art) center / contain no-repeat;
}
.stage--theme {
  width: var(--betterslack-splash-width, 88px);
  height: var(--betterslack-splash-height, 88px);
}
.stage--theme .theme-art { display: block; }
.stage--theme .mark, .stage--theme .art { display: none; }

/* Swapped only once the video can actually play, so a decode that fails leaves
   the mark where it was rather than replacing it with nothing. */
.stage--art .art { opacity: 1; }
.stage--art .mark { opacity: 0; }

/*
 * A line a mod put on the start screen. The words are the point of it, so it
 * is the brightest thing under the mark, and the progress line stays quieter
 * beneath it. A theme can recolour it like the rest of the screen.
 */
.line {
  max-width: min(560px, calc(100vw - 48px));
  margin-top: -6px;
  font-size: 15px;
  line-height: 21px;
  font-weight: 700;
  text-align: center;
  color: var(--betterslack-splash-line, var(--dt_color-content-pry, rgba(232, 232, 232, .92)));
  animation: line-in 420ms cubic-bezier(.2, .9, .3, 1.2) both;
}
@keyframes line-in {
  from { opacity: 0; transform: translateY(6px) scale(.96); }
  to { opacity: 1; transform: none; }
}

.label {
  min-height: 18px;
  font-size: 13px;
  line-height: 18px;
  letter-spacing: .2px;
  color: var(--betterslack-splash-text, var(--dt_color-content-ter, rgba(209, 210, 211, .62)));
}

/*
 * Reduced motion is honoured by never asking for the video at all, since CSS
 * cannot stop one playing -- see wantsStillness below. What is left is the
 * still mark, breathing, which says "working" without moving anything.
 *
 * The Motion mod deliberately ignores this setting. Installing a mod called
 * Motion is a statement of intent about animation; starting Slack is not.
 *
 * No backticks anywhere in this string, comments included: one closes the
 * template literal and the runtime throws at boot with nothing styled to show
 * for it.
 */
@media (prefers-reduced-motion: reduce) {
  .mark { animation: breathe 2s ease-in-out infinite; }
  .line { animation: none; }
  @keyframes breathe { 0%, 100% { opacity: .55; } 50% { opacity: 1; } }
}
`;

/**
 * Built on first use, never at module scope.
 *
 * This file is evaluated at document-start, where `document.documentElement` is
 * null -- and `createI18n` reads the language off it. A translator built as the
 * module loads threw there and took the whole bundle down with it, which is the
 * bug that made both renderer freezes reachable.
 */
let translator: ReturnType<ReturnType<typeof createI18n>['strings']> | null = null;
const t = (key: string, vars?: Record<string, string>): string => {
  try {
    translator ??= createI18n().strings(PANEL_STRINGS);
    return translator(key, vars);
  } catch {
    return '';
  }
};

export interface Splash {
  /** Say what is starting, so a slow mod is named rather than guessed at. */
  progress(name: string, done: number, total: number): void;
  /** Fade and remove. Safe to call twice, and before it ever appeared. */
  done(): void;
}

/** True when the machine has asked for as little movement as possible. */
function wantsStillness(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** A splash that was never wanted, for the paths that must not branch. */
const NOTHING: Splash = { progress: () => undefined, done: () => undefined };

/**
 * Put the screen up, and hand back the two things the caller needs.
 *
 * Returns immediately. Nothing here is awaited by `boot()`: a splash that could
 * hold up the runtime would be a decoration with the power to stop the app.
 */
export function showSplash(art?: Promise<string | null>, themeVars = '', line = ''): Splash {
  if (typeof document === 'undefined') return NOTHING;

  let host: HTMLElement | null = null;
  let label: HTMLElement | null = null;
  let pending = t('splashLoading');
  let finished = false;
  let observer: MutationObserver | null = null;
  const shownAt = Date.now();

  const build = (): void => {
    if (finished || host || !document.body) return;
    try {
      host = document.createElement('div');
      host.id = HOST_ID;
      // Out of the accessibility tree: it says nothing a screen reader needs,
      // and it is on top of everything Slack is building underneath it.
      host.setAttribute('aria-hidden', 'true');
      const root = host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      // The theme's own start screen, on the host itself, so it is the very
      // first frame rather than the one after the theme's stylesheet lands.
      style.textContent = themeVars ? `${CSS}\n:host { ${themeVars} }` : CSS;
      const stage = document.createElement('div');
      stage.className = 'stage';
      const mark = document.createElement('div');
      mark.className = 'mark';
      mark.innerHTML = MARK_SVG;
      const themeArt = document.createElement('div');
      themeArt.className = 'theme-art';
      stage.append(mark, themeArt);
      if (themeVars.includes('--betterslack-splash-art')) stage.classList.add('stage--theme');
      void playArt(stage);
      label = document.createElement('div');
      label.className = 'label';
      // Asked for again here rather than trusted from above: the first attempt
      // happened at document-start, where there is no <html> to read a language
      // off and the translator answers with nothing.
      label.textContent = pending || t('splashLoading');
      root.append(style, stage);
      if (line) {
        const words = document.createElement('div');
        words.className = 'line';
        words.textContent = line;
        root.append(words);
      }
      root.append(label);
      document.body.append(host);
    } catch {
      // A splash that throws must cost nothing: the app behind it is fine.
      host = null;
    }
  };

  /**
   * Put the animation over the mark, once there is one and it will play.
   *
   * Never awaited by anything that matters, and every step of it is allowed to
   * come to nothing: the still mark underneath is the whole fallback, so a
   * refused request, a codec that is gone or a screen that has already lifted
   * all end the same way -- with what was already on screen.
   */
  const playArt = async (stage: HTMLElement): Promise<void> => {
    // CSS cannot stop a video playing, so the setting is honoured by not asking
    // for one. The mark breathes instead.
    if (!art || wantsStillness()) return;
    let base64: string | null = null;
    try {
      base64 = await art;
    } catch {
      return;
    }
    if (!base64 || finished || !stage.isConnected) return;
    // A theme's own start screen replaces the animation, so nothing is decoded.
    if (stage.classList.contains('stage--theme')) return;

    const video = document.createElement('video');
    video.className = 'art';
    video.muted = true;
    video.loop = true;
    video.autoplay = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('aria-hidden', 'true');
    /*
     * A data: URL rather than a blob:, and both were measured against a live
     * client -- Slack's policy names base-uri, object-src and script-src and no
     * default-src, so media is unrestricted and either works. This one needs
     * nothing revoking afterwards.
     */
    video.src = `data:video/webm;base64,${base64}`;
    // Only then is the mark swapped out: a video that cannot decode leaves the
    // mark on screen rather than an empty square.
    video.addEventListener('canplay', () => stage.classList.add('stage--art'), { once: true });
    stage.append(video);
    /*
     * Optional-chained on purpose: `play()` returns a promise in a browser and
     * nothing at all where media is not implemented, and an autoplay that is
     * refused is not a failure worth reporting -- the video is muted and looping
     * and the still mark is underneath it either way.
     */
    try {
      void video.play()?.catch(() => undefined);
    } catch {
      // Same again: there is nothing to do about it and nothing to say.
    }
  };

  const stopWatching = (): void => {
    observer?.disconnect();
    observer = null;
  };

  build();
  if (!host) {
    /*
     * No body yet, which at document-start is the ordinary case rather than the
     * odd one. The Document node is observable and sees <html> itself arrive,
     * which is the same fallback `waitForClient` and `dom.waitFor` take.
     */
    try {
      observer = new MutationObserver(() => {
        build();
        if (host) stopWatching();
      });
      observer.observe(document.documentElement ?? document, { childList: true, subtree: true });
    } catch {
      stopWatching();
    }
  }

  const remove = (): void => {
    stopWatching();
    host?.classList.add('betterslack-splash--out');
    const node = host;
    host = null;
    setTimeout(() => node?.remove(), FADE_MS);
  };

  // The ceiling. A mod that never returns, a client that never builds: neither
  // may leave somebody looking at a logo with their Slack behind it.
  const ceiling = setTimeout(() => {
    if (finished) return;
    finished = true;
    console.warn('[betterslack] the start screen timed out — showing Slack anyway');
    remove();
  }, CEILING_MS);

  return {
    progress(name, done, total) {
      pending = name
        ? t('splashStarting', { name, done: String(done + 1), total: String(total) })
        : t('splashLoading');
      if (label) label.textContent = pending;
    },
    done() {
      if (finished) return;
      finished = true;
      clearTimeout(ceiling);
      const left = FLOOR_MS - (Date.now() - shownAt);
      if (left > 0) setTimeout(remove, left);
      else remove();
    },
  };
}
