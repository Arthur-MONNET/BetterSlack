// Styles for the Mods panel.
//
// The panel lives in a shadow root, so none of this leaks into Slack and none
// of Slack's CSS leaks in -- which also means a broken user theme cannot make
// the panel unusable and trap someone with no way to turn it off.
//
// Custom properties do cross the shadow boundary, so Slack's design tokens are
// used where they exist, each with a fallback for when they get renamed. Using
// them is also what makes the panel follow Slack's own light/dark switch for
// free -- Slack swaps the token values, the panel just reads them.
//
// Two families, two conventions: the semantic tokens (--dt_color-base-*,
// -content-*, -otl-*) hold CSS colours, while the palette tokens
// (--dt_color-plt-*) hold bare "r,g,b" triplets and only work inside rgb().

/**
 * What Slack has no class for.
 *
 * The panel wears Slack's own `c-dialog` / `c-menu` classes, so almost nothing
 * needs styling here — only layout, and the few controls Slack has no reusable
 * class for. Every colour comes from a Slack variable, so the panel follows the
 * active theme exactly rather than approximating it:
 *
 *   rgba(var(--sk_primary_foreground), 1)   text
 *   rgba(var(--sk_foreground_max), .7)      secondary text
 *   rgba(var(--sk_foreground_low), .13)     hairlines
 *   var(--dt_color-*)                       semantic colours
 */
import { CODE_CSS } from './code.js';

