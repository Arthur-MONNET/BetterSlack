// The Mods panel.
//
// Built from Slack's own dialog and menu markup — `c-dialog`, `c-dialog__content`,
// `c-menu_item__button` and friends — and rendered into the light DOM rather
// than a shadow root, so Slack's stylesheet applies to it directly.
//
// That is the point. A shadow root meant reimplementing Slack's look from
// tokens, which lands close but never exactly, and never follows a theme the
// way Slack's own dialogs do.
//
// The trade-off, stated plainly: a theme that restyles `.c-dialog` restyles
// this panel too. Here that is the intended behaviour — the panel should look
// like it belongs to whatever theme is on — but it does mean a careless theme
// can make it ugly. Everything under `mods/themes/` is reviewed, so that is a
// fair deal.

import { slackVersionIsNewer } from '../../shared/protocol.js';
import type { ModRecord, ModSettingField, RemoteMod } from '../../shared/protocol.js';
import { h } from '../dom.js';
import type { ModManager } from '../manager.js';
import { contributeUrl, repoUrl } from '../registry.js';
import { createCodeEditor } from './code.js';
import { closeMenu, openMenu } from './menu.js';
import { mountCounts } from '../dom.js';
import { createI18n } from '../i18n.js';
import { MARK_SVG } from './mark.js';
import { renderMarkdown } from './markdown.js';
import { sortMods, type SortId } from './sort.js';
import { PANEL_STRINGS } from './strings.js';
import { requestDockIcon } from './dock-icon.js';

type TabId = 'themes' | 'plugins' | 'css' | 'about';
/*
 * Two shelves, not three.
 *
 * There was an Enabled one between them, and it was a filter wearing a tab's
 * clothes: everything on it was on Installed as well, so the same mod sat in
 * two places and switching one off made it vanish from under the pointer. What
 * it was actually for -- "show me what is on" -- is a sort order now, next to
 * the others.
 */
type ShelfId = 'installed' | 'browse';

/**
 * Slack's select, which is not a `<select>`.
 *
 * Slack draws one as a bordered button that opens a `c-menu` -- `c-input_select`
 * for the box, `__selected_value` for the label, `__chevron` for the arrow --
 * and never as a native dropdown. Borrowing the classes gets the size, the
 * radius, the focus ring and every theme for nothing; borrowing the behaviour
 * gets a list that looks like the rest of the app rather than like whatever the
 * operating system draws, which on a dark theme is a white rectangle.
 *
 * `openMenu` is the same one the row overflow uses, so there is one menu in the
 * document at a time and Escape closes it.
 */
function selectButton(
  options: Array<{ value: string; label: string }>,
  value: string,
  onPick: (value: string) => void,
  extra = '',
): HTMLElement {
  const selected = options.find((option) => option.value === value) ?? options[0];
  const button = h('button', {
    class: `c-input_select betterslack-select${extra ? ` ${extra}` : ''}`,
    type: 'button',
    'aria-haspopup': 'listbox',
  }, [
    h('span', { class: 'c-input_select__selected_value' }, [selected?.label ?? '']),
    h('span', { class: 'c-input_select__chevron betterslack-select__chevron' }),
  ]);
  // The arrow is markup, so it goes in as markup rather than through `h`.
  const chevron = button.querySelector('.betterslack-select__chevron');
  if (chevron) chevron.innerHTML = CHEVRON;
  button.addEventListener('click', (event) => {
    event.preventDefault();
    openMenu(button, options.map((option) => ({
      label: option.label,
      onSelect: () => onPick(option.value),
    })));
  });
  return button;
}

/** Slack draws its own with an icon font; this is the same shape, as a path. */
const CHEVRON = '<svg viewBox="0 0 20 20" aria-hidden="true">'
  + '<path d="M5.5 8l4.5 4.5L14.5 8" fill="none" stroke="currentColor" '
  + 'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const SORTS: Record<ShelfId, SortId[]> = {
  // Neither install order nor "on first" means anything for a mod you have not
  // got, so Browse is offered the two that do.
  browse: ['az', 'za'],
  installed: ['recent', 'az', 'za', 'enabled'],
};

/** The lines a text setting holds, as its counter shows them: blank ones are not lines. */
function countLines(text: string): number {
  return text.split('\n').filter((line) => line.trim()).length;
}

const HOST_ID = 'betterslack-panel';
/** The shared menu's layer, so Escape can tell it apart from the panel. */
const MENU_ID = 'betterslack-menu-layer';
const REQUIRES_ID = 'betterslack-requires';
/** The dialog a long text setting opens into, so Escape can close it first. */
const EDITOR_ID = 'betterslack-text-editor';

const CLOSE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true" style="--s:20px">
  <path fill="currentColor" d="M5.72 5.72a.75.75 0 0 1 1.06 0L10 8.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L11.06 10l3.22 3.22a.75.75 0 1 1-1.06 1.06L10 11.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L8.94 10 5.72 6.78a.75.75 0 0 1 0-1.06Z"/>
</svg>`;

const OVERFLOW_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true" style="--s:20px">
  <path fill="currentColor" d="M5 10a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm6.5 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm5 1.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"/>
</svg>`;

/**
 * The panel's own translator.
 *
 * Built on first use and then kept, rather than at module load. The language
 * cannot change without Slack reloading, so caching it is right -- but this
 * module is evaluated the instant the runtime is injected, which at
 * document-start is before `<html lang>` exists. Building it there read the
 * language off a document that had none, and cached the wrong answer for the
 * whole session even once the crash it also caused was fixed.
 */
type Translate = ReturnType<ReturnType<typeof createI18n>['strings']>;

/**
 * A mod's own words, in the reader's language.
 *
 * `description` is required and English; `descriptions` carries the rest. The
 * fallback chain is the same one `api.i18n` gives mods -- exact tag, then
 * language, then English -- so a mod translated into "fr" is read by a "fr-CA"
 * client rather than falling back to English for a regional tag nobody wrote.
 */
export function localised(
  fallback: string,
  translations: Record<string, string> | undefined,
  locale: string,
): string {
  if (!translations) return fallback;
  const language = locale.split('-')[0] ?? locale;
  return translations[locale] ?? translations[language] ?? fallback;
}
let locale: string | null = null;
/** The client's language, read when it is first needed rather than at load. */
const language = (): string => (locale ??= createI18n().locale);

let translator: Translate | null = null;
const t: Translate = (key, vars) => {
  translator ??= createI18n().strings(PANEL_STRINGS);
  return translator(key, vars);
};

export class Panel {
  private host: HTMLElement | null = null;
  private tab: TabId = 'themes';
  private shelf: ShelfId = 'installed';
  private scrollTop = 0;
  private search = '';
  private busy = new Set<string>();

  constructor(private readonly manager: ModManager) {
    manager.onChange(() => this.renderIfOpen());
  }

  get isOpen(): boolean {
    return this.host !== null;
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  open(): void {
    if (this.isOpen) return;
    this.renderedTab = null;
    this.host = h('div', { id: HOST_ID, class: 'c-dialog betterslack-dialog', role: 'presentation' });
    document.body.append(this.host);
    document.addEventListener('keydown', this.onKeyDown, true);
    this.render();
    queueMicrotask(() => this.host?.querySelector<HTMLElement>('.betterslack-nav__item')?.focus());

    /*
     * A fresh answer on opening, once a session and never during a render.
     *
     * The list itself comes from the manager, which the loader keeps up to date
     * hourly -- this is only so that somebody who opens the panel *because* of
     * the badge is not reading something up to an hour old. The manager
     * notifies, so nothing here has to re-render by hand.
     */
    if (!this.checkedModUpdates) {
      this.checkedModUpdates = true;
      void this.manager.refreshModUpdates();
    }
  }

  /** Open straight to a tab, for the palette's doors. */
  openAt(tab: 'themes' | 'plugins' | 'css' | 'about'): void {
    this.tab = tab;
    if (this.isOpen) this.render();
    else this.open();
  }

  /**
   * Open on one mod, with its settings unfolded.
   *
   * The palette can offer "Configure X" without knowing anything about how a
   * setting is drawn, checked or saved: the manifest describes it and this
   * panel is the one place that renders it. Everything here is what a person
   * would have done by hand -- the right tab, the Installed shelf, no filter in
   * the way, that row's settings open -- so what they end up looking at is a
   * panel they could have reached themselves.
   */
  openMod(id: string): void {
    const mod = this.manager.list().find((entry) => entry.id === id);
    if (!mod) return;

    this.tab = mod.type === 'theme' ? 'themes' : 'plugins';
    this.shelf = 'installed';
    this.search = '';
    this.tag = null;
    // The mod's own page, which is where its description, its picture, what it
    // is for and its settings all are. Before there was one this opened the
    // row's settings drawer, which showed the settings and nothing else.
    this.detail = id;
    this.openSettings.add(id);
    this.scrollTop = 0;
    if (this.isOpen) this.render();
    else this.open();

    // After the render, because the row does not exist until then.
    requestAnimationFrame(() => {
      this.host
        ?.querySelector<HTMLElement>(`[data-betterslack-mod="${CSS.escape(id)}"]`)
        ?.scrollIntoView({ block: 'center' });
    });
  }

  close(): void {
    this.closeMenu();
    this.dismissEditor?.();
    this.dismissRequires?.();
    this.host?.remove();
    this.host = null;
    document.removeEventListener('keydown', this.onKeyDown, true);
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !this.isOpen) return;
    event.stopPropagation();
    // Innermost first: Escape should dismiss the consent dialog without also
    // closing the panel behind it.
    if (document.getElementById(EDITOR_ID)) this.dismissEditor?.();
    else if (document.getElementById(REQUIRES_ID)) this.dismissRequires?.();
    else if (document.getElementById(MENU_ID)) this.closeMenu();
    else this.close();
  };

