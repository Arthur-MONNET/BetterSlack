// A pipeline's stages and jobs, from the list of jobs GitLab answers with.
//
// GitLab has no "stage" resource to ask for: a job names the stage it belongs
// to, and the stages' order is the order they were created in. Everything the
// screens show -- the row of stage markers, the jobs inside one, the "7/12"
// -- comes from here, so it is decided once and tested.

import { isActive, kindOf } from './status.js';

/** What a screen needs of a job, and nothing GitLab sent besides. */
export function normaliseJob(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.name !== 'string') return null;
  if (!Number.isFinite(Number(raw.id))) return null;
  return {
    id: Number(raw.id),
    name: raw.name,
    stage: typeof raw.stage === 'string' && raw.stage ? raw.stage : '-',
    status: typeof raw.status === 'string' ? raw.status : 'created',
    allowFailure: raw.allow_failure === true,
    duration: Number.isFinite(raw.duration) ? Math.round(raw.duration) : null,
    webUrl: typeof raw.web_url === 'string' ? raw.web_url : null,
  };
}

/**
 * A failed job its pipeline lets fail is not a failure of the pipeline: it is
 * drawn as a warning, and does not turn its stage red.
 */
export const effectiveStatus = (job) => (job.status === 'failed' && job.allowFailure ? 'warning' : job.status);

/**
 * One status for a stage, from its jobs.
 *
 * A failure outranks everything: somebody watching a stage that is half failed
 * and half running wants the failure, now, not when the rest has finished.
 * After that, what is happening, then what is waiting, then what is over.
 *
 * A job waiting for a person says nothing about how the stage went, and neither
 * does one that did not run. They are left out of the answer whenever anything
 * else is in the stage, so a stage of passed jobs and a manual deploy reads as
 * passed. Only when nothing else is there does the stage say `manual` -- and a
 * failure, a failure the pipeline allows, or work still going still shows,
 * because those are in the other jobs.
 */
export function stageStatus(jobs) {
  const kinds = jobs.map((job) => kindOf(effectiveStatus(job)));
  const told = jobs.filter((job) => {
    const kind = kindOf(effectiveStatus(job));
    return kind !== 'manual' && kind !== 'skipped';
  });
  if (told.length === 0) {
    if (kinds.includes('manual')) return 'manual';
    return kinds.length > 0 ? 'skipped' : 'created';
  }
  const has = (kind) => told.some((job) => kindOf(effectiveStatus(job)) === kind);
  if (has('failed')) return 'failed';
  if (has('running')) return 'running';
  if (has('pending')) return told.some((job) => job.status === 'pending') ? 'pending' : 'created';
  if (has('scheduled')) return 'scheduled';
  if (has('warning')) return 'warning';
  if (has('canceled')) return 'canceled';
  return 'success';
}

/**
 * The stages of a pipeline, in the order it runs them, each with its jobs.
 *
 * Stage order is the order of the first job of each, by id: jobs are created
 * stage by stage, so ids rise through the pipeline. Inside a stage the jobs
 * keep that order too -- the order the pipeline's file lists them in, which is
 * how GitLab's own popover shows them, and not alphabetical.
 */
export function groupStages(jobs) {
  const order = [];
  const by = new Map();
  for (const job of [...jobs].sort((a, b) => a.id - b.id)) {
    if (!by.has(job.stage)) {
      by.set(job.stage, []);
      order.push(job.stage);
    }
    by.get(job.stage).push(job);
  }
  return order.map((name) => {
    const own = by.get(name);
    return { name, status: stageStatus(own), jobs: own };
  });
}

/**
 * How far a pipeline is, without pretending.
 *
 * - `total` is what the pipeline will do by itself: every job except the ones
 *   that were skipped and the ones waiting for a person. Counting a manual
 *   deploy as work to come would keep "12/12" out of reach for ever; counting
 *   it as done would be a lie.
 * - `done` is what has finished running, whatever the outcome: succeeded,
 *   failed (including one allowed to), or canceled.
 * - `manual` and `skipped` are reported beside it, never folded into it.
 *
 * `ratio` is only a summary. The row of stages is the information.
 */
export function progressOf(jobs) {
  const counts = { done: 0, total: 0, failed: 0, running: 0, manual: 0, skipped: 0 };
  for (const job of jobs) {
    const kind = kindOf(effectiveStatus(job));
    if (kind === 'manual') { counts.manual += 1; continue; }
    if (kind === 'skipped') { counts.skipped += 1; continue; }
    counts.total += 1;
    if (kind === 'failed') counts.failed += 1;
    if (kind === 'running') counts.running += 1;
    if (kind === 'success' || kind === 'failed' || kind === 'warning' || kind === 'canceled') counts.done += 1;
  }
  return counts;
}

/** The stage that is happening now, else the one that failed, else null. */
export function currentStage(stages) {
  return stages.find((stage) => stage.status === 'running')
    ?? stages.find((stage) => isActive(stage.status))
    ?? null;
}

/** The first job that failed and was not allowed to, else null. */
export function failedJob(stages) {
  for (const stage of stages) {
    const job = stage.jobs.find((candidate) => kindOf(candidate.status) === 'failed' && !candidate.allowFailure);
    if (job) return job;
  }
  return null;
}