export const PANEL_CSS = CODE_CSS + `
/* .c-dialog ships opacity:0 and is faded in by Slack's own transition. */
#betterslack-panel.c-dialog { opacity: 1; }

.betterslack-content {
  display: flex;
  flex-direction: column;
  width: min(880px, calc(100% - 32px));
  max-width: min(880px, calc(100% - 32px));
  height: min(620px, calc(100% - 64px));
  max-height: min(620px, calc(100% - 64px));
  opacity: 1;
}

.betterslack-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 20px 24px 12px;
}
.betterslack-close { margin-left: auto; flex: 0 0 auto; }

/*
 * The mark beside the title. 10px apart rather than the header's 12, because
 * this is a lockup and the header's gap is the distance to the close button.
 *
 * The SVG carries no width or height of its own -- it is one drawing used at
 * four sizes -- so an intrinsic-size fallback of 300x150 is what an unsized one
 * lays out at, in this dialog exactly as in the rail.
 */
.betterslack-brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
.betterslack-brand__mark { display: flex; flex: 0 0 auto; }
.betterslack-brand__mark svg { width: 24px; height: 24px; display: block; }

.betterslack-layout { display: flex; flex: 1; min-height: 0; }

/* Left rail, in the shape Slack's Preferences dialog uses. */
.betterslack-nav {
  flex: 0 0 176px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 8px 16px 16px;
  overflow-y: auto;
}
.betterslack-nav__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 15px;
  line-height: 1.46667;
  color: rgba(var(--sk_primary_foreground, 29, 28, 29), 1);
  text-align: left;
  cursor: pointer;
}
.betterslack-nav__item:hover { background: rgba(var(--sk_foreground_low, 29, 28, 29), 0.08); }
.betterslack-nav__item[aria-selected="true"] {
  background: rgba(var(--sk_highlight, 18, 100, 163), 1);
  color: rgba(var(--sk_primary_background, 255, 255, 255), 1);
  font-weight: var(--custom-font-weight-bold, 700);
}
.betterslack-nav__item[aria-selected="true"] .betterslack-count {
  background: rgba(255, 255, 255, 0.24);
  color: inherit;
}

/*
 * The update dot on a tab. Slack's own unread colour, at the size Slack draws
 * an unread dot in the sidebar, so it reads as one thing the app is telling you
 * rather than as a mark BetterSlack invented.
 */
.betterslack-nav__dot {
  /* No margin: the nav item is a flex row with a gap, and adding one on top of
     it spaced the dot further from its label than the pill on the right. */
  flex: 0 0 auto;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgba(var(--sk_highlight_accent, 224, 30, 90), 1);
}
/* The selected tab is painted in the highlight blue, where the accent red is
   the one colour that disappears into it. */
.betterslack-nav__item[aria-selected="true"] .betterslack-nav__dot {
  background: rgba(var(--sk_primary_background, 255, 255, 255), 1);
}

.betterslack-count {
  margin-left: auto;
  min-width: 20px;
  padding: 0 6px;
  border-radius: 999px;
  font-size: 12px;
  line-height: 18px;
  text-align: center;
  background: rgba(var(--sk_foreground_low, 29, 28, 29), 0.12);
  color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.7);
}

.betterslack-body { flex: 1; min-width: 0; padding-bottom: 20px; }

/* How BetterSlack's own interface moves, inside the client.
 *
 * The same six tokens api.ui.kit declares for the documents a mod opens, with
 * the same defaults, so the app and the components it hands out share one
 * tempo. Declared on :root and not on the elements that read them, which is
 * what lets a mod override them from html.<its-class> -- a rule on the element
 * itself would outrank anything inherited and the dials would do nothing.
 */
:root {
  --sm-motion-base: 200ms;
  --sm-motion-ease: cubic-bezier(.2, .9, .25, 1);
  --sm-motion-shift: 8px;
}

/* Reduced motion drops the travel and keeps the fade, which is what it asks
 * for. Also on :root, and for the same reason: someone who installs a motion
 * mod and tells it to animate anyway has said what they want, and that has to
 * be able to win.
 */
@media (prefers-reduced-motion: reduce) {
  :root { --sm-motion-shift: 0px; }
}

/* Switching tab.
 *
 * Stamped by panel.ts, and only when the tab really changed: the panel rebuilds
 * itself on every change and one toggle causes several renders in a frame, so a
 * rule that fired on mount alone would flicker instead of transition.
 */
@keyframes betterslack-tab-enter {
  from { opacity: 0; transform: translateX(var(--sm-motion-shift)); }
  to { opacity: 1; transform: none; }
}
.betterslack-body--enter {
  animation: betterslack-tab-enter var(--sm-motion-base) var(--sm-motion-ease);
}

.betterslack-toolbar {
  position: sticky;
  top: 0;
  z-index: 1;
  /* A column, not a row.
   *
   * The shelves and the search field shared a line, the field taking whatever
   * the three shelf pills left over. On a narrow dialog that is a stub of an
   * input pinned to the right edge with the tabs crowding it, and on a wide one
   * it is a field stretched across half the dialog for no reason. Measured at
   * 316px against 330px of shelves. Its own line is the same width every time,
   * lines up with the rows underneath, and reads as what it is: a filter on the
   * shelf above it.
   */
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
  padding: 12px 0 14px;
  background: rgba(var(--sk_primary_background, 255, 255, 255), 1);
}
.betterslack-shelves { display: flex; gap: 2px; flex-wrap: wrap; }
.betterslack-shelf {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 14px;
  color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.7);
  cursor: pointer;
}
.betterslack-shelf:hover { background: rgba(var(--sk_foreground_low, 29, 28, 29), 0.08); }
.betterslack-shelf[aria-selected="true"] {
  color: rgba(var(--sk_primary_foreground, 29, 28, 29), 1);
  font-weight: var(--custom-font-weight-bold, 700);
  background: rgba(var(--sk_foreground_low, 29, 28, 29), 0.12);
}

/*
 * The search field and the sort, on one line.
 *
 * The shelves keep a line of their own -- pills and a field sharing one leaves
 * a stub of an input pinned to the right edge on a narrow dialog. This pairing
 * is the other way round: the sort is as wide as its longest option and never
 * wider, so the field takes the rest and the line reads as one filter bar.
 */
.betterslack-filterbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
/*
 * A basis rather than auto, with wrapping: the dialog is 880px until the window
 * is small, and there it falls back to the viewport less 32px. Given a share of
 * whatever is left, the field became a stub beside a control twice its width --
 * which is the same failure that put the shelves on a line of their own. With a
 * floor of 200px the sort drops to its own line instead when there is no room.
 */
.betterslack-filterbar .betterslack-search { flex: 1 1 200px; min-width: 0; }
.betterslack-filterbar .betterslack-select { flex: 0 0 auto; }

/*
 * What is left to write once Slack's own field is borrowed.
 *
 * Slack's own text input is .c-input_text and its own select is .c-input_select
 * -- a bordered button that opens a menu, never a native dropdown -- so both
 * are borrowed rather than drawn, the way the dialog and the buttons already
 * are. Height, radius, border, background, the 80ms focus transition and every
 * theme come with them.
 *
 * The one thing that has to be undone is the margin: both of Slack's carry
 * 0 0 20px, because in Slack they are form fields stacked in a column, and here
 * they sit on a toolbar.
 */
/*
 * The class is doubled to win, and that is the whole reason.
 *
 * Slack's stylesheet is loaded after BetterSlack's, so a single class ties on
 * specificity and loses on source order -- measured: the field kept the 20px
 * bottom margin .c-input_text gives a form field, which on a toolbar is a gap
 * under the search box and nothing below it.
 */
.betterslack-search.betterslack-search,
.betterslack-select.betterslack-select {
  margin: 0;
  font-family: inherit;
}
.betterslack-search { display: block; width: 100%; min-width: 0; }

/*
 * Focus, without Slack's halo.
 *
 * Slack draws focus as two stacked shadows -- a 1px ring and a 5px spread at
 * 30% opacity -- and sets the border transparent underneath them, so what is
 * left is a soft glow floating where the field's edge was. On a form that is
 * one field at a time it reads as attention; on a toolbar of two controls it
 * reads as a light left on.
 *
 * The border does the work instead: it is already there, it already animates
 * over the same 80ms, and it stays visible for anyone arriving by keyboard --
 * which is the one thing removing a focus indicator may not cost.
 *
 * The class is doubled here for the same reason it is above, and one more: this
 * has to beat Slack's own focus rule, which scores a class and a pseudo-class.
 * No backticks in this file, comments included -- one closes the template
 * literal and the runtime throws at boot with nothing styled to show for it.
 */
.betterslack-search.betterslack-search:focus,
.betterslack-search.betterslack-search:focus-within,
.betterslack-select.betterslack-select:focus,
.betterslack-select.betterslack-select:focus-within {
  box-shadow: none;
  outline: none;
  border-color: rgba(var(--sk_highlight, 18, 100, 163), 1);
}

.betterslack-select {
  /* Slack sets padding 0 on the box and pads the parts inside it instead. */
  gap: 8px;
  padding: 0 8px 0 12px;
  font-size: 15px;
  color: rgba(var(--sk_primary_foreground, 29, 28, 29), 1);
}
.betterslack-select .c-input_select__selected_value {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.betterslack-select__chevron { display: flex; flex: 0 0 auto; opacity: 0.7; }
.betterslack-select__chevron svg { width: 16px; height: 16px; display: block; }
/* The CSS box is api.ui's code editor. It brings its own metrics -- the painted
 * copy and the textarea have to agree on every one of them -- so only the
 * colours are set here, from Slack's tokens, which is what makes it follow the
 * theme like the rest of the panel. Written without backticks, as everything in
 * this file must be. */
.sm-code {
  border-color: rgba(var(--sk_foreground_low, 29, 28, 29), 0.3);
  background: rgba(var(--sk_foreground_min, 29, 28, 29), 0.04);
}
.sm-code:focus-within {
  border-color: rgba(var(--sk_highlight, 18, 100, 163), 1);
  box-shadow: 0 0 0 1px rgba(var(--sk_highlight, 18, 100, 163), 1);
}
.sm-code__paint { color: rgba(var(--sk_primary_foreground, 29, 28, 29), 0.9); }
.sm-code__input { caret-color: rgba(var(--sk_primary_foreground, 29, 28, 29), 1); }
.sm-code__input::placeholder { color: rgba(var(--sk_primary_foreground, 29, 28, 29), 0.5); }

/*
 * The update notice.
 *
 * It was the ordinary row with a 3px edge and 12px of padding on the left only,
 * which is where it went wrong: the base row is padded 14px top and bottom and
 * nothing left or right, so the edge
 * had a gap on one side and the text ran to the dialog's margin on the other,
 * and the whole thing sat flush against the rows above and below it with no
 * more weight than a mod. A notice that is easy to miss is a notice that does
 * not work.
 *
 * So it is a card now -- tinted, padded on all four sides, and set apart with
 * margin rather than by borrowing the row separator.
 */
/* Both classes on purpose. The plain row class sets display flex further down
 * this same stylesheet, and one class beats one class only by coming later --
 * so with a single-class selector the block below lost, the notice stayed a
 * flex row, and the progress line's full width crushed the text beside it to
 * nothing. Measured at 0px wide before this, 706px after. */
.betterslack-row.betterslack-row--notice {
  display: block;
  margin: 4px 0 16px;
  padding: 16px 18px;
  border: 1px solid rgba(var(--sk_highlight, 18, 100, 163), 0.35);
  border-left-width: 3px;
  border-radius: 8px;
  background: rgba(var(--sk_highlight, 18, 100, 163), 0.07);
}
.betterslack-row.betterslack-row--notice .betterslack-row__meta { margin-bottom: 12px; }
.betterslack-row.betterslack-row--notice .betterslack-row__actions { flex-wrap: wrap; gap: 10px; }
/* The same card, in the colour of something wrong rather than something new. */
.betterslack-row.betterslack-row--warn {
  border-color: rgba(var(--sk_highlight_accent, 224, 30, 90), 0.4);
  background: rgba(var(--sk_highlight_accent, 224, 30, 90), 0.07);
}
.betterslack-skipped {
  margin: 10px 0 0;
  padding-left: 18px;
  display: grid;
  gap: 6px;
  font-size: 12.5px;
  line-height: 1.5;
  color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.75);
  word-break: break-word;
}

/*
 * The state while it is working, under the buttons rather than beside them.
 *
 * A disabled button with a line of grey text next to it reads as broken rather
 * than as busy: the row does not grow, so "Downloading and rebuilding..."
 * either squeezes the button or wraps under it, and nothing on screen moves for
 * however long the pull takes. Under the buttons it has the width, and it spins
 * while there is something to wait for.
 */
.betterslack-progress {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  margin-top: 12px;
  font-size: 13px;
  line-height: 1.4;
  color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.75);
}
.betterslack-progress:empty { display: none; }
.betterslack-progress::before {
  content: "";
  flex: 0 0 auto;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid rgba(var(--sk_highlight, 18, 100, 163), 0.25);
  border-top-color: rgba(var(--sk_highlight, 18, 100, 163), 1);
  animation: betterslack-spin 700ms linear infinite;
}
/* Finished, one way or the other: the spinner becomes a mark, because a circle
   still turning after the work is done says the opposite of what happened. */
.betterslack-progress--done::before,
.betterslack-progress--failed::before {
  animation: none;
  border: 0;
  width: 14px;
  height: 14px;
  font-size: 13px;
  line-height: 14px;
  text-align: center;
}
.betterslack-progress--done { color: var(--dt_color-content-hgl-2, #007a5a); }
.betterslack-progress--done::before { content: "✓"; color: inherit; }
.betterslack-progress--failed { color: var(--dt_color-content-imp, #c01343); }
.betterslack-progress--failed::before { content: "✕"; color: inherit; }

@keyframes betterslack-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .betterslack-progress::before { animation: none; }
}

/* A mod and its settings read as one block, with the settings indented under
 * the row they belong to rather than floating beside it. */
/* The palette, in Raycast's shape.
 *
 * What makes that shape legible is not decoration: every row carries a picture
 * of what it is, rows are grouped under headings, the category sits on the
 * right so the left can stay short, and a footer keeps saying which key does
 * what. A flat list of identical rows reads as a wall, which is what this was.
 */
.betterslack-palette {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(2px);
}
/*
 * Still looking, rather than nothing found.
 *
 * A directory search is debounced and then goes to the network, so for a few
 * hundred milliseconds after typing a name the list is empty because nobody has
 * answered yet. Saying "nothing matches" there is a wrong answer, not a plain
 * one. Same spinner as the update notice, from the same keyframes.
 */
.betterslack-palette__searching {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 28px 16px;
  font-size: 14px;
  color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.6);
}
.betterslack-palette__count--busy {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.betterslack-palette__spinner {
  flex: 0 0 auto;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid rgba(var(--sk_foreground_max, 29, 28, 29), 0.2);
  border-top-color: rgba(var(--sk_highlight, 18, 100, 163), 1);
  animation: betterslack-spin 700ms linear infinite;
}
@media (prefers-reduced-motion: reduce) {
  .betterslack-palette__count--busy {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.betterslack-palette__spinner { animation: none; }
}

.betterslack-palette__box {
  width: min(680px, calc(100vw - 48px));
  max-height: min(560px, 70vh);
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  overflow: hidden;
  background: rgba(var(--sk_primary_background, 255, 255, 255), 1);
  border: 1px solid rgba(var(--sk_foreground_low, 29, 28, 29), 0.2);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5);
}

.betterslack-palette__search {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 16px;
  border-bottom: 1px solid rgba(var(--sk_foreground_low, 29, 28, 29), 0.16);
}
.betterslack-palette__search_icon {
  font-size: 15px;
  opacity: 0.45;
  color: rgba(var(--sk_primary_foreground, 29, 28, 29), 1);
}
.betterslack-palette__input {
  flex: 1 1 auto;
  border: 0;
  padding: 16px 0;
  font-size: 17px;
  color: rgba(var(--sk_primary_foreground, 29, 28, 29), 1);
  background: transparent;
  outline: none;
}

/* The mode you are in, in front of the field rather than in your memory. */
.betterslack-palette__chip {
  flex: 0 0 auto;
  padding: 3px 9px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 700;
  color: rgba(var(--sk_primary_foreground, 29, 28, 29), 0.9);
  background: rgba(var(--sk_foreground_low, 29, 28, 29), 0.16);
}
.betterslack-palette__chip[hidden] { display: none; }

/* What the prefixes do, shown when there is nothing else to show -- a palette
   whose shortcuts are only in the documentation has no shortcuts. */
.betterslack-palette__modes[hidden] { display: none; }
.betterslack-palette__modes {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: center;
  padding: 8px 10px;
  border-top: 1px solid rgba(var(--sk_foreground_low, 29, 28, 29), 0.16);
}
.betterslack-palette__mode {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border: 0;
  border-radius: 8px;
  cursor: pointer;
  font-size: 12px;
  color: rgba(var(--sk_primary_foreground, 29, 28, 29), 0.75);
  background: rgba(var(--sk_foreground_low, 29, 28, 29), 0.1);
}
.betterslack-palette__mode kbd {
  font-family: inherit;
  font-weight: 700;
  padding: 0 5px;
  border-radius: 4px;
  background: rgba(var(--sk_foreground_low, 29, 28, 29), 0.18);
}

.betterslack-palette__list { overflow-y: auto; padding: 6px; flex: 1 1 auto; min-height: 140px; }
.betterslack-palette__section {
  padding: 10px 10px 4px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgba(var(--sk_primary_foreground, 29, 28, 29), 0.45);
}

.betterslack-palette__row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 7px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  text-align: left;
  color: rgba(var(--sk_primary_foreground, 29, 28, 29), 1);
  cursor: pointer;
}
.betterslack-palette__row[aria-selected="true"] {
  background: rgba(var(--sk_foreground_low, 29, 28, 29), 0.14);
}

/* One size for every kind of icon -- an avatar, an emoji, a glyph or a letter
   -- so the titles line up whatever the row happens to be. */
.betterslack-palette__icon {
  flex: 0 0 auto;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  object-fit: cover;
  background: rgba(var(--sk_foreground_low, 29, 28, 29), 0.14);
}
.betterslack-palette__icon--glyph {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 700;
  color: rgba(var(--sk_primary_foreground, 29, 28, 29), 0.75);
}

.betterslack-palette__text { flex: 1 1 auto; min-width: 0; display: block; }
/* The name and the status on one line: the name gives way first, and the
   status keeps its emoji whatever happens -- a half-drawn face is worse than a
   truncated word. */
.betterslack-palette__titleline {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.betterslack-palette__title {
  display: block;
  font-size: 15px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.betterslack-palette__status {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  flex: 0 1 auto;
  font-size: 13px;
  color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.6);
}
.betterslack-palette__status_emoji { flex: 0 0 auto; width: 14px; height: 14px; object-fit: contain; }
.betterslack-palette__status_text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.betterslack-palette__sub {
  display: block;
  font-size: 12px;
  opacity: 0.6;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.betterslack-palette__source {
  flex: 0 0 auto;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  color: rgba(var(--sk_primary_foreground, 29, 28, 29), 0.6);
  background: rgba(var(--sk_foreground_low, 29, 28, 29), 0.12);
}

.betterslack-palette__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  border-top: 1px solid rgba(var(--sk_foreground_low, 29, 28, 29), 0.16);
  font-size: 12px;
  color: rgba(var(--sk_primary_foreground, 29, 28, 29), 0.55);
}

/* Aligned with everything else. These chips carried 20px of padding of their
 * own on top of the dialog body's 24px, so the one row of the panel that is a
 * filter started further right than the rows it filters. */
.betterslack-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 0 0 12px;
}
.betterslack-filter {
  padding: 3px 10px;
  border-radius: 12px;
  font-size: 12px;
  color: rgba(var(--sk_primary_foreground, 29, 28, 29), 0.7);
  background: rgba(var(--sk_foreground_low, 29, 28, 29), 0.1);
  cursor: pointer;
}
.betterslack-filter:hover { color: rgba(var(--sk_primary_foreground, 29, 28, 29), 1); }
.betterslack-filter[aria-pressed="true"] {
  background: rgba(var(--sk_highlight, 18, 100, 163), 1);
  color: #fff;
}

/* The one tag that is a warning rather than a label. */
.betterslack-tag--error {
  background: rgba(var(--sk_highlight_accent, 224, 30, 90), 0.16);
  color: rgba(var(--sk_highlight_accent, 224, 30, 90), 1);
}

.betterslack-settings {
  padding: 4px 0 12px 16px;
  border-left: 2px solid rgba(var(--sk_foreground_low, 29, 28, 29), 0.2);
  margin: 0 0 8px 8px;
}
.betterslack-settings__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 6px 0;
  /* A control and its explanation share a line until there is no room for
     both, and then the control takes one of its own rather than shrinking to
     nothing. */
  flex-wrap: wrap;
}
.betterslack-settings__meta { min-width: 0; flex: 1 1 260px; }

/*
 * Wide enough to read what is in it.
 *
 * A max-width of 200px was left over from when these were all short numbers;
 * a select showing a sentence -- the palette's shortcut was one -- came out
 * clipped to a few characters with no way to see the rest. The width now
 * follows the content, within bounds, and the row wraps before it starves.
 */
.betterslack-settings__input {
  flex: 0 1 auto;
  width: auto;
  min-width: 220px;
  max-width: 100%;
}
.betterslack-row__actions:has(> .betterslack-settings__input) { flex: 1 1 240px; }
.betterslack-row__actions > .betterslack-settings__input { width: 100%; }
.betterslack-row__group { display: block; }

/*
 * A block of text: under its label, the row's whole width.
 *
 * Slack's text field is borrowed for the look, and it is a single-line field
 * with a fixed height, so the height is given back here. The class is doubled
 * for the reason the search box's is: Slack's stylesheet loads after this one.
 */
.betterslack-settings__row--wide { flex-direction: column; align-items: stretch; gap: 8px; }
.betterslack-settings__row--wide > .betterslack-row__actions { width: 100%; }
.betterslack-settings__text { display: flex; flex-direction: column; gap: 6px; width: 100%; }
.betterslack-settings__textarea.betterslack-settings__textarea,
.betterslack-editor__area.betterslack-editor__area {
  height: auto;
  min-height: 150px;
  padding: 8px 10px;
  line-height: 20px;
  resize: vertical;
  white-space: pre;
  overflow: auto;
}
.betterslack-settings__textbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.betterslack-settings__count {
  font-size: 12px;
  color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.6);
}

/* The same text, in a dialog of its own: wide, and as tall as the window allows. */
#betterslack-text-editor.c-dialog { opacity: 1; z-index: 1101; }
.betterslack-content--editor {
  width: min(900px, calc(100% - 32px));
  max-width: min(900px, calc(100% - 32px));
  height: min(760px, calc(100% - 64px));
  max-height: none;
  display: flex;
  flex-direction: column;
}
.betterslack-editor { flex: 1 1 auto; display: flex; min-height: 0; }
.betterslack-editor__area.betterslack-editor__area { flex: 1 1 auto; min-height: 0; width: 100%; resize: none; }
.betterslack-editor__actions { align-items: center; padding-top: 12px; }
.betterslack-editor__spacer { flex: 1 1 auto; }

/* ---- a mod's mark, and its page ---- */

/*
 * Every mod gets a shape, drawn or derived.
 *
 * A list of names is a table; a list of marks is a shelf, and this panel is a
 * shop before it is a settings screen. A mod that ships no icon.svg gets its
 * initial on a colour derived from its id -- its own, stable, and never a hole
 * where the others have something.
 */
.betterslack-icon {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border-radius: 8px;
  overflow: hidden;
  background: rgba(var(--sk_foreground_low, 29, 28, 29), 0.10);
  color: rgba(var(--sk_primary_foreground, 29, 28, 29), 0.9);
}
.betterslack-icon--sm { width: 34px; height: 34px; }
.betterslack-icon--lg { width: 64px; height: 64px; border-radius: 14px; }
.betterslack-icon svg { width: 62%; height: 62%; display: block; }
.betterslack-icon--letter {
  font-weight: 900;
  background: hsl(var(--betterslack-icon-hue, 210) 45% 42%);
  color: #fff;
}
.betterslack-icon--sm.betterslack-icon--letter { font-size: 15px; }
.betterslack-icon--lg.betterslack-icon--letter { font-size: 27px; }

/* The name is what you press to open the page, so it has to look pressable
   without turning the list into a wall of links. */
.betterslack-row__open {
  font: inherit;
  color: inherit;
  cursor: pointer;
  text-align: left;
  border-radius: 4px;
}
.betterslack-row__open:hover { text-decoration: underline; }

.betterslack-back {
  display: inline-block;
  margin: 4px 0 14px;
  font-size: 13px;
  color: rgba(var(--sk_highlight, 18, 100, 163), 1);
  cursor: pointer;
}
.betterslack-detail__head { display: flex; align-items: flex-start; gap: 16px; }
.betterslack-detail__title { flex: 1 1 auto; min-width: 0; }
.betterslack-detail__name { margin: 0 0 2px; font-size: 22px; font-weight: 900; }
.betterslack-detail__lede {
  margin: 14px 0 18px;
  font-size: 15px;
  line-height: 1.5;
  color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.85);
}
.betterslack-detail__section { margin: 22px 0 8px; font-size: 15px; font-weight: 900; }

/* Screenshots scroll sideways rather than stacking: a mod has two or three,
   and three tall pictures push the readme off the screen. */
.betterslack-shots {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  padding-bottom: 8px;
  margin-bottom: 6px;
}
/* One picture fills the column -- a mod's shot is a whole Slack window, and at
   420px the thing it is meant to show is a few pixels tall. Two or more go back
   to a strip you push sideways. */
.betterslack-shot { flex: 0 0 auto; width: min(420px, 78%); margin: 0; }
.betterslack-shots:has(> :only-child) .betterslack-shot { width: 100%; }
.betterslack-shot img {
  width: 100%;
  border-radius: 8px;
  border: 1px solid rgba(var(--sk_foreground_low, 29, 28, 29), 0.2);
  display: block;
}
.betterslack-shot figcaption {
  margin-top: 6px;
  font-size: 12px;
  color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.6);
}

/* ---- a readme, rendered ---- */

.sm-md { font-size: 14px; line-height: 1.55; }
.sm-md__h1, .sm-md__h2, .sm-md__h3, .sm-md__h4 {
  margin: 20px 0 8px;
  font-weight: 900;
  line-height: 1.25;
}
.sm-md__h1 { font-size: 19px; }
.sm-md__h2 { font-size: 17px; }
.sm-md__h3 { font-size: 15px; }
.sm-md__h4 { font-size: 14px; }
.sm-md p { margin: 0 0 12px; }
.sm-md__list { margin: 0 0 12px; padding-left: 22px; }
.sm-md__list li { margin: 3px 0; }
.sm-md__link { color: rgba(var(--sk_highlight, 18, 100, 163), 1); }
.sm-md__img {
  max-width: 100%;
  border-radius: 8px;
  border: 1px solid rgba(var(--sk_foreground_low, 29, 28, 29), 0.2);
  margin: 6px 0 14px;
}
.sm-md__quote {
  margin: 0 0 12px;
  padding-left: 12px;
  border-left: 3px solid rgba(var(--sk_foreground_low, 29, 28, 29), 0.3);
  color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.75);
}
.sm-md__rule {
  border: none;
  border-top: 1px solid rgba(var(--sk_foreground_low, 29, 28, 29), 0.2);
  margin: 18px 0;
}
.sm-md__code, .sm-md__pre code {
  font-family: Monaco, Menlo, Consolas, monospace;
  font-size: 12.5px;
}
.sm-md__code {
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(var(--sk_foreground_low, 29, 28, 29), 0.12);
}
.sm-md__pre {
  margin: 0 0 14px;
  padding: 10px 12px;
  border-radius: 8px;
  overflow-x: auto;
  background: rgba(var(--sk_foreground_low, 29, 28, 29), 0.10);
}

.betterslack-row {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding: 14px 0;
  border-bottom: 1px solid rgba(var(--sk_foreground_low, 29, 28, 29), 0.13);
}
.betterslack-row:last-child { border-bottom: none; }
.betterslack-row__meta { flex: 1; min-width: 0; }
.betterslack-row__name {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: var(--custom-font-weight-bold, 700);
  color: rgba(var(--sk_primary_foreground, 29, 28, 29), 1);
}
.betterslack-row__desc {
  margin-top: 2px;
  font-size: 13px;
  line-height: 1.46;
  color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.7);
}
.betterslack-row__sub {
  margin-top: 6px;
  font-size: 12px;
  color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.55);
}
.betterslack-row__actions { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }
.betterslack-row__more { opacity: 0; transition: opacity 80ms ease; }
.betterslack-row:hover .betterslack-row__more,
.betterslack-row__more:focus-visible { opacity: 1; }

.betterslack-tag {
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 11px;
  font-weight: var(--custom-font-weight-bold, 700);
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.6);
  background: rgba(var(--sk_foreground_low, 29, 28, 29), 0.1);
}

/* A theme's required plugins, on its row and in the dialog. */
.betterslack-row__requires {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.4;
  color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.6);
}
.betterslack-row__requires--missing {
  color: var(--dt_color-content-warn, #b8730a);
  font-weight: var(--custom-font-weight-bold, 700);
}
.betterslack-row__review {
  color: var(--dt_color-content-link, #1264a3);
  font-size: 12px;
  font-weight: var(--custom-font-weight-bold, 700);
  text-decoration: underline;
  cursor: pointer;
}

#betterslack-requires.c-dialog { opacity: 1; z-index: 1101; }
.betterslack-content--narrow {
  width: min(520px, calc(100% - 32px));
  max-width: min(520px, calc(100% - 32px));
  height: auto;
  max-height: min(560px, calc(100% - 64px));
}
.betterslack-requires { display: flex; flex-direction: column; gap: 14px; margin: 0; padding: 0; list-style: none; }
.betterslack-require {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 12px 14px;
  border-radius: 8px;
  /* A tinted card rather than a warning triangle: this is a choice to make,
     not an error the user is being blamed for. */
  background: rgba(var(--sk_foreground_low, 29, 28, 29), 0.08);
}
.betterslack-require__title {
  font-size: 15px;
  font-weight: var(--custom-font-weight-bold, 700);
  color: rgba(var(--sk_primary_foreground, 29, 28, 29), 1);
}
.betterslack-require__detail {
  font-size: 13px;
  line-height: 1.5;
  color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.7);
}
.betterslack-actions--dialog {
  justify-content: flex-end;
  padding: 4px 24px 20px;
  margin-top: 0;
}

/* Slack has no reusable switch class, so this is built from its variables. */
.betterslack-switch { position: relative; width: 38px; height: 22px; flex: 0 0 auto; cursor: pointer; }
.betterslack-switch input { position: absolute; opacity: 0; width: 0; height: 0; }
.betterslack-switch__track {
  position: absolute;
  inset: 0;
  border-radius: 999px;
  background: rgba(var(--sk_foreground_max, 29, 28, 29), 0.4);
  transition: background 120ms ease;
}
.betterslack-switch__thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  transition: transform 120ms ease;
}
.betterslack-switch input:checked + .betterslack-switch__track {
  background: var(--dt_color-content-hgl-2, #007a5a);
}
.betterslack-switch input:checked + .betterslack-switch__track .betterslack-switch__thumb {
  transform: translateX(16px);
}
.betterslack-switch input:focus-visible + .betterslack-switch__track {
  box-shadow: 0 0 0 2px rgba(var(--sk_highlight, 18, 100, 163), 1);
}

.betterslack-empty {
  padding: 32px 16px;
  text-align: center;
  font-size: 14px;
  color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.6);
}
.betterslack-hint {
  margin: 4px 0 16px;
  font-size: 13px;
  line-height: 1.5;
  color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.7);
}
.betterslack-actions { display: flex; align-items: center; gap: 12px; margin-top: 12px; }

/* Installing from a URL.
 *
 * This block had no rules of its own, which is not the same as having no
 * design: the row stayed display:block, so the field fell back to the browser
 * default of 174px -- a stub next to a full-height button -- and the whole
 * thing sat flush against the toolbar above it with nothing to separate them.
 */
.betterslack-remote {
  padding: 0 0 14px;
  margin-bottom: 14px;
  border-bottom: 1px solid rgba(var(--sk_foreground_low, 29, 28, 29), 0.13);
}
.betterslack-remote__row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}
.betterslack-remote__row .betterslack-search { flex: 1 1 auto; width: auto; }
.betterslack-remote__row .c-button { flex: 0 0 auto; }
.betterslack-status {
  flex: 0 1 auto;
  min-width: 0;
  font-size: 13px;
  color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.7);
}
.betterslack-status { font-size: 13px; color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.7); }
.betterslack-danger { color: var(--dt_color-content-imp, #c01343); }

.betterslack-info {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 6px 16px;
  margin: 16px 0 0;
  font-size: 13px;
}
.betterslack-info dt { color: rgba(var(--sk_foreground_max, 29, 28, 29), 0.7); }
.betterslack-info dd {
  margin: 0;
  font-family: Monaco, Menlo, monospace;
  font-size: 12px;
  word-break: break-all;
  color: rgba(var(--sk_primary_foreground, 29, 28, 29), 1);
}

/* Dialogs opened by mods through api.ui.modal: the same Slack shell, sized to
   the content rather than to a fixed panel height. */
/*
 * Slack ships .c-dialog at opacity 0 and fades it in with its own transition,
 * which never runs for a dialog we built. The panel has carried this override
 * since it moved into the light DOM; api.ui.modal did not, so every dialog a
 * mod opened was in the document, focusable, and completely invisible.
 */
.betterslack-widget_dialog { z-index: 1014; opacity: 1; }
.betterslack-widget_content { height: auto; max-height: min(640px, calc(100% - 64px)); }
.betterslack-widget_content .betterslack-body { flex: 0 1 auto; padding-bottom: 8px; }
.betterslack-widget_titles { flex: 1; min-width: 0; }
.betterslack-widget_subtitle { margin: 4px 0 0; }
.betterslack-widget_footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 16px 24px 20px;
}

/* Slack pins the top offset on .c-popover__content, so this layer is ours. */
/*
 * Above the dialog, not below it.
 *
 * A menu is opened *from* something, and often from inside one of ours -- the
 * overflow button in a profile dialog is the case that showed this. At 1013,
 * under the dialog's 1014, that menu drew behind the thing that opened it and
 * the options were simply invisible. A menu is transient and always belongs on
 * top of whatever it was summoned from; tests/requires.test.mjs holds the two
 * in that order so a renumbering cannot quietly swap them back.
 */
.betterslack-menu_layer {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 1015;
  will-change: transform;
}
.betterslack-menu_layer .c-menu {
  min-width: 180px;
  border-radius: 6px;
  background: rgba(var(--sk_primary_background, 255, 255, 255), 1);
  box-shadow: 0 0 0 1px rgba(var(--sk_foreground_low, 29, 28, 29), 0.13),
    0 4px 12px 0 rgba(0, 0, 0, 0.12);
}
`;