  private renderIfOpen(): void {
    if (this.isOpen) this.render();
  }

  /** Put the list back where the user left it after a re-render. */
  private restoreScroll(): void {
    const body = this.host?.querySelector<HTMLElement>('.c-dialog__body');
    if (body && this.scrollTop > 0 && body.scrollTop !== this.scrollTop) {
      body.scrollTop = this.scrollTop;
    }
  }

  /**
   * The tab the last render drew, so a render can tell a tab *change* from the
   * several renders a single toggle causes.
   *
   * The panel rebuilds itself wholesale every time anything changes, so an
   * animation on the body would otherwise fire on every click in the list --
   * three or four times in a frame, which reads as a flicker rather than as a
   * transition. Null until the first render, so opening the panel does not
   * animate the body on top of the dialog's own arrival.
   */
  private renderedTab: TabId | null = null;

  private render(): void {
    const host = this.host;
    if (!host) return;
    this.closeMenu();
    host.replaceChildren();

    const tabChanged = this.renderedTab !== null && this.renderedTab !== this.tab;
    this.renderedTab = this.tab;

    const close = h('button', {
      class:
        'c-button-unstyled c-icon_button c-icon_button--size_medium c-icon_button--default betterslack-close',
      type: 'button',
      'aria-label': t('close'),
    });
    close.innerHTML = CLOSE_ICON;
    close.addEventListener('click', () => this.close());

    const body = h('div', {
      // The class is put on at build time rather than added afterwards: this is
      // a brand new node every render, so the animation runs when it mounts and
      // there is no reflow to force and nothing to clean up.
      class: `c-dialog__body betterslack-body${tabChanged ? ' betterslack-body--enter' : ''}`,
    });
    // The panel re-renders wholesale on every change, and one toggle triggers
    // several renders in a frame; the user's own scrolling is the only
    // reliable source of position.
    body.addEventListener('scroll', () => {
      this.scrollTop = body.scrollTop;
    }, { passive: true });

    const content = h('div', {
      class: 'c-dialog__content betterslack-content',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': 'BetterSlack',
    }, [
      h('div', { class: 'c-dialog__header betterslack-header' }, [
        // The mark and the word as one lockup, so the gap between them is a
        // lockup's gap rather than the header's -- which is the distance the
        // close button is kept at, and far too wide next to a title.
        h('div', { class: 'betterslack-brand' }, [
          h('span', { class: 'betterslack-brand__mark', 'aria-hidden': 'true' }),
          h('h1', { class: 'c-dialog__title' }, [t('title')]),
        ]),
        close,
      ]),
      h('div', { class: 'betterslack-layout' }, [this.renderNav(), body]),
    ]);

    // innerHTML rather than a node built by hand: the mark is markup, and `h`
    // has no business parsing it.
    const mark = content.querySelector('.betterslack-brand__mark');
    if (mark) mark.innerHTML = MARK_SVG;

    host.append(content);
    host.addEventListener('mousedown', (event) => {
      if (event.target === host) this.close();
    });

    this.renderBody(body);
    requestAnimationFrame(() => this.restoreScroll());
  }

  private renderNav(): HTMLElement {
    const mods = this.manager.list();
    const count = (type: 'theme' | 'plugin') =>
      mods.filter((m) => m.type === type && this.manager.isInstalled(m.id)).length;

    /*
     * A dot on the tab the update belongs to.
     *
     * The notices themselves render above whatever tab is open, so this is not
     * how somebody finds them -- it is how they know, before reading anything,
     * whether the thing that is out of date is a theme, a plugin or BetterSlack
     * itself. That is the same question the dot on the launcher raises and does
     * not answer.
     */
    const updated = (type: 'theme' | 'plugin') =>
      this.manager.modUpdates.some((update) => update.type === type);

    const items: { id: TabId; label: string; count?: number; dot?: boolean }[] = [
      { id: 'themes', label: t('themes'), count: count('theme'), dot: updated('theme') },
      { id: 'plugins', label: t('plugins'), count: count('plugin'), dot: updated('plugin') },
      { id: 'css', label: t('css') },
      { id: 'about', label: t('about'), dot: this.manager.update?.behind === true },
    ];

    const nav = h('nav', { class: 'betterslack-nav', role: 'tablist' });
    for (const item of items) {
      const button = h('button', {
        class: 'c-button-unstyled betterslack-nav__item',
        role: 'tab',
        'aria-selected': String(this.tab === item.id),
        type: 'button',
      }, [item.label]);
      if (item.dot) {
        // Before the count, which is pushed to the right edge, so a tab with a
        // number and a tab without wear the dot in the same place.
        button.append(h('span', {
          class: 'betterslack-nav__dot',
          role: 'img',
          'aria-label': t('updateAvailable'),
        }));
      }
      if (item.count !== undefined) {
        button.append(h('span', { class: 'betterslack-count' }, [String(item.count)]));
      }
      button.addEventListener('click', () => {
        if (this.tab === item.id) return;
        this.tab = item.id;
        this.scrollTop = 0;
        this.search = '';
        this.render();
      });
      nav.append(button);
    }
    return nav;
  }

  private renderBody(body: HTMLElement): void {
    const mods = this.manager.list();
    /*
     * Each notice on the tab that owns it: BetterSlack's own under About, a
     * theme's under Themes, a plugin's under Plugins.
     *
     * That only works because the tab wears a dot when it has one and the
     * launcher wears the count -- a notice you have to go looking for is a
     * notice nobody finds, and without the badge these had to be on every tab
     * to be seen at all. With it, putting a plugin's update on the Themes tab
     * is the thing that reads as a mistake.
     *
     * Safe mode stays everywhere. It is not an offer, it is the reason nothing
     * on any tab is running.
     */
    body.append(...this.renderSafeMode());
    if (this.tab === 'about') body.append(...this.renderUpdate());
    if (this.tab === 'themes' || this.tab === 'plugins') {
      body.append(...this.renderModUpdates(this.tab === 'themes' ? 'theme' : 'plugin'));
    }

    if (this.detail) {
      const mod = mods.find((entry) => entry.id === this.detail);
      if (mod) {
        body.append(...this.renderDetail(mod));
        return;
      }
      this.detail = null;
    }

    switch (this.tab) {
      case 'themes':
        body.append(...this.renderShelves(mods.filter((m) => m.type === 'theme')));
        break;
      case 'plugins':
        body.append(...this.renderShelves(mods.filter((m) => m.type === 'plugin')));
        break;
      case 'css':
        body.append(...this.renderCustomCss());
        break;
      case 'about':
        body.append(...this.renderAbout());
        break;
    }
  }

