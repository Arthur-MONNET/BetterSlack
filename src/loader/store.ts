// Settings and installed mods on disk.
//
// Settings live outside the repo (~/.betterslack) so that pulling the repo never
// clobbers what the user has enabled, and so a mod author's working copy and
// their real config stay separate.

import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { DEFAULT_SETTINGS, type Settings } from '../shared/protocol.js';

export const USER_ROOT = process.env.BETTERSLACK_HOME ?? path.join(homedir(), '.betterslack');
export const USER_MODS_ROOT = path.join(USER_ROOT, 'mods');
const SETTINGS_FILE = path.join(USER_ROOT, 'settings.json');

/** The home a SlackMod-era install wrote to, carried over on first run. */
const LEGACY_ROOT = path.join(homedir(), '.slackmod');

export async function ensureUserRoot(): Promise<void> {
  /*
   * Carry the old home over rather than starting empty.
   *
   * The rename moved this directory, and everything a person has -- which mods
   * they installed, which are on, their custom CSS, their own themes -- lives
   * in it. Coming back to an empty catalogue after an update would read as the
   * update having wiped them. Moved only when there is nothing at the new
   * place, so a second run cannot clobber real state with a stale copy.
   */
  if (!process.env.BETTERSLACK_HOME) {
    const arrived = await fs.stat(USER_ROOT).then(() => true).catch(() => false);
    const legacy = await fs.stat(LEGACY_ROOT).then(() => true).catch(() => false);
    if (!arrived && legacy) {
      await fs.rename(LEGACY_ROOT, USER_ROOT).catch(() => undefined);
      console.log(`[betterslack] moved ${LEGACY_ROOT} to ${USER_ROOT}`);
    }
  }
  await fs.mkdir(USER_MODS_ROOT, { recursive: true });
}