/**
 * Styles for the widgets mods get from `api.ui` — toasts, modals, confirms.
 *
 * Loaded inside each widget's shadow root, so a theme cannot break them and
 * they cannot leak into Slack. Colours read Slack's design tokens, which do
 * cross the shadow boundary, so widgets follow the active theme.
 */
export const WIDGET_CSS = `
:host { all: initial; }
* { box-sizing: border-box; }

:host, .toast-stack {
  --w-bg: var(--dt_color-base-pry, #ffffff);
  --w-raised: var(--dt_color-base-sec, #f8f8f8);
  --w-text: var(--dt_color-content-pry, #1d1c1d);
  --w-dim: var(--dt_color-content-sec, #454447);
  --w-border: var(--dt_color-otl-sec, rgba(94, 93, 96, 0.45));
  --w-green: var(--dt_color-content-hgl-2, #007a5a);
  --w-danger: var(--dt_color-content-imp, #c01343);
  --w-warn: var(--dt_color-content-hgl-3, #6b5000);
  --w-info: var(--dt_color-content-hgl-1, #1264a3);
  --w-font: Lato, Slack-Lato, appleLogo, sans-serif;
}

/* ---- toasts ---- */
.toast-stack {
  position: fixed;
  left: 50%;
  bottom: 28px;
  transform: translateX(-50%);
  z-index: 2147482000;
  display: flex;
  flex-direction: column-reverse;
  gap: 8px;
  align-items: center;
  pointer-events: none;
  font-family: var(--w-font);
}
.toast {
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: min(560px, 86vw);
  padding: 9px 16px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 700;
  color: #fff;
  background: #1d1c1d;
  box-shadow: 0 8px 26px rgba(0, 0, 0, 0.32);
  opacity: 0;
  transform: translateY(8px);
  transition: opacity 150ms ease, transform 150ms ease;
  pointer-events: auto;
}
.toast[data-shown="true"] { opacity: 1; transform: translateY(0); }
.toast[data-leaving="true"] { opacity: 0; transform: translateY(6px); }
.toast--success { background: var(--w-green); }
.toast--error { background: var(--w-danger); }
.toast--warning { background: var(--w-warn); }
.toast--info { background: var(--w-info); }
.toast__text { min-width: 0; }
.toast__action {
  all: unset;
  cursor: pointer;
  font-weight: 900;
  text-decoration: underline;
  white-space: nowrap;
}
.toast__action:focus-visible { outline: 2px solid #fff; outline-offset: 2px; border-radius: 3px; }

@media (prefers-reduced-motion: reduce) {
  .toast { transition: none; }
}
`;