  /**
   * Installed and Browse. The repository is a catalogue: nothing is installed
   * until you say so, so a fresh setup opens on an empty Installed shelf and a
   * full Browse shelf.
   */
  private renderShelves(mods: ModRecord[]): Node[] {
    const installed = mods.filter((m) => this.manager.isInstalled(m.id));
    const shelves: { id: ShelfId; label: string; list: ModRecord[] }[] = [
      { id: 'installed', label: t('installed'), list: installed },
      { id: 'browse', label: t('browse'), list: mods.filter((m) => !this.manager.isInstalled(m.id)) },
    ];

    const tabs = h('div', { class: 'betterslack-shelves', role: 'tablist' });
    for (const shelf of shelves) {
      const button = h('button', {
        class: 'c-button-unstyled betterslack-shelf',
        role: 'tab',
        'aria-selected': String(this.shelf === shelf.id),
        type: 'button',
      }, [shelf.label, h('span', { class: 'betterslack-count' }, [String(shelf.list.length)])]);
      button.addEventListener('click', () => {
        if (this.shelf === shelf.id) return;
        this.shelf = shelf.id;
        this.scrollTop = 0;
        this.render();
      });
      tabs.append(button);
    }

    const current = shelves.find((shelf) => shelf.id === this.shelf) ?? shelves[0]!;

    const search = h('input', {
      class: 'c-input_text betterslack-search',
      type: 'text',
      placeholder: t('search'),
      spellcheck: 'false',
    }) as HTMLInputElement;
    search.value = this.search;
    // Its own container, so typing does not rebuild the panel and take focus
    // back off the input.
    search.addEventListener('input', () => {
      this.search = search.value;
      this.renderList(current.list);
    });

    /*
     * Tags, as filters, from what is actually on the shelf.
     *
     * Not a fixed list: a tag nobody uses would be a filter that always returns
     * nothing, and a mod introducing one would have to come back here. Hidden
     * entirely when there is nothing to choose between.
     */
    const tags = [...new Set(current.list.flatMap((mod) => mod.tags ?? []))].sort();
    const filters = h('div', { class: 'betterslack-filters' });
    if (tags.length > 1) {
      for (const tag of [null, ...tags]) {
        const active = this.tag === tag;
        const chip = h('button', {
          class: 'c-button-unstyled betterslack-filter',
          type: 'button',
          'aria-pressed': String(active),
        }, [tag ?? t('filterAll')]);
        chip.addEventListener('click', () => {
          this.tag = active ? null : tag;
          this.renderList(current.list);
          for (const other of filters.querySelectorAll('.betterslack-filter')) {
            other.setAttribute('aria-pressed', String(other === chip && !active));
          }
        });
        filters.append(chip);
      }
    }

    queueMicrotask(() => this.renderList(current.list));

    const SORT_LABELS: Record<SortId, string> = {
      recent: t('sortRecent'),
      az: t('sortAz'),
      za: t('sortZa'),
      enabled: t('sortEnabled'),
    };
    const sort = selectButton(
      SORTS[current.id].map((id) => ({ value: id, label: SORT_LABELS[id] })),
      this.sortFor(current.id),
      (picked) => {
        // Written through the loader, so it is still the order tomorrow. The
        // whole shelf is re-rendered rather than only the list, because the
        // button itself has to redraw with the label that was just chosen.
        void this.manager.patchSettings({ panelSort: picked });
        this.render();
      },
      'betterslack-sort',
    );
    sort.setAttribute('aria-label', t('sortLabel'));

    return [
      h('div', { class: 'betterslack-toolbar' }, [
        tabs,
        h('div', { class: 'betterslack-filterbar' }, [search, sort]),
      ]),
      ...(this.shelf === 'browse' ? [this.renderRemoteInstall(), ...this.renderSkipped()] : []),
      ...(tags.length > 1 ? [filters] : []),
      h('div', { class: 'betterslack-list' }),
    ];
  }

  /** The sort in force on this shelf, falling back where one does not apply. */
  private sortFor(shelf: ShelfId): SortId {
    const wanted = this.manager.getSettings().panelSort as SortId | undefined;
    const allowed = SORTS[shelf];
    return wanted && allowed.includes(wanted) ? wanted : allowed[0]!;
  }

  private renderList(mods: ModRecord[]): void {
    const host = this.host?.querySelector('.betterslack-list');
    if (!host) return;

    const query = this.search.trim().toLowerCase();
    let list = query
      ? mods.filter((m) =>
          `${m.name} ${m.description} ${(m.tags ?? []).join(' ')}`.toLowerCase().includes(query))
      : mods;
    if (this.tag) list = list.filter((mod) => (mod.tags ?? []).includes(this.tag!));
    list = sortMods(list, this.sortFor(this.shelf), {
      installedOrder: this.manager.getSettings().installed,
      isEnabled: (id) => this.manager.isEnabled(id),
    });

    host.replaceChildren();

    if (list.length === 0) {
      const messages: Record<ShelfId, string> = {
        installed: t('nothingInstalled'),
        browse: t('allInstalled'),
      };
      host.append(h('div', { class: 'betterslack-empty' }, [
        query ? t('noMatch') : messages[this.shelf],
      ]));
      return;
    }

    for (const mod of list) host.append(this.renderRow(mod));
    this.restoreScroll();
  }

