// Splash Lines — a line on the start screen, the way Minecraft has one.
//
// The start screen is up from the first frame, before any plugin has run, so
// this mod does not put the line there itself: by the time `start` is called
// the screen is already coming down. The manifest names the setting instead
// (`"splash": { "setting": "lines" }`) and the runtime reads it out of the boot
// payload and picks one. What is left for the code is the palette command, for
// anybody who wants another without restarting Slack.

import { STRINGS } from './strings.js';

/**
 * The lines in the list, as the start screen reads them: one per line, blank
 * lines and `#` headings skipped. Kept in step with `splashLinesFrom` in the
 * runtime -- a mod may only import its own files.
 */
export function linesOf(text) {
  return String(text ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

/** One of them at random, or null when there are none. */
export function pick(lines, random = Math.random) {
  if (lines.length === 0) return null;
  return lines[Math.min(lines.length - 1, Math.floor(random() * lines.length))];
}

export default {
  /**
   * @param {import('../../../src/runtime/api.js').PluginApi} api
   */
  start(api) {
    const t = api.i18n.strings(STRINGS);
    api.commands.add({
      id: 'another',
      title: t('command'),
      subtitle: t('commandSubtitle'),
      icon: '⭐',
      run: () => {
        const line = pick(linesOf(api.settings.get('lines', '')));
        api.ui.toast(line ?? t('empty'));
      },
    });
  },

  stop() {},
};