export async function readSettings(): Promise<Settings> {
  try {
    const raw = await fs.readFile(SETTINGS_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<Settings>;
    // Merge rather than trust: a hand-edited or older file must not crash boot.
    const installed = Array.isArray(parsed.installed)
      ? parsed.installed.filter((x) => typeof x === 'string')
      : [];
    return {
      installed,
      // A mod can only be on if it is installed; a hand-edited file must not be
      // able to produce an enabled-but-not-installed state.
      enabled: (Array.isArray(parsed.enabled) ? parsed.enabled.filter((x) => typeof x === 'string') : [])
        .filter((id) => installed.includes(id)),
      modSettings:
        parsed.modSettings && typeof parsed.modSettings === 'object' ? parsed.modSettings : {},
      customCss: typeof parsed.customCss === 'string' ? parsed.customCss : '',
      hotReload: typeof parsed.hotReload === 'boolean' ? parsed.hotReload : true,
      // Named here or dropped here: this builds the object key by key rather
      // than spreading what it parsed, so a key nobody adds to this list is
      // written by the panel and gone by the next read.
      panelSort: typeof parsed.panelSort === 'string' ? parsed.panelSort : DEFAULT_SETTINGS.panelSort,
      modFailures:
        parsed.modFailures && typeof parsed.modFailures === 'object' ? parsed.modFailures : {},
      slackPrefs:
        parsed.slackPrefs && typeof parsed.slackPrefs === 'object' ? parsed.slackPrefs : {},
      dockIconAsked: parsed.dockIconAsked === true,
      seeded: Array.isArray(parsed.seeded) ? parsed.seeded.filter((x) => typeof x === 'string') : [],
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[betterslack] settings unreadable, falling back to defaults: ${err}`);
    }
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * The marker that says a run started and never reported itself healthy.
 *
 * Written before Slack is launched and removed when the renderer says it got
 * all the way up. Finding one at startup means the last run did not -- most
 * likely a mod took the renderer down, since that is the failure this project
 * has actually had, twice.
 */
const BOOT_MARKER = path.join(USER_ROOT, 'booting');

export async function markBootStarted(): Promise<void> {
  await ensureUserRoot();
  await fs.writeFile(BOOT_MARKER, new Date().toISOString(), 'utf8').catch(() => undefined);
}

export async function markBootHealthy(): Promise<void> {
  await fs.rm(BOOT_MARKER, { force: true }).catch(() => undefined);
}

/** True when the previous run never got as far as saying it was up. */
export async function lastBootFailed(): Promise<boolean> {
  return fs.stat(BOOT_MARKER).then(() => true).catch(() => false);
}

/**
 * Everything a person has, as one document.
 *
 * Settings and the mods they wrote or installed themselves -- which is the part
 * that cannot be downloaded again. Deliberately not the catalogue: those come
 * back with the project, and a backup that carries them would restore stale
 * copies over newer ones.
 */
export async function exportBackup(): Promise<string> {
  const settings = await readSettings();
  const mods: Record<string, Record<string, string>> = {};

  const walk = async (dir: string, prefix: string, into: Record<string, string>) => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(full, rel, into);
      else if (/\.(js|mjs|css|json)$/.test(entry.name)) {
        into[rel] = await fs.readFile(full, 'utf8');
      }
    }
  };

  for (const entry of await fs.readdir(USER_MODS_ROOT, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory()) continue;
    const files: Record<string, string> = {};
    await walk(path.join(USER_MODS_ROOT, entry.name), '', files);
    if (Object.keys(files).length > 0) mods[entry.name] = files;
  }

  return JSON.stringify(
    { kind: 'betterslack-backup', version: 1, exportedAt: new Date().toISOString(), settings, mods },
    null,
    2,
  );
}

export interface RestoreResult {
  ok: boolean;
  detail: string;
}

/**
 * Put a backup back.
 *
 * Refuses anything that is not one rather than guessing, and writes mods before
 * settings so a restored `enabled` list never names something that is not there
 * yet. Nothing outside ~/.betterslack is touched: the install is not part of
 * what a person owns.
 */
export async function importBackup(archive: string): Promise<RestoreResult> {
  let parsed: { kind?: string; settings?: Partial<Settings>; mods?: Record<string, Record<string, string>> };
  try {
    parsed = JSON.parse(archive);
  } catch {
    return { ok: false, detail: 'that is not a backup file' };
  }
  if (parsed.kind !== 'betterslack-backup' || !parsed.settings) {
    return { ok: false, detail: 'that is not a BetterSlack backup' };
  }

  await ensureUserRoot();
  let restored = 0;
  for (const [id, files] of Object.entries(parsed.mods ?? {})) {
    if (!/^[a-z0-9][a-z0-9-]{1,48}$/.test(id)) continue;
    for (const [name, contents] of Object.entries(files)) {
      // A path that climbs out of the mod folder is the one thing an archive
      // must never be able to do.
      const target = path.join(USER_MODS_ROOT, id, name);
      if (!target.startsWith(path.join(USER_MODS_ROOT, id) + path.sep)) continue;
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, contents, 'utf8');
    }
    restored++;
  }

  await writeSettings({ ...DEFAULT_SETTINGS, ...parsed.settings } as Settings);
  return { ok: true, detail: `${restored} mod(s) and your settings` };
}

export async function writeSettings(settings: Settings): Promise<void> {
  await ensureUserRoot();
  // Write-then-rename so a crash mid-write cannot leave a truncated file.
  const tmp = `${SETTINGS_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(settings, null, 2), 'utf8');
  await fs.rename(tmp, SETTINGS_FILE);
}

// Every mutation goes through one chain. Two Slack windows can flip switches at
// the same moment, and a read-modify-write that interleaves would silently drop
// one of the changes.
let queue: Promise<unknown> = Promise.resolve();

function serialize<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work);
  queue = run.catch(() => undefined);
  return run;
}

export function mergeSettings(patch: Partial<Settings>): Promise<Settings> {
  return serialize(async () => {
    const current = await readSettings();
    const next: Settings = { ...current, ...patch };
    await writeSettings(next);
    return next;
  });
}

/**
 * Flip one mod on or off against the current on-disk list, rather than letting
 * a caller send a whole array computed from a snapshot it may have taken a
 * while ago.
 */
export function setModEnabled(id: string, enabled: boolean): Promise<Settings> {
  return serialize(async () => {
    const current = await readSettings();
    const next: Settings = {
      ...current,
      // Enabling implies installing: the UI never offers one without the other.
      installed: enabled ? [...new Set([...current.installed, id])] : current.installed,
      enabled: enabled
        ? [...new Set([...current.enabled, id])]
        : current.enabled.filter((x) => x !== id),
    };
    await writeSettings(next);
    return next;
  });
}

/** Install or remove a catalogue mod. Removing also turns it off. */
export function setModInstalled(id: string, installed: boolean): Promise<Settings> {
  return serialize(async () => {
    const current = await readSettings();
    const next: Settings = {
      ...current,
      installed: installed
        ? [...new Set([...current.installed, id])]
        : current.installed.filter((x) => x !== id),
      enabled: installed ? current.enabled : current.enabled.filter((x) => x !== id),
    };
    await writeSettings(next);
    return next;
  });
}

/**
 * Install and switch on the catalogue's default mods, each once per person.
 *
 * Called at every start with the ids of the `builtin` mods marked
 * `defaultEnabled`. Anything not yet in `seeded` is installed, switched on and
 * written down; anything already there is left exactly as the person left it.
 * That is what makes it a default: a first install and an update that brings a
 * new marked mod both end with it running, and somebody who switched it off
 * keeps it off.
 *
 * Writes nothing when there is nothing new, so an ordinary start costs one read.
 */
export function seedDefaultMods(ids: string[]): Promise<{ settings: Settings; added: string[] }> {
  return serialize(async () => {
    const current = await readSettings();
    const seeded = current.seeded ?? [];
    const added = ids.filter((id) => !seeded.includes(id));
    if (added.length === 0) return { settings: current, added };
    const next: Settings = {
      ...current,
      installed: [...new Set([...current.installed, ...added])],
      enabled: [...new Set([...current.enabled, ...added])],
      seeded: [...seeded, ...added],
    };
    await writeSettings(next);
    return { settings: next, added };
  });
}