  /**
   * One mod's page: what it looks like, what it says about itself, what it
   * costs, and the switch.
   *
   * The catalogue is a shop before it is a list of installed things, and a
   * shop that shows one line per item is asking people to install blind. The
   * pieces are the ones a mod can actually provide -- a mark, a sentence in
   * your language, pictures, and a readme -- and every one of them is
   * optional: a mod that offers none of it still renders as its row did.
   */
  private renderDetail(mod: ModRecord): Node[] {
    const back = h('button', { class: 'c-button-unstyled betterslack-back', type: 'button' }, [
      t('backToList'),
    ]);
    back.addEventListener('click', () => {
      this.detail = null;
      this.scrollTop = 0;
      this.render();
    });

    const title = h('div', { class: 'betterslack-detail__title' }, [
      h('h2', { class: 'betterslack-detail__name' }, [mod.name]),
      h('div', { class: 'betterslack-row__sub' }, [
        t('byLine', { version: mod.version, author: mod.author }),
      ]),
    ]);
    for (const tag of mod.tags ?? []) {
      title.querySelector('.betterslack-row__sub')?.append(h('span', { class: 'betterslack-tag' }, [tag]));
    }

    /*
     * Shown only when both numbers are known and the mod's is the higher one.
     *
     * A mod says which Slack it was written against; the loader reads which
     * Slack is running, where that can be read at all. Anything else -- an
     * undeclared mod, a Linux install whose version nothing can name -- says
     * nothing, because a compatibility warning that appears when nothing is
     * wrong is one people learn to click past.
     */
    if (mod.slackVersion && slackVersionIsNewer(mod.slackVersion, this.manager.info.slackVersion)) {
      title.append(h('div', { class: 'betterslack-row__requires--missing' }, [
        t('slackTooOld', { wanted: mod.slackVersion, have: this.manager.info.slackVersion! }),
      ]));
    }

    /*
     * Where a mod may make requests through the loader: the addresses its
     * `network` settings hold, or that it will ask for one. Said on its page
     * because a third-party mod has had no review to say it for it.
     */
    const networkKeys = mod.network?.settings ?? [];
    if (networkKeys.length > 0) {
      const values = this.manager.getSettings().modSettings[mod.id] ?? {};
      const addresses = networkKeys
        .map((key) => values[key] ?? mod.settings?.find((field) => field.key === key)?.default)
        .filter((value): value is string => typeof value === 'string' && value.trim() !== '');
      title.append(h('div', { class: 'betterslack-row__sub' }, [
        addresses.length > 0
          ? t('networkTo', { addresses: addresses.join(', ') })
          : t('networkUnset'),
      ]));
      if (mod.network?.credential) {
        title.append(h('div', { class: 'betterslack-row__sub' }, [t('networkCredential')]));
      }
    }

    const head = h('div', { class: 'betterslack-detail__head' }, [
      this.renderIcon(mod, 'lg'),
      title,
      // The same controls as the row, so there is one place that decides what
      // installing or switching on means.
      this.renderRow(mod).querySelector('.betterslack-row__actions') ?? h('div'),
    ]);

    const lede = localised(mod.description, mod.descriptions, language()).trim();
    const parts: Node[] = [back, head, h('p', { class: 'betterslack-detail__lede' }, [lede])];

    const shots = mod.screenshots ?? [];
    if (shots.length > 0) {
      const strip = h('div', { class: 'betterslack-shots' });
      for (const shot of shots) {
        const figure = h('figure', { class: 'betterslack-shot' });
        const image = h('img', { alt: localised(shot.caption ?? '', shot.captions, language()) });
        figure.append(image);
        const caption = localised(shot.caption ?? '', shot.captions, language());
        if (caption) figure.append(h('figcaption', {}, [caption]));
        strip.append(figure);
        // Fetched one at a time, and only now: the catalogue carries text.
        void this.manager.asset(mod.id, shot.file).then((url) => {
          if (url) (image as HTMLImageElement).src = url;
          else figure.remove();
        });
      }
      parts.push(strip);
    }

    /*
     * The readme, minus what is already above it.
     *
     * A mod's README.md is also a file people read in the repository, so it
     * opens with the mod's name and its description -- and on this page that
     * is the heading and the paragraph the reader has just read. Trimmed here
     * rather than left out of the file: the file has to stand on its own.
     */
    const readme = localised(mod.readmeText ?? '', mod.readmeTexts, language())
      .replace(/^\s*#\s+.*\n/, '')
      .replace(new RegExp(`^\\s*${lede.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`), '');
    if (readme.trim()) {
      const article = h('div', { class: 'betterslack-detail__readme sm-md' });
      article.innerHTML = renderMarkdown(readme, {
        // A picture in a readme is a file in the mod's folder; nothing else is
        // fetched, and a path that leaves the folder is dropped by the loader.
        resolve: (href: string) => {
          if (/^(https?:|mailto:|slack:)/i.test(href)) return href;
          const slot = `betterslack-md-${Math.random().toString(36).slice(2)}`;
          void this.manager.asset(mod.id, href).then((url) => {
            const node = article.querySelector(`[src="${slot}"]`);
            if (url && node) node.setAttribute('src', url);
            else node?.remove();
          });
          return slot;
        },
      });
      parts.push(article);
    }

    const fields = mod.settings ?? [];
    if (fields.length > 0 && this.manager.isEnabled(mod.id)) {
      parts.push(h('h3', { class: 'betterslack-detail__section' }, [t('settingsTitle')]));
      parts.push(this.renderModSettings(mod, fields));
    }

    return [h('div', { class: 'betterslack-detail' }, parts)];
  }

  private renderRow(mod: ModRecord): HTMLElement {
    const installed = this.manager.isInstalled(mod.id);
    const enabled = this.manager.isEnabled(mod.id);
    const busy = this.busy.has(mod.id);

    const actions = h('div', { class: 'betterslack-row__actions' });

    if (installed) {
      const input = h('input', {
        type: 'checkbox',
        id: `betterslack-toggle-${mod.id}`,
        'aria-label': `Enable ${mod.name}`,
      }) as HTMLInputElement;
      input.checked = enabled;
      input.disabled = busy;
      input.addEventListener('change', () => {
        void this.withBusy(mod.id, () =>
          input.checked ? this.enableWithRequirements(mod) : this.manager.setEnabled(mod.id, false));
      });

      // A Remove button on every row shouted louder than anything else in the
      // dialog. Slack puts destructive actions behind an overflow menu.
      const overflow = h('button', {
        class:
          'c-button-unstyled c-icon_button c-icon_button--size_smedium c-icon_button--default betterslack-row__more',
        type: 'button',
        'aria-label': `More actions for ${mod.name}`,
        'aria-haspopup': 'menu',
      });
      overflow.innerHTML = OVERFLOW_ICON;
      overflow.addEventListener('click', (event) => {
        event.stopPropagation();
        this.openMenu(overflow, mod);
      });

      actions.append(overflow, h('label', { class: 'betterslack-switch', for: input.id }, [
        input,
        h('span', { class: 'betterslack-switch__track' }, [
          h('span', { class: 'betterslack-switch__thumb' }),
        ]),
      ]));
    } else {
      const install = h('button', {
        class: 'c-button c-button--outline c-button--medium',
        type: 'button',
      }, [t('install')]) as HTMLButtonElement;
      install.disabled = busy;
      install.addEventListener('click', () => {
        void this.withBusy(mod.id, () => this.manager.setInstalled(mod.id, true));
      });
      actions.append(install);
    }

    const open = h('button', {
      class: 'c-button-unstyled betterslack-row__open',
      type: 'button',
      'aria-label': mod.name,
    }, [mod.name]);
    open.addEventListener('click', () => {
      this.detail = mod.id;
      this.scrollTop = 0;
      this.render();
    });
    const title = h('div', { class: 'betterslack-row__name' }, [open]);
    for (const tag of (mod.tags ?? []).slice(0, 3)) {
      title.append(h('span', { class: 'betterslack-tag' }, [tag]));
    }

    const meta = h('div', { class: 'betterslack-row__meta' }, [
      title,
      h('div', { class: 'betterslack-row__desc' }, [
        localised(mod.description, mod.descriptions, language()),
      ]),
      h('div', { class: 'betterslack-row__sub' }, [t('byLine', { version: mod.version, author: mod.author })]),
    ]);

    // A mod that would not start says so where it is, rather than in a console
    // nobody has open.
    if (mod.origin === 'third-party') {
      // Permanent, and on every row: nobody here has read this code, and that
      // fact does not expire once it is installed.
      const badge = h('span', { class: 'betterslack-tag betterslack-tag--warn' }, [t('remoteBadge')]);
      badge.title = t('remoteBadgeHint', { source: mod.source ?? '?' });
      title.append(badge);
    }

    const failure = this.manager.errors.get(mod.id);
    if (failure) {
      title.append(h('span', { class: 'betterslack-tag betterslack-tag--error' }, [t('notRunning')]));
      meta.append(h('div', { class: 'betterslack-row__requires betterslack-row__requires--missing' }, [
        failure,
      ]));
    }

    const requires = mod.requires ?? [];
    if (requires.length > 0) {
      const { found, unknown } = this.missingRecords(mod);
      const names = requires.map((id) => this.manager.list().find((m) => m.id === id)?.name ?? id);
      const satisfied = found.length === 0 && unknown.length === 0;

      const note = h('div', {
        class: `betterslack-row__requires${satisfied ? '' : ' betterslack-row__requires--missing'}`,
      }, [satisfied ? t('uses', { names: names.join(', ') }) : t('needs', { names: names.join(', ') })]);

      // Only offer the button once the theme is on: before that, switching it
      // on is what asks the question anyway.
      if (found.length > 0 && enabled) {
        const fix = h('button', {
          class: 'c-button-unstyled betterslack-row__review',
          type: 'button',
        }, [found.length === 1 ? t('enableIt') : t('enableThem')]);
        fix.addEventListener('click', () => {
          void this.withBusy(mod.id, () => this.enableWithRequirements(mod));
        });
        note.append(' ', fix);
      }
      if (unknown.length > 0) {
        // A theme naming a plugin nobody has. Say which, rather than leaving
        // the user to wonder why it looks wrong.
        note.append(h('div', { class: 'betterslack-row__sub' }, [
          t('notInCatalogue', { names: unknown.join(', ') }),
        ]));
      }
      meta.append(note);
    }

    const row = h('div', { class: 'betterslack-row', 'data-betterslack-mod': mod.id }, [
      this.renderIcon(mod), meta, actions,
    ]);

    // Settings hang under the row they belong to, and only while the mod is on:
    // a control that changes nothing is a control that lies.
    const fields = mod.settings ?? [];
    if (fields.length > 0 && enabled) {
      const open = this.openSettings.has(mod.id);
      const toggle = h('button', {
        class: 'c-button-unstyled betterslack-row__review',
        type: 'button',
        'aria-expanded': String(open),
      }, [open ? t('settingsHide') : t('settingsCount', { count: fields.length })]);
      toggle.addEventListener('click', () => {
        if (open) this.openSettings.delete(mod.id);
        else this.openSettings.add(mod.id);
        this.render();
      });
      meta.append(h('div', { class: 'betterslack-row__sub' }, [toggle]));

      if (open) {
        return h('div', { class: 'betterslack-row__group' }, [row, this.renderModSettings(mod, fields)]);
      }
    }

    return row;
  }

  /**
   * The controls a mod declared, drawn from its manifest.
   *
   * Written straight through to the same keys the mod reads with
   * `api.settings`, and the mod is reloaded afterwards unless it asked to be
   * told instead -- so respecting a setting costs a mod nothing at all.
   */
  private renderModSettings(mod: ModRecord, fields: ModSettingField[]): Node {
    const values = this.manager.getSettings().modSettings[mod.id] ?? {};
    const box = h('div', { class: 'betterslack-settings' });

    for (const field of fields) {
      const current = field.key in values ? values[field.key] : field.default;
      const write = (value: unknown) => {
        void this.manager.setModSetting(mod.id, field.key, value);
      };

      let control: HTMLElement;
      switch (field.type) {
        case 'boolean': {
          const input = h('input', {
            type: 'checkbox',
            id: `betterslack-set-${mod.id}-${field.key}`,
          }) as HTMLInputElement;
          input.checked = current === true;
          input.addEventListener('change', () => write(input.checked));
          control = h('label', { class: 'betterslack-switch', for: input.id }, [
            input,
            h('span', { class: 'betterslack-switch__track' }, [
              h('span', { class: 'betterslack-switch__thumb' }),
            ]),
          ]);
          break;
        }
        case 'number': {
          const input = h('input', {
            type: 'number',
            class: 'c-input_text betterslack-search betterslack-settings__input',
            ...(field.min === undefined ? {} : { min: String(field.min) }),
            ...(field.max === undefined ? {} : { max: String(field.max) }),
            ...(field.step === undefined ? {} : { step: String(field.step) }),
          }) as HTMLInputElement;
          input.value = String(current ?? '');
          // On change, not on input: a number field passes through 1 and 12 on
          // the way to 120, and each one would reload the mod.
          input.addEventListener('change', () => {
            const parsed = Number(input.value);
            if (Number.isFinite(parsed)) write(parsed);
          });
          control = input;
          break;
        }
        case 'colour': {
          const input = h('input', { type: 'color' }) as HTMLInputElement;
          input.value = typeof current === 'string' ? current : '#000000';
          input.addEventListener('change', () => write(input.value));
          control = input;
          break;
        }
        case 'choice': {
          const chosen = typeof current === 'string'
            ? current
            : (field.default ?? field.options[0]!.value);
          control = selectButton(
            // Translated here rather than inside the button: the button is the
            // panel's own component and knows nothing about a mod's manifest.
            field.options.map((option) => ({
              value: option.value,
              label: localised(option.label, option.labels, language()),
            })),
            chosen,
            (picked) => write(picked),
            'betterslack-settings__input',
          );
          control.setAttribute('aria-label', localised(field.label, field.labels, language()));
          break;
        }
        case 'textarea': {
          const title = localised(field.label, field.labels, language());
          const text = typeof current === 'string' ? current : '';
          const area = h('textarea', {
            class: 'c-input_text betterslack-search betterslack-settings__textarea',
            rows: '8',
            spellcheck: 'false',
            'aria-label': title,
            ...(field.placeholder ? { placeholder: field.placeholder } : {}),
          }) as HTMLTextAreaElement;
          area.value = text;
          // On change, not on input: every write reloads the mod, and a keystroke
          // is not a decision.
          area.addEventListener('change', () => write(area.value));
          const count = h('span', { class: 'betterslack-settings__count' }, [
            t('textLines', { count: countLines(text) }),
          ]);
          area.addEventListener('input', () => {
            count.textContent = t('textLines', { count: countLines(area.value) });
          });
          const expand = h('button', {
            class: 'c-button c-button--outline c-button--small',
            type: 'button',
          }, [t('textExpand')]);
          expand.addEventListener('click', () => {
            this.openTextEditor(title, area.value, field.default ?? '', (value) => {
              area.value = value;
              write(value);
            });
          });
          control = h('div', { class: 'betterslack-settings__text' }, [
            area,
            h('div', { class: 'betterslack-settings__textbar' }, [count, expand]),
          ]);
          break;
        }
        default: {
          const input = h('input', {
            type: 'text',
            class: 'c-input_text betterslack-search betterslack-settings__input',
            ...(field.placeholder ? { placeholder: field.placeholder } : {}),
          }) as HTMLInputElement;
          input.value = typeof current === 'string' ? current : '';
          input.addEventListener('change', () => write(input.value));
          control = input;
        }
      }

      /*
       * A setting speaks the reader's language too.
       *
       * Everything else about a mod does -- its one-liner, its readme, its
       * screenshot captions -- and the settings are the half a reader meets
       * while changing something. English stays the fallback, as it is
       * everywhere else here.
       */
      const label = localised(field.label, field.labels, language());
      const hint = field.hint ? localised(field.hint, field.hints, language()) : null;

      box.append(h('div', {
        // A block of text takes the row's whole width, under its label: beside
        // it, a list of a hundred lines would be a column a few words wide.
        class: field.type === 'textarea'
          ? 'betterslack-settings__row betterslack-settings__row--wide'
          : 'betterslack-settings__row',
      }, [
        h('div', { class: 'betterslack-settings__meta' }, [
          h('div', { class: 'betterslack-row__name' }, [label]),
          hint ? h('div', { class: 'betterslack-row__desc' }, [hint]) : null,
        ].filter(Boolean) as Node[]),
        h('div', { class: 'betterslack-row__actions' }, [control]),
      ]));
    }

    return box;
  }

  /** The tag being filtered on, or null for everything. */
  private tag: string | null = null;

  /**
   * The mod whose page is open, if any.
   *
   * A row is a line in a list and cannot hold what somebody deciding needs --
   * what it looks like, what it does not do, which setting to reach for. That
   * is a page, and this is which one.
   */
  private detail: string | null = null;

  /**
   * A mod's mark, or its initial.
   *
   * Every mod has one so the list reads as a list of things rather than a
   * table of text, and a mod that has not drawn one yet still gets a shape
   * rather than a hole: the letter, on a colour derived from the id so it is
   * at least its own.
   */
  private renderIcon(mod: ModRecord, size = 'sm'): HTMLElement {
    const box = h('div', { class: `betterslack-icon betterslack-icon--${size}` });
    if (mod.iconSvg) {
      box.innerHTML = mod.iconSvg;
      return box;
    }
    let hash = 0;
    for (const ch of mod.id) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
    box.style.setProperty('--betterslack-icon-hue', String(hash));
    box.classList.add('betterslack-icon--letter');
    box.textContent = (mod.name[0] ?? '?').toUpperCase();
    return box;
  }

  /** Mods whose settings are unfolded, so a render does not close them. */
  private openSettings = new Set<string>();

  /** Refreshed once per session, when the panel is first opened. */
  private checkedModUpdates = false;
  /** The last check asked for from the About tab, for the line beside its button. */
  private updateCheck: { state: 'checking' | 'done' | 'failed'; count?: number; at?: number } | null = null;

  /** Set while the requirements dialog is open, so Escape can cancel it. */
  private dismissRequires: (() => void) | null = null;

  /** Set while a long text setting is open in its own dialog. */
  private dismissEditor: (() => void) | null = null;

  /**
   * A text setting, given the room it needs.
   *
   * Nothing is written until Save: the box in the row writes on every change,
   * and a dialog is where somebody reworks a whole list and may change their
   * mind about all of it. Escape and the backdrop cancel; Cmd or Ctrl+Enter
   * saves. "Restore the original" refills the box with the manifest's text and
   * still waits for Save.
   */
  private openTextEditor(title: string, value: string, original: string, save: (value: string) => void): void {
    this.dismissEditor?.();

    const finish = (keep: boolean) => {
      this.dismissEditor = null;
      document.getElementById(EDITOR_ID)?.remove();
      if (keep) save(area.value);
    };
    this.dismissEditor = () => finish(false);

    const area = h('textarea', {
      class: 'c-input_text betterslack-search betterslack-editor__area',
      spellcheck: 'false',
      'aria-label': title,
    }) as HTMLTextAreaElement;
    area.value = value;
    const count = h('span', { class: 'betterslack-settings__count' }, [
      t('textLines', { count: countLines(value) }),
    ]);
    area.addEventListener('input', () => {
      count.textContent = t('textLines', { count: countLines(area.value) });
    });
    area.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        finish(true);
      }
    });

    const restore = h('button', {
      class: 'c-button-unstyled betterslack-row__review',
      type: 'button',
    }, [t('textRestore')]);
    restore.addEventListener('click', () => {
      area.value = original;
      count.textContent = t('textLines', { count: countLines(original) });
      area.focus();
    });
    const cancel = h('button', {
      class: 'c-button c-button--outline c-button--medium',
      type: 'button',
    }, [t('cancel')]);
    cancel.addEventListener('click', () => finish(false));
    const accept = h('button', {
      class: 'c-button c-button--primary c-button--medium',
      type: 'button',
    }, [t('textSave')]);
    accept.addEventListener('click', () => finish(true));

    const layer = h('div', { id: EDITOR_ID, class: 'c-dialog betterslack-dialog' }, [
      h('div', {
        class: 'c-dialog__content betterslack-content betterslack-content--editor',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': title,
      }, [
        h('div', { class: 'c-dialog__header betterslack-header' }, [
          h('h1', { class: 'c-dialog__title' }, [title]),
        ]),
        h('div', { class: 'c-dialog__body betterslack-body betterslack-editor' }, [area]),
        h('div', { class: 'betterslack-actions betterslack-actions--dialog betterslack-editor__actions' }, [
          count,
          original ? restore : null,
          h('span', { class: 'betterslack-editor__spacer' }),
          cancel,
          accept,
        ].filter(Boolean) as Node[]),
      ]),
    ]);

    document.body.append(layer);
    layer.addEventListener('mousedown', (event) => {
      if (event.target === layer) finish(false);
    });
    queueMicrotask(() => area.focus());
  }

  /**
   * Ask before switching on a theme's required plugins.
   *
   * A theme is CSS; when a look needs behaviour, that behaviour is a plugin and
   * the theme names it. Turning those on is the user's call, not something to
   * do quietly on their behalf -- a plugin is code, and it will still be
   * running after the theme is switched off again.
   */
  private requestRequirements(mod: ModRecord, missing: ModRecord[]): Promise<boolean> {
    if (missing.length === 0) return Promise.resolve(true);

    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (accepted: boolean) => {
        if (settled) return;
        settled = true;
        this.dismissRequires = null;
        document.getElementById(REQUIRES_ID)?.remove();
        resolve(accepted);
      };
      this.dismissRequires = () => finish(false);

      const cancel = h('button', {
        class: 'c-button c-button--outline c-button--medium',
        type: 'button',
      }, [t('cancel')]);
      cancel.addEventListener('click', () => finish(false));

      const accept = h('button', {
        class: 'c-button c-button--primary c-button--medium',
        type: 'button',
      }, [missing.length === 1 ? t('enableIt') : t('enableAll', { count: missing.length })]);
      accept.addEventListener('click', () => finish(true));

      const list = h('ul', { class: 'betterslack-requires' });
      for (const plugin of missing) {
        list.append(h('li', { class: 'betterslack-require' }, [
          h('div', { class: 'betterslack-require__title' }, [plugin.name]),
          h('div', { class: 'betterslack-require__detail' }, [plugin.description]),
        ]));
      }

      const layer = h('div', { id: REQUIRES_ID, class: 'c-dialog betterslack-dialog' }, [
        h('div', {
          class: 'c-dialog__content betterslack-content betterslack-content--narrow',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': t('requiresTitle', { name: mod.name, count: missing.length }),
        }, [
          h('div', { class: 'c-dialog__header betterslack-header' }, [
            h('h1', { class: 'c-dialog__title' }, [mod.name]),
          ]),
          h('div', { class: 'c-dialog__body betterslack-body' }, [
            h('p', { class: 'betterslack-hint' }, [
              t('requiresBody'),
            ]),
            list,
          ]),
          h('div', { class: 'betterslack-actions betterslack-actions--dialog' }, [cancel, accept]),
        ]),
      ]);

      document.body.append(layer);
      layer.addEventListener('mousedown', (event) => {
        if (event.target === layer) finish(false);
      });
      queueMicrotask(() => accept.focus());
    });
  }

  /** Which of a mod's requirements are known to the catalogue but not enabled. */
  private missingRecords(mod: ModRecord): { found: ModRecord[]; unknown: string[] } {
    const found: ModRecord[] = [];
    const unknown: string[] = [];
    for (const id of this.manager.missingRequirements(mod.id)) {
      const record = this.manager.list().find((m) => m.id === id);
      if (record) found.push(record);
      else unknown.push(id);
    }
    return { found, unknown };
  }

  /**
   * Switch a theme on, offering to switch its requirements on first.
   *
   * Declining still enables the theme. It is a stylesheet either way, and half
   * a look is a better answer than refusing to do what was asked.
   */
  private async enableWithRequirements(mod: ModRecord): Promise<void> {
    const { found } = this.missingRecords(mod);
    if (found.length > 0 && (await this.requestRequirements(mod, found))) {
      for (const plugin of found) {
        if (!this.manager.isInstalled(plugin.id)) await this.manager.setInstalled(plugin.id, true);
        await this.manager.setEnabled(plugin.id, true);
      }
    }
    await this.manager.setEnabled(mod.id, true);
  }

  /** The shared menu, so the panel and every mod open the same thing. */
  private openMenu(anchor: HTMLElement, mod: ModRecord): void {
    this.closeRowMenu = openMenu(anchor, [
      {
        label: this.manager.isEnabled(mod.id) ? t('disable') : t('enable'),
        onSelect: () => {
          void this.withBusy(mod.id, () =>
            this.manager.isEnabled(mod.id)
              ? this.manager.setEnabled(mod.id, false)
              : this.enableWithRequirements(mod));
        },
      },
      {
        label: t('remove'),
        danger: true,
        onSelect: () => {
          void this.withBusy(mod.id, () => this.manager.setInstalled(mod.id, false));
        },
      },
    ]);
  }

  private closeRowMenu: () => void = () => {};

  private closeMenu(): void {
    this.closeRowMenu();
    closeMenu();
  }

  private renderCustomCss(): Node[] {
    // The same editor the theme builder uses: highlighting, and Tab that
    // indents instead of leaving the field. A missing brace in here silently
    // stops the whole stylesheet from applying, which is exactly the mistake
    // colour makes visible.
    const editor = createCodeEditor(document, {
      value: this.manager.getSettings().customCss,
      rows: 16,
      placeholder: ':root { --dt_color-content-pry: #e8e8ea; }',
    });

    const status = h('span', { class: 'betterslack-status' });
    const save = h('button', {
      class: 'c-button c-button--primary c-button--medium',
      type: 'button',
    }, [t('cssSave')]);
    save.addEventListener('click', () => {
      void this.manager
        .setCustomCss(editor.value())
        .then(() => {
          status.className = 'betterslack-status';
          status.textContent = t('cssApplied');
        })
        .catch((err: Error) => {
          status.className = 'betterslack-status betterslack-danger';
          status.textContent = err.message;
        });
    });

    return [
      h('p', { class: 'betterslack-hint' }, [
        t('cssHint'),
      ]),
      editor.node,
      h('div', { class: 'betterslack-actions' }, [save, status]),
    ];
  }

  private renderAbout(): Node[] {
    const info = this.manager.info;
    const settings = this.manager.getSettings();

    const hotReload = h('input', {
      type: 'checkbox',
      id: 'betterslack-hot-reload',
      'aria-label': 'Hot reload',
    }) as HTMLInputElement;
    hotReload.checked = settings.hotReload;
    hotReload.addEventListener('change', () => {
      void this.manager.patchSettings({ hotReload: hotReload.checked });
    });

    return [
      h('p', { class: 'betterslack-hint' }, [
        t('aboutBody'),
      ]),
      h('div', { class: 'betterslack-row' }, [
        h('div', { class: 'betterslack-row__meta' }, [
          h('div', { class: 'betterslack-row__name' }, [t('hotReload')]),
          h('div', { class: 'betterslack-row__desc' }, [
            t('hotReloadHint'),
          ]),
        ]),
        h('div', { class: 'betterslack-row__actions' }, [
          h('label', { class: 'betterslack-switch', for: hotReload.id }, [
            hotReload,
            h('span', { class: 'betterslack-switch__track' }, [
              h('span', { class: 'betterslack-switch__thumb' }),
            ]),
          ]),
        ]),
      ]),
      this.renderUpdateCheck(),
      this.renderDockIcon(),
      this.renderBackup(),
      this.renderDiagnostics(),
      h('dl', { class: 'betterslack-info' }, [
        h('dt', {}, [t('version')]),
        h('dd', {}, [info.version]),
        h('dt', {}, [t('catalogue')]),
        h('dd', {}, [info.modsRoot]),
        h('dt', {}, [t('yourMods')]),
        h('dd', {}, [info.userModsRoot]),
        h('dt', {}, [t('transport')]),
        h('dd', {}, [info.transport]),
      ]),
      h('p', { class: 'betterslack-hint' }, [
        h('a', { class: 'c-link', href: repoUrl, target: '_blank', rel: 'noreferrer' }, [t('repository')]),
        ' · ',
        h('a', { class: 'c-link', href: contributeUrl, target: '_blank', rel: 'noreferrer' }, [
          t('contribute'),
        ]),
      ]),
    ];
  }

  /**
   * Install a mod from somebody else's repository.
   *
   * The security model here is human review: everything in the catalogue was
   * read by a person before it was merged. A mod from a URL was not, and a
   * plugin runs unsandboxed in an authenticated Slack -- it can read every
   * message and the session token. So this asks, in those words, before
   * anything is written, and the mod carries a permanent mark afterwards.
   */
  /**
   * Mod folders the loader found and refused.
   *
   * On the Browse shelf, because that is where somebody looks for a mod that is
   * not there, and on screen rather than only in the loader's terminal, which
   * answers the question for whoever started it and nobody else -- a mod
   * missing after a pull is exactly the moment you are not reading a terminal.
   */
  private renderSkipped(): Node[] {
    const skipped = this.manager.info.skipped ?? [];
    if (skipped.length === 0) return [];
    return [
      h('div', { class: 'betterslack-row betterslack-row--notice betterslack-row--warn' }, [
        h('div', { class: 'betterslack-row__meta' }, [
          h('div', { class: 'betterslack-row__name' }, [t('skippedTitle', { count: skipped.length })]),
          h('div', { class: 'betterslack-row__desc' }, [t('skippedBody')]),
          h('ul', { class: 'betterslack-skipped' }, skipped.map((reason) => h('li', {}, [reason]))),
        ]),
      ]),
    ];
  }

  private renderRemoteInstall(): Node {
    const input = h('input', {
      class: 'c-input_text betterslack-search',
      type: 'text',
      placeholder: t('remotePlaceholder'),
      spellcheck: 'false',
    }) as HTMLInputElement;
    const status = h('span', { class: 'betterslack-status' });

    const go = h('button', {
      class: 'c-button c-button--outline c-button--medium',
      type: 'button',
    }, [t('remoteFetch')]);

    const fetchIt = () => {
      const url = input.value.trim();
      if (!url) return;
      status.textContent = t('remoteReading');
      void this.manager.inspectRemote(url).then(async (result) => {
        if ('error' in result) {
          status.textContent = result.error;
          return;
        }
        status.textContent = '';
        const accepted = await this.requestRemoteConsent(result);
        if (!accepted) return;
        status.textContent = t('remoteInstalling');
        await this.manager.installRemote(result);
        input.value = '';
        status.textContent = t('remoteInstalled', { name: result.manifest.name });
        this.render();
      });
    };
    go.addEventListener('click', fetchIt);
    input.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Enter') fetchIt();
    });

    return h('div', { class: 'betterslack-remote' }, [
      h('div', { class: 'betterslack-row__desc' }, [t('remoteHint')]),
      h('div', { class: 'betterslack-remote__row' }, [input, go, status]),
    ]);
  }

  /** The dialog that says what installing somebody else's code means. */
  private requestRemoteConsent(remote: RemoteMod): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (accepted: boolean) => {
        if (settled) return;
        settled = true;
        this.dismissRequires = null;
        document.getElementById(REQUIRES_ID)?.remove();
        resolve(accepted);
      };
      this.dismissRequires = () => finish(false);

      const cancel = h('button', {
        class: 'c-button c-button--outline c-button--medium',
        type: 'button',
      }, [t('cancel')]);
      cancel.addEventListener('click', () => finish(false));

      const accept = h('button', {
        class: 'c-button c-button--danger c-button--medium',
        type: 'button',
      }, [t('remoteAccept')]);
      accept.addEventListener('click', () => finish(true));

      const facts = h('dl', { class: 'betterslack-info' }, [
        h('dt', {}, [t('remoteFrom')]),
        h('dd', {}, [`${remote.repo}${remote.folder ? `/${remote.folder}` : ''}`]),
        h('dt', {}, [t('remoteKind')]),
        h('dd', {}, [remote.manifest.type === 'plugin' ? t('plugins') : t('themes')]),
        h('dt', {}, [t('remoteScripts')]),
        h('dd', {}, [
          remote.scripts.length === 0 ? t('remoteNoScripts') : remote.scripts.join(', '),
        ]),
        h('dt', {}, [t('remoteSize')]),
        h('dd', {}, [`${Math.max(1, Math.round(remote.bytes / 1024))} kB`]),
      ]);

      const layer = h('div', { id: REQUIRES_ID, class: 'betterslack-requires' }, [
        h('div', { class: 'c-dialog betterslack-dialog betterslack-dialog--small', role: 'dialog', 'aria-modal': 'true' }, [
          h('div', { class: 'c-dialog__header betterslack-header' }, [
            h('h1', { class: 'c-dialog__title' }, [remote.manifest.name]),
          ]),
          h('div', { class: 'c-dialog__body betterslack-body' }, [
            h('p', { class: 'betterslack-hint betterslack-danger' }, [
              remote.manifest.type === 'plugin' ? t('remoteWarningPlugin') : t('remoteWarningTheme'),
            ]),
            h('p', { class: 'betterslack-hint' }, [remote.manifest.description]),
            facts,
          ]),
          h('div', { class: 'betterslack-actions betterslack-actions--dialog' }, [cancel, accept]),
        ]),
      ]);
      document.body.append(layer);
      queueMicrotask(() => cancel.focus());
    });
  }

  /**
   * Check for updates now, rather than at the next hourly sweep.
   *
   * Somebody who has just installed a mod from the catalogue gets the copy
   * that shipped with their BetterSlack -- possibly a version behind the one
   * published since -- and the sweep that would have found the newer one may
   * be most of an hour away. The answer lands where it always does: the dot on
   * the tab that owns it, and the notice with its button.
   */
  private renderUpdateCheck(): Node {
    const check = this.updateCheck;
    const time = check?.at
      ? new Date(check.at).toLocaleTimeString(document.documentElement.lang || undefined, { hour: '2-digit', minute: '2-digit' })
      : '';
    const line = !check ? t('updatesHint')
      : check.state === 'checking' ? t('updatesChecking')
        : check.state === 'failed' ? t('updatesFailed')
          : check.count ? t('updatesFound', { count: check.count, time })
            : t('updatesNone', { time });
    const button = h('button', {
      class: 'c-button c-button--outline c-button--medium',
      type: 'button',
      ...(check?.state === 'checking' ? { disabled: 'disabled' } : {}),
    }, [t('updatesCheck')]);
    button.addEventListener('click', () => {
      this.updateCheck = { state: 'checking' };
      this.render();
      void this.manager.checkForUpdates().then((count) => {
        this.updateCheck = count === null
          ? { state: 'failed' }
          : { state: 'done', count, at: Date.now() };
        this.render();
      });
    });
    return h('div', { class: 'betterslack-row' }, [
      h('div', { class: 'betterslack-row__meta' }, [
        h('div', { class: 'betterslack-row__name' }, [t('updatesTitle')]),
        h('div', { class: 'betterslack-row__desc' }, [line]),
      ]),
      h('div', { class: 'betterslack-row__actions' }, [button]),
    ]);
  }

  /**
   * Slack's Dock tile, on macOS: says whether it wears BetterSlack's icon and,
   * when App Management is what stands in the way, offers to ask for it. The
   * same conversation the startup offer has, for whoever said later.
   */
  private renderDockIcon(): Node {
    const row = h('div', { class: 'betterslack-row', hidden: 'hidden' });
    void this.manager.dockIcon().then((state) => {
      if (state === 'unsupported') return;
      const button = h('button', {
        class: 'c-button c-button--outline c-button--medium',
        type: 'button',
      }, [t('dockIconAllow')]);
      button.addEventListener('click', () => {
        this.close();
        void requestDockIcon(this.manager);
      });
      row.append(
        h('div', { class: 'betterslack-row__meta' }, [
          h('div', { class: 'betterslack-row__name' }, [t('dockIconRow')]),
          h('div', { class: 'betterslack-row__desc' }, [t(state === 'ok' ? 'dockIconOk' : 'dockIconRefused')]),
        ]),
        h('div', { class: 'betterslack-row__actions' }, state === 'ok' ? [] : [button]),
      );
      row.removeAttribute('hidden');
    });
    return row;
  }

  /**
   * Take everything with you, or put it back.
   *
   * The catalogue is deliberately not in it: those mods come back with the
   * project, and carrying them would restore stale copies over newer ones. What
   * a backup holds is the part that cannot be downloaded again -- the settings,
   * and the mods someone wrote or installed themselves.
   */
  private renderBackup(): Node {
    const status = h('span', { class: 'betterslack-status' });

    const save = h('button', {
      class: 'c-button c-button--outline c-button--medium',
      type: 'button',
    }, [t('backupExport')]);
    save.addEventListener('click', () => {
      void this.manager.exportBackup().then((archive) => {
        // Through the page rather than the loader: a download belongs where the
        // user's own download folder is, and this is the one they chose.
        const blob = new Blob([archive], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = h('a', {
          href: url,
          download: `betterslack-backup-${new Date().toISOString().slice(0, 10)}.json`,
        }) as HTMLAnchorElement;
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
        status.textContent = t('backupSaved');
      });
    });

    const file = h('input', { type: 'file', accept: 'application/json', hidden: 'hidden' }) as HTMLInputElement;
    file.addEventListener('change', () => {
      const chosen = file.files?.[0];
      if (!chosen) return;
      status.textContent = t('backupWorking');
      void chosen.text().then((text) =>
        this.manager.importBackup(text).then((result) => {
          status.textContent = result.ok ? t('backupRestored', { detail: result.detail }) : result.detail;
          if (result.ok) this.render();
        }));
    });

    const load = h('button', {
      class: 'c-button c-button--outline c-button--medium',
      type: 'button',
    }, [t('backupImport')]);
    load.addEventListener('click', () => file.click());

    return h('div', { class: 'betterslack-row' }, [
      h('div', { class: 'betterslack-row__meta' }, [
        h('div', { class: 'betterslack-row__name' }, [t('backupTitle')]),
        h('div', { class: 'betterslack-row__desc' }, [t('backupHint')]),
      ]),
      h('div', { class: 'betterslack-row__actions' }, [save, load, file, status]),
    ]);
  }

  /**
   * What the mods cost, and a report that can be pasted into an issue.
   *
   * "Slack feels slow since I turned things on" is unanswerable without this,
   * and the answer is nearly always one mod. The copy button exists because
   * the alternative is asking someone to describe their setup from memory.
   */
  private renderDiagnostics(): Node {
    const rows: Node[] = [];
    const timings = [...this.manager.timings.entries()].sort((a, b) => b[1] - a[1]);
    for (const [id, ms] of timings) {
      const mod = this.manager.list().find((entry) => entry.id === id);
      const mounts = [...mountCounts.entries()]
        .filter(([node]) => node.includes(id))
        .reduce((total, [, count]) => total + count, 0);
      rows.push(h('div', { class: 'betterslack-diag__row' }, [
        h('span', {}, [mod?.name ?? id]),
        h('span', { class: 'betterslack-diag__num' }, [
          t('diagTiming', { ms, mounts }),
        ]),
      ]));
    }

    const copy = h('button', {
      class: 'c-button c-button--outline c-button--medium',
      type: 'button',
    }, [t('diagCopy')]);
    copy.addEventListener('click', () => {
      const report = this.diagnosticReport();
      void navigator.clipboard.writeText(report).then(
        () => { copy.textContent = t('diagCopied'); },
        () => { copy.textContent = report.slice(0, 0) || t('diagCopyFailed'); },
      );
      setTimeout(() => { copy.textContent = t('diagCopy'); }, 1600);
    });

    return h('div', { class: 'betterslack-diag' }, [
      h('div', { class: 'betterslack-row__name' }, [t('diagTitle')]),
      h('div', { class: 'betterslack-row__desc' }, [t('diagHint')]),
      ...rows,
      h('div', { class: 'betterslack-actions' }, [copy]),
    ]);
  }

  /** Everything worth knowing about this install, as plain text. */
  private diagnosticReport(): string {
    const info = this.manager.info;
    const settings = this.manager.getSettings();
    const lines = [
      `BetterSlack ${info.version}${info.safeMode ? ' (safe mode)' : ''}`,
      `Slack: ${navigator.userAgent}`,
      `Language: ${document.documentElement.lang || 'unknown'}`,
      `Enabled: ${settings.enabled.join(', ') || 'none'}`,
      `Failures: ${JSON.stringify(settings.modFailures ?? {})}`,
      `Errors: ${[...this.manager.errors.entries()].map(([id, why]) => `${id}: ${why}`).join(' | ') || 'none'}`,
      `Start times: ${[...this.manager.timings.entries()].map(([id, ms]) => `${id} ${ms}ms`).join(', ') || 'none'}`,
      `Remounts: ${[...mountCounts.entries()].map(([id, n]) => `${id} ${n}`).join(', ') || 'none'}`,
    ];
    return lines.join('\n');
  }

  /**
   * Mods with a newer version published, updated one at a time.
   *
   * Separate from the app's own update on purpose: mods change far more often
   * than the loader does, and making a theme fix wait for a release of the
   * whole project is what this is for. The loader sweeps hourly and the manager
   * holds the answer; this only draws the ones belonging to the open tab.
   */
  private renderModUpdates(kind: 'theme' | 'plugin'): Node[] {
    const updates = this.manager.modUpdates.filter((update) => update.type === kind);
    if (updates.length === 0) return [];

    const rows = updates.map((update) => {
      /*
       * Reported, but with no button. Hiding an update the reader cannot take
       * would leave them believing they are current; offering one that cannot
       * work would hand them a mod that throws on its first click. Saying which
       * version is wanted is the only answer that lets them act.
       */
      if (update.blockedBy) {
        return h('div', { class: 'betterslack-row betterslack-row--notice' }, [
          h('div', { class: 'betterslack-row__meta' }, [
            h('div', { class: 'betterslack-row__name' }, [
              t('modUpdateTitle', { name: update.name, current: update.from, version: update.to }),
            ]),
            h('div', { class: 'betterslack-row__desc betterslack-row__requires--missing' }, [
              t('modUpdateBlocked', {
                name: update.name,
                version: update.to,
                needs: update.blockedBy.needs,
                running: update.blockedBy.running,
              }),
            ]),
          ]),
        ]);
      }

      const status = h('span', { class: 'betterslack-status' });
      const button = h('button', {
        class: 'c-button c-button--primary c-button--medium',
        type: 'button',
      }, [t('modUpdateGo')]);
      button.addEventListener('click', () => {
        button.setAttribute('disabled', 'disabled');
        status.textContent = t('modUpdateWorking');
        void this.manager.updateMod(update.id).then((result) => {
          if (!result.ok) {
            status.textContent = result.detail;
            button.removeAttribute('disabled');
            return;
          }
          // `updateMod` drops it from the manager's list, which notifies.
          this.render();
        });
      });

      return h('div', { class: 'betterslack-row betterslack-row--notice' }, [
        h('div', { class: 'betterslack-row__meta' }, [
          h('div', { class: 'betterslack-row__name' }, [
            t('modUpdateTitle', { name: update.name, current: update.from, version: update.to }),
          ]),
          h('div', { class: 'betterslack-row__desc' }, [t('modUpdateBody')]),
        ]),
        h('div', { class: 'betterslack-row__actions' }, [button, status]),
      ]);
    });

    return rows;
  }

  /**
   * The banner that says nothing is running, and why.
   *
   * Deliberately not a dialog: safe mode is a state to work in, not an alert to
   * dismiss. The way out is to restart normally, and saying so is the whole
   * point -- the two freezes this exists for left no way back except editing
   * the settings file by hand.
   */
  private renderSafeMode(): Node[] {
    const info = this.manager.info;
    if (!info.safeMode) return [];

    return [
      h('div', { class: 'betterslack-row betterslack-row--notice' }, [
        h('div', { class: 'betterslack-row__meta' }, [
          h('div', { class: 'betterslack-row__name' }, [t('safeTitle')]),
          h('div', { class: 'betterslack-row__desc' }, [
            info.safeModeReason
              ? t('safeCrashed', { reason: info.safeModeReason })
              : t('safeAsked'),
          ]),
        ]),
      ]),
    ];
  }

  /**
   * Whether this copy is current, and the offer to make it so.
   *
   * Nothing is shown while the answer is unknown -- the check goes out on the
   * network and is allowed to fail -- and nothing is shown when it is up to
   * date either. A row that says "you are fine" every time you open the panel
   * is a row nobody reads.
   */
  private renderUpdate(): Node[] {
    const status = this.manager.update;
    if (!status || !status.behind) return [];

    const current = this.manager.info.version;

    /*
     * Two numbers, not a count of commits.
     *
     * "Four commits behind" is true and means nothing to somebody who has never
     * made one -- and a git checkout is what `install.sh` leaves behind, so it
     * is not a developer's install by any means. Both kinds of install now name
     * the published version, and the title carries it the way a mod's row does.
     *
     * The count survives for the one case where there is no version to name: a
     * branch that has moved without a release on it, where "3.0.0 is out, you
     * have 3.0.0" would be worse than counting changes.
     */
    const title = status.latest
      ? t('updateTitleVersion', { current, latest: status.latest })
      : t('updateTitle');

    // What will happen, in the words of the install it will happen to: a
    // checkout is pulled, a downloaded copy is replaced from GitHub. Someone
    // about to press this should know which.
    const detail = status.kind === 'git'
      ? (status.latest
        ? t('updateGit')
        : t('updateGitCount', {
          count: status.commits ?? 0,
          headline: status.headline ? t('updateHeadline', { subject: status.headline }) : '',
        }))
      : t('updatePackage');

    /*
     * The progress line, under the buttons rather than beside them.
     *
     * Never inside `row__actions`, which is `flex: 0 0 auto`: "Downloading and
     * rebuilding..." there either squeezes the button next to it or wraps
     * underneath it, and while the pull runs the only thing that has changed on
     * screen is that the button has gone grey. That reads as broken, not busy.
     */
    const progress = h('div', { class: 'betterslack-progress' });
    const say = (text: string, state?: 'done' | 'failed') => {
      progress.className = `betterslack-progress${state ? ` betterslack-progress--${state}` : ''}`;
      progress.textContent = text;
    };
    const actions: Node[] = [];

    if (status.updatable) {
      const update = h('button', {
        class: 'c-button c-button--primary c-button--medium',
        type: 'button',
      }, [t('updateGo')]);
      update.addEventListener('click', () => {
        update.setAttribute('disabled', 'disabled');
        update.textContent = t('updateWorking');
        say(status.kind === 'git' ? t('updatePulling') : t('updateDownloading'));
        void this.manager
          .updateApp()
          .then((result) => {
            if (result.ok) {
              // Left disabled on purpose: it worked, and Slack is on its way
              // out. Putting the button back would invite a second pull into a
              // client that is already restarting.
              say(t('updateDone'), 'done');
              return;
            }
            say(t('updateFailed', { reason: result.detail }), 'failed');
            update.textContent = t('updateGo');
            update.removeAttribute('disabled');
          })
          .catch((err: Error) => {
            say(err.message, 'failed');
            update.textContent = t('updateGo');
            update.removeAttribute('disabled');
          });
      });
      actions.push(update);
    } else {
      actions.push(h('a', {
        class: 'c-button c-button--outline c-button--medium',
        href: repoUrl,
        target: '_blank',
        rel: 'noreferrer',
      }, [t('updateGitHub')]));
    }

    return [
      h('div', { class: 'betterslack-row betterslack-row--notice' }, [
        h('div', { class: 'betterslack-row__meta' }, [
          h('div', { class: 'betterslack-row__name' }, [title]),
          h('div', { class: 'betterslack-row__desc' }, [
            status.note ? `${detail} — ${status.note}` : detail,
          ]),
        ]),
        h('div', { class: 'betterslack-row__actions' }, actions),
        progress,
      ]),
    ];
  }

  private async withBusy(id: string, work: () => Promise<unknown>): Promise<void> {
    this.busy.add(id);
    this.renderIfOpen();
    try {
      await work();
    } catch (err) {
      console.error('[betterslack]', err);
    } finally {
      this.busy.delete(id);
      this.renderIfOpen();
    }
  }
}