/**
 * The launcher button.
 *
 * Almost nothing here on purpose: the button wears Slack's own
 * `p-control_strip__circle_button`, so its size, colour, hover, active state
 * and transition come from Slack and stay in step with the buttons beside it.
 * All that is left is sizing the icon, which Slack's own icons get from a
 * wrapper this button does not use.
 */
export const LAUNCHER_CSS = `
.betterslack-launcher svg,
.betterslack-toolbar-button svg,
.betterslack-action svg {
  width: 20px;
  height: 20px;
  display: block;
}

/*
 * Slack sizes its channel-header buttons from a per-page class
 * (p-view_header_search_action_button and friends) rather than from a shared
 * modifier, so a generic icon button lands at 36px next to their 28px. Borrow
 * one of theirs and the name would lie about what the button is; this states
 * the size directly instead.
 */
.p-view_header__actions .betterslack-toolbar-button {
  width: 28px;
  height: 28px;
}

/*
 * Somebody's status, wherever a mod draws one.
 *
 * The node comes from api.slack.statusNode, so its look belongs here rather
 * than in each mod that shows one -- two of them do, and a status that is 16px
 * in one and 20px in the other is the drift this API exists to stop. Sized
 * against Slack's own inline emoji, which is 20px in a message and smaller in
 * a sidebar row.
 */
.betterslack-status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}
.betterslack-status__emoji {
  flex: 0 0 auto;
  width: 15px;
  height: 15px;
  object-fit: contain;
  vertical-align: -2px;
}
.betterslack-status__emoji--char { font-size: 14px; line-height: 15px; }

/*
 * The same emoji again, inside a tooltip.
 *
 * Slack draws one there at the size of the sentence beside it rather than at
 * the size it had in the row -- the row's is a marker, the tooltip's is part of
 * the reading. Sized here rather than in the tooltip's own block because these
 * are the status classes, and the picture is the status.
 */
.betterslack-tooltip__heading { display: flex; align-items: center; gap: 6px; }
.betterslack-tooltip__icon { flex: 0 0 auto; display: flex; align-items: center; }
.betterslack-tooltip__icon .betterslack-status__emoji { width: 16px; height: 16px; }
.betterslack-tooltip__icon .betterslack-status__emoji--char { font-size: 15px; line-height: 16px; }
.betterslack-status__text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Slack's unread badge, on our own button: the same pill, the same red, the
 * same place. Anything else in that strip would read as a Slack control that
 * had gone wrong. */
/*
 * The launcher dims and brightens with the icons beside it.
 *
 * Slack's rail icons do that by taking a colour from the strip; the mark has
 * four of its own and cannot, so opacity stands in for the tint it does not
 * have. Without this it would be the one button in the column that does not
 * react to a pointer.
 */
.betterslack-launcher { position: relative; opacity: 0.82; transition: opacity 80ms ease; }
.betterslack-launcher:hover,
.betterslack-launcher:focus-visible { opacity: 1; }
.betterslack-launcher__badge {
  position: absolute;
  top: -2px;
  right: -2px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: rgba(var(--sk_highlight_accent, 224, 30, 90), 1);
  color: #fff;
  font: 700 11px/16px Lato, Slack-Lato, sans-serif;
  text-align: center;
  pointer-events: none;
}
`;

