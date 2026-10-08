// What GitLab's statuses mean, said once.
//
// Everything that draws or decides something from a status goes through here,
// so "running" is never one thing in the list and another in the top bar.
//
// GitLab has a dozen. They are folded into a few *kinds* -- what a reader
// would want to tell apart at a glance -- and each kind has a shape of its own,
// so none of them is told apart by colour alone: a check, a cross, a turning
// arc, an empty ring, a play triangle, a slash, a skip mark, a clock.
//
// `manual` is deliberately not "running": the pipeline is waiting for a person,
// and nothing is happening -- so it is grey, as GitLab draws it, and not a
// warning. `skipped` and `canceled` are not failures either.

/**
 * Statuses of a pipeline that is still going to do something by itself.
 * `canceling` is what newer GitLabs call a cancel in progress.
 */
const ACTIVE = new Set([
  'created', 'waiting_for_resource', 'preparing', 'pending', 'running', 'scheduled', 'canceling',
]);

const KINDS = {
  success: 'success',
  failed: 'failed',
  running: 'running',
  canceling: 'running',
  pending: 'pending',
  created: 'pending',
  preparing: 'pending',
  waiting_for_resource: 'pending',
  scheduled: 'scheduled',
  manual: 'manual',
  canceled: 'canceled',
  skipped: 'skipped',
  // Not a GitLab status: a failed job its pipeline allows to fail.
  warning: 'warning',
};

/** The kind a status is drawn as; anything GitLab adds later reads as pending, not as an error. */
export const kindOf = (status) => KINDS[status] ?? 'pending';

/** Will the pipeline go on by itself? `manual` waits for a person, so it does not. */
export const isActive = (status) => ACTIVE.has(status);

/** success / danger / info / warning / muted -- what colour family, never the only signal. */
export function toneOf(status) {
  switch (kindOf(status)) {
    case 'success': return 'success';
    case 'failed': return 'danger';
    case 'running': return 'info';
    case 'warning': return 'warning';
    default: return 'muted';
  }
}

/** The key of the word for a status in strings.js: `status_running`. */
export const labelKey = (status) => `status_${KINDS[status] ? status : 'created'}`;

/**
 * Shapes, 16x16, drawn with currentColor. A ring plus one mark, except
 * `running` and `pending`, whose whole point is the ring.
 */
const RING = '<circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.5"/>';
const MARKS = {
  success: '<path d="M5 8.2 7.1 10.3 11 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  failed: '<path d="M5.6 5.6 10.4 10.4M10.4 5.6 5.6 10.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  manual: '<path d="M6.6 5.4 10.6 8 6.6 10.6Z" fill="currentColor"/>',
  canceled: '<path d="M5.2 10.8 10.8 5.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  skipped: '<path d="M5.4 5.8 8 8 5.4 10.2M8.6 5.8 11.2 8 8.6 10.2" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>',
  scheduled: '<path d="M8 4.8V8l2.2 1.4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
  warning: '<path d="M8 4.8v3.9" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="8" cy="11" r="1" fill="currentColor"/>',
};

/** The inline SVG for a status. `running` is an open arc, so it can turn. */
export function iconOf(status) {
  const kind = kindOf(status);
  if (kind === 'running') {
    return '<svg viewBox="0 0 16 16" aria-hidden="true" class="betterslack-gitlab-icon" data-kind="running">'
      + '<circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-opacity=".28" stroke-width="1.5"/>'
      + '<path d="M8 1.75a6.25 6.25 0 0 1 6.25 6.25" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  }
  const dashed = status === 'created' || status === 'waiting_for_resource' || status === 'preparing';
  const ring = dashed
    ? '<circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2.4 2"/>'
    : RING;
  return `<svg viewBox="0 0 16 16" aria-hidden="true" class="betterslack-gitlab-icon" data-kind="${kind}">${ring}${MARKS[kind] ?? ''}</svg>`;
}