/**
 * A mod's own view, and its entry in Slack's tab rail.
 *
 * Installed by `api.slack.addView` the first time one is created, in the
 * plugin layer beside the launcher's. Two numbers here were measured in a
 * live client and neither is guessable from the symptom:
 *
 * The pane a view is pinned to is `.p-view_contents--primary`, which is
 * `position: relative`, and the conversation Slack draws inside it sits at
 * z-index 201 -- so a view below that is present, correctly sized and
 * completely see through, which reads as a stylesheet that never loaded. And
 * Slack's own modal overlay is 1053, so a view has to stay well under it or
 * every confirmation a view opens appears behind the view that asked for it.
 *
 * The rail entry copies Slack's own metrics rather than its class names for
 * the parts that are ours: a 40px square, an icon at 20px, a label at 11px.
 * Slack's classes do the rest, so the entry follows every theme.
 */
export const VIEW_CSS = `
/*
 * What is under a view is not merely covered: it is taken off the screen.
 *
 * Covering it leaves Slack's conversation mounted, sized and, as far as Slack
 * is concerned, being looked at -- so a message arriving in the channel you
 * left behind is marked read, and the unread you were relying on is gone. A
 * mod may not cost somebody a message.
 *
 * Written as :has() on the panel rather than as a class somebody has to
 * remember to take off: the rule stops matching the moment the view unmounts,
 * so there is no restore step to get wrong. :has() is supported in Slack 4.51,
 * measured.
 */
.p-client_workspace__tabpanel:has(> .betterslack-view) > *:not(.betterslack-view) {
  display: none !important;
}

.betterslack-view {
  position: absolute;
  inset: 0;
  z-index: 300;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--dt_color-base-pry, #1a1d21);
  color: var(--dt_color-content-pry, #d1d2d3);
  animation: betterslack-view-enter var(--sm-motion-base, 200ms) var(--sm-motion-ease, cubic-bezier(.2, .9, .25, 1));
}

@keyframes betterslack-view-enter {
  from { opacity: 0; transform: translateX(var(--sm-motion-shift, 8px)); }
  to { opacity: 1; transform: none; }
}

.betterslack-view-tab .p-tab_rail__button__icon_inner {
  display: flex;
  align-items: center;
  justify-content: center;
}
.betterslack-view-tab .p-tab_rail__button__icon_inner svg { width: 20px; height: 20px; }
.betterslack-view-tab.p-tab_rail__button--active .p-tab_rail__button__icon_inner svg { width: 22px; height: 22px; }
`;
