// The rules, with no DOM and no network: statuses, stages, progress,
// grouping, which pipeline the bar shows, how it shrinks, when to ask again,
// and what is kept.

import test from 'node:test';
import assert from 'node:assert/strict';
import { iconOf, isActive, kindOf, toneOf } from './lib/status.js';
import { currentStage, effectiveStatus, failedJob, groupStages, normaliseJob, progressOf, stageStatus } from './lib/stages.js';
import { groupByProject, normaliseMergeRequest, ownUrl, prettyName } from './lib/model.js';
import { allPipelines, headOf, latest, pickHeadline } from './lib/pipelines.js';
import { chooseLevel, levelsFor } from './lib/fit.js';
import { backoff, due, pipelinesDue, SETTLED_RECHECK_MS } from './lib/schedule.js';
import { LIMITS, restore, snapshotOf, TTL_MS } from './lib/snapshot.js';
import { BASE, NOW, iso, job as rawJob, mr as rawMr } from './fixtures.test.mjs';

const ALL_STATUSES = ['created', 'waiting_for_resource', 'preparing', 'pending', 'running', 'success', 'failed',
  'canceled', 'skipped', 'manual', 'scheduled'];

// -- statuses ----------------------------------------------------------------

test('every GitLab status has a kind, a tone and a shape of its own', () => {
  for (const status of ALL_STATUSES) {
    assert.ok(kindOf(status), status);
    assert.match(iconOf(status), /^<svg /, status);
  }
  const expected = { success: 'success', failed: 'danger', running: 'info', pending: 'muted',
    canceled: 'muted', skipped: 'muted', manual: 'muted', scheduled: 'muted' };
  for (const [status, tone] of Object.entries(expected)) assert.equal(toneOf(status), tone, status);
});

test('only success is success, and only failed is red: nothing else is folded into an error', () => {
  for (const status of ALL_STATUSES.filter((s) => s !== 'failed')) assert.notEqual(toneOf(status), 'danger', status);
  for (const status of ALL_STATUSES.filter((s) => s !== 'success')) assert.notEqual(toneOf(status), 'success', status);
});

test('the shapes differ, so colour is never the only way to tell them apart', () => {
  const shapes = ['success', 'failed', 'running', 'pending', 'manual', 'canceled', 'skipped', 'scheduled'].map(iconOf);
  assert.equal(new Set(shapes).size, shapes.length);
});

test('which pipelines are active: created through running and scheduled, not manual', () => {
  for (const status of ['created', 'waiting_for_resource', 'preparing', 'pending', 'running', 'scheduled']) {
    assert.equal(isActive(status), true, status);
  }
  for (const status of ['success', 'failed', 'canceled', 'skipped', 'manual']) assert.equal(isActive(status), false, status);
});

test('a status GitLab adds later reads as waiting, never as an error', () => {
  assert.equal(kindOf('some_new_status'), 'pending');
  assert.equal(toneOf('some_new_status'), 'muted');
});

// -- jobs, stages, progress --------------------------------------------------

const J = (id, stage, name, status, extra = {}) => normaliseJob(rawJob(id, 1, 10, stage, name, status, extra));

test('stages come in the order the pipeline runs them, and jobs in the order its file lists them', () => {
  const stages = groupStages([
    J(5, 'deploy', 'Deploy', 'created'),
    J(2, 'checks', 'Translations', 'success'),
    J(1, 'checks', 'Code Quality: [tsc]', 'success'),
    J(3, 'checks', 'Code Quality: [eslint]', 'success'),
    J(4, 'build', 'Vite Build', 'running'),
  ]);
  assert.deepEqual(stages.map((stage) => stage.name), ['checks', 'build', 'deploy']);
  assert.deepEqual(stages[0].jobs.map((item) => item.name), ['Code Quality: [tsc]', 'Translations', 'Code Quality: [eslint]'],
    'by job id, as GitLab lists them -- not alphabetical');
});

test('a stage is as bad as its worst job, then as busy as its busiest', () => {
  const s = (...statuses) => stageStatus(statuses.map((status, i) => J(i + 1, 'x', `j${i}`, status)));
  assert.equal(s('success', 'success'), 'success');
  assert.equal(s('success', 'running'), 'running');
  assert.equal(s('failed', 'running'), 'failed', 'a failure is not hidden behind work still going');
  assert.equal(s('success', 'pending'), 'pending');
  assert.equal(s('manual', 'manual'), 'manual', 'only manual jobs: the stage waits for a person');
  assert.equal(s('skipped', 'skipped'), 'skipped');
  assert.equal(s('success', 'skipped'), 'success');
  assert.equal(s('canceled', 'success'), 'canceled');
  assert.equal(s('created', 'created'), 'created');
});

test('a job waiting for a person does not colour its stage when there is anything else in it', () => {
  const s = (...statuses) => stageStatus(statuses.map((status, i) => J(i + 1, 'x', `j${i}`, status)));
  // The other jobs' state is what the stage shows.
  assert.equal(s('success', 'success', 'manual'), 'success');
  assert.equal(s('manual', 'success'), 'success');
  assert.equal(s('canceled', 'manual'), 'canceled');
  // A failure, a failure that is allowed, and work still going still show, as before.
  assert.equal(s('failed', 'manual'), 'failed');
  assert.equal(s('failed', 'success', 'manual'), 'failed');
  assert.equal(s('running', 'success', 'manual'), 'running');
  assert.equal(s('pending', 'manual'), 'pending');
  assert.equal(s('created', 'manual'), 'created');
  const allowed = [J(1, 'x', 'flaky', 'failed', { allow_failure: true }), J(2, 'x', 'ok', 'success'), J(3, 'x', 'deploy', 'manual')];
  assert.equal(stageStatus(allowed), 'warning');
  // Jobs that did not run say nothing either: a manual deploy beside them is what the stage is about.
  assert.equal(s('skipped', 'manual'), 'manual');
  assert.equal(s('skipped', 'skipped'), 'skipped');
  assert.equal(s('success', 'skipped', 'manual'), 'success');
});

test('a manual job is grey, like GitLab draws it, and not the warning colour', () => {
  assert.equal(toneOf('manual'), 'muted');
  assert.notEqual(toneOf('manual'), toneOf('warning'));
  const shapes = new Set(['manual', 'canceled', 'skipped', 'created'].map(iconOf));
  assert.equal(shapes.size, 4, 'grey, but still its own shape');
});

test('a failure the pipeline allows is a warning, and does not turn its stage red', () => {
  const allowed = J(1, 'test', 'flaky', 'failed', { allow_failure: true });
  assert.equal(effectiveStatus(allowed), 'warning');
  assert.equal(stageStatus([allowed, J(2, 'test', 'unit', 'success')]), 'warning');
  assert.equal(failedJob(groupStages([allowed])), null);
});

test('progress counts what finished out of what will run by itself, and says what it left out', () => {
  const jobs = [
    J(1, 'a', 'one', 'success'), J(2, 'a', 'two', 'success'), J(3, 'b', 'three', 'failed'),
    J(4, 'b', 'four', 'running'), J(5, 'c', 'five', 'pending'), J(6, 'c', 'six', 'manual'),
    J(7, 'c', 'seven', 'skipped'), J(8, 'c', 'eight', 'canceled'),
  ];
  assert.deepEqual(progressOf(jobs), { done: 4, total: 6, failed: 1, running: 1, manual: 1, skipped: 1 });
});

test('manual and skipped jobs are neither done nor still to do', () => {
  const finished = [J(1, 'a', 'build', 'success'), J(2, 'b', 'deploy', 'manual'), J(3, 'b', 'extra', 'skipped')];
  const progress = progressOf(finished);
  assert.equal(progress.done, 1);
  assert.equal(progress.total, 1, 'the pipeline is as done as it will get by itself');
  assert.equal(progress.manual, 1);
  assert.equal(progress.skipped, 1);
});

test('the current stage is the one running, else the first still going', () => {
  const stages = groupStages([J(1, 'a', 'x', 'success'), J(2, 'b', 'y', 'running'), J(3, 'c', 'z', 'created')]);
  assert.equal(currentStage(stages).name, 'b');
  assert.equal(currentStage(groupStages([J(1, 'a', 'x', 'success'), J(2, 'b', 'y', 'pending')])).name, 'b');
  assert.equal(currentStage(groupStages([J(1, 'a', 'x', 'success')])), null);
});

test('the failed job is the first that failed and was not allowed to', () => {
  const stages = groupStages([J(1, 'a', 'lint', 'success'), J(2, 'b', 'oxlint', 'failed'), J(3, 'b', 'tsc', 'failed')]);
  assert.equal(failedJob(stages).name, 'oxlint');
});

test('a job that is not a job is dropped', () => {
  assert.equal(normaliseJob(null), null);
  assert.equal(normaliseJob({ id: 'x', name: 'n' }), null);
  assert.equal(normaliseJob({ id: 1 }), null);
});

// -- merge requests and projects --------------------------------------------

const MR = (projectId, iid, updated, extra) => normaliseMergeRequest(rawMr(projectId, iid, updated, extra), BASE);

test('projects are ordered by their most recently touched merge request, and so are the requests in each', () => {
  const requests = [
    MR(10, 1, iso(10)), MR(10, 2, iso(14)), MR(20, 3, iso(13)),
  ];
  const groups = groupByProject(requests, {});
  assert.deepEqual(groups.map((group) => group.name), ['Vision', 'Portals Builder']);
  assert.deepEqual(groups[0].mergeRequests.map((request) => request.iid), [2, 1], '14:00 then 10:00');
});

test('the project is the heading, the namespace only secondary, and no group is named in the code', () => {
  const [group] = groupByProject([MR(30, 5, iso(9))], { 30: { name: 'Vite Admin', path: 'apps/vite-admin', webUrl: `${BASE}/apps/vite-admin` } });
  assert.equal(group.name, 'Vite Admin');
  assert.equal(group.namespace, 'apps');
  assert.equal(group.webUrl, `${BASE}/apps/vite-admin`);
  // Before the project has been asked for, the path in the reference says enough.
  const [bare] = groupByProject([MR(20, 5, iso(9))], {});
  assert.equal(bare.name, 'Portals Builder');
  assert.equal(bare.namespace, 'dating');
});

test('several groups appear together, whatever they are called', () => {
  const groups = groupByProject([MR(10, 1, iso(9)), MR(30, 2, iso(10))], {});
  assert.deepEqual(groups.map((group) => group.namespace), ['apps', 'dating']);
});

test('a draft is recognised however GitLab says it, and its title loses the prefix', () => {
  assert.equal(MR(10, 1, iso(1), { draft: true }).draft, true);
  assert.equal(MR(10, 1, iso(1), { work_in_progress: true }).draft, true);
  const titled = MR(10, 1, iso(1), { title: 'Draft: Fix the thing' });
  assert.equal(titled.draft, true);
  assert.equal(titled.title, 'Fix the thing');
  assert.equal(MR(10, 1, iso(1), { title: 'Drafting rules' }).draft, false);
});

test('names are made readable from a path', () => {
  assert.equal(prettyName('portals-builder'), 'Portals Builder');
  assert.equal(prettyName('vite_admin'), 'Vite Admin');
  assert.equal(prettyName(''), '');
});

test('a link is only ever one of the instance\'s own https pages', () => {
  assert.equal(ownUrl(`${BASE}/a/b`, BASE), `${BASE}/a/b`);
  for (const bad of ['javascript:alert(1)', 'http://gitlab.example.com/x', 'https://evil.example/x', 'data:text/html,x', '', null, 42]) {
    assert.equal(ownUrl(bad, BASE), null, String(bad));
  }
});

// -- which pipeline the bar shows ------------------------------------------

const P = (id, status, created, mrId = 1) => ({ id, status, createdAt: created, updatedAt: created, mergeRequestId: mrId, projectId: 10 });
const lookup = (map) => (request) => map[request.id] ?? [];

test('the bar shows the newest pipeline that is going', () => {
  const requests = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const entries = allPipelines(requests, lookup({
    1: [P(1, 'success', iso(9), 1)],
    2: [P(2, 'running', iso(10), 2)],
    3: [P(3, 'running', iso(11), 3)],
  }));
  assert.equal(pickHeadline(entries).pipeline.id, 3);
});

test('with none going, the bar shows the newest that finished', () => {
  const entries = allPipelines([{ id: 1 }, { id: 2 }], lookup({
    1: [P(1, 'failed', iso(9), 1)],
    2: [P(2, 'success', iso(11), 2)],
  }));
  assert.equal(pickHeadline(entries).pipeline.id, 2);
  assert.equal(pickHeadline([]), null);
});

test('a pipeline waiting for a person is not "going"', () => {
  const entries = allPipelines([{ id: 1 }, { id: 2 }], lookup({
    1: [P(1, 'manual', iso(12), 1)],
    2: [P(2, 'running', iso(8), 2)],
  }));
  assert.equal(pickHeadline(entries).pipeline.id, 2, 'the manual one is newer, and still not what is going');
});

test('the latest pipelines are the newest of each branch: the last three branches worked on', () => {
  const requests = [
    { id: 1, projectId: 10, sourceBranch: 'feature/a' },
    { id: 2, projectId: 10, sourceBranch: 'feature/b' },
    { id: 3, projectId: 10, sourceBranch: 'feature/c' },
    { id: 4, projectId: 10, sourceBranch: 'feature/d' },
  ];
  const entries = allPipelines(requests, lookup({
    // Pushed to four times, the last three of them newer than anything else.
    1: [P(14, 'running', iso(13), 1), P(13, 'failed', iso(12), 1), P(12, 'failed', iso(11), 1), P(11, 'failed', iso(2), 1)],
    2: [P(20, 'success', iso(12, 30), 2)],
    3: [P(30, 'success', iso(1), 3)],
    4: [P(40, 'failed', iso(5), 4)],
  }));
  assert.deepEqual(latest(entries).map((entry) => entry.pipeline.id), [14, 20, 40],
    'one for each of the three newest branches, and the newest of each');
  assert.deepEqual(latest(entries, 2).map((entry) => entry.pipeline.id), [14, 20]);
  assert.equal(headOf([P(1, 'success', iso(1)), P(2, 'running', iso(3)), P(3, 'failed', iso(2))]).id, 2);
});

test('a branch is a project\'s source branch: two requests from one are one, the same name elsewhere is another', () => {
  const requests = [
    { id: 1, projectId: 10, sourceBranch: 'fix/x' },
    { id: 2, projectId: 10, sourceBranch: 'fix/x' },
    { id: 3, projectId: 20, sourceBranch: 'fix/x' },
    { id: 4, projectId: 10, sourceBranch: '' },
    { id: 5, projectId: 10, sourceBranch: '' },
  ];
  const entries = allPipelines(requests, lookup({
    1: [P(1, 'success', iso(9), 1)], 2: [P(2, 'success', iso(8), 2)], 3: [P(3, 'success', iso(7), 3)],
    4: [P(4, 'success', iso(6), 4)], 5: [P(5, 'success', iso(5), 5)],
  }));
  assert.deepEqual(latest(entries, 10).map((entry) => entry.pipeline.id), [1, 3, 4, 5],
    'a request with no branch is its own');
});

// -- the bar shrinking -------------------------------------------------------

test('what the bar gives up first is the branch, then the stage, and what it keeps longest is the icon', () => {
  const levels = levelsFor({ failed: false });
  assert.deepEqual(levels[0], ['icon', 'project', 'mr', 'branch', 'note', 'progress', 'dots']);
  // What each step takes away, in order.
  const taken = levels.slice(1).map((level, i) => levels[i].find((part) => !level.includes(part)));
  assert.deepEqual(taken, ['branch', 'note', 'dots', 'project', 'mr', 'progress']);
  assert.deepEqual(levels.at(-1), ['icon']);
  for (const level of levels) assert.equal(level[0], 'icon');
  // Each step removes something; none adds.
  levels.slice(1).forEach((level, i) => assert.ok(level.every((part) => levels[i].includes(part))));
});

test('when something failed, what failed outlives the project and the merge request', () => {
  const levels = levelsFor({ failed: true });
  const lastWithNote = levels.findLastIndex((level) => level.includes('note'));
  const lastWithProject = levels.findLastIndex((level) => level.includes('project'));
  assert.ok(lastWithNote > lastWithProject);
});

test('the richest level that fits is chosen, and a bar that fits nothing still shows its icon', () => {
  const levels = levelsFor({ failed: false });
  assert.deepEqual(chooseLevel(levels, () => true), levels[0]);
  assert.deepEqual(chooseLevel(levels, (level) => level.length <= 3), ['icon', 'mr', 'progress']);
  assert.ok(chooseLevel(levels, (level) => !level.includes('branch')).includes('note'), 'the branch goes before the stage'); 
  assert.deepEqual(chooseLevel(levels, () => false), ['icon']);
});

// -- when to ask -------------------------------------------------------------

const BEAT = { now: 10_000_000, lastFull: 10_000_000, lastPulse: 10_000_000, anyActive: false, backlog: false,
  viewOpen: false, failures: 0, lastFailure: 0, signedIn: true };

test('nothing is asked for when signed out, or just after asking', () => {
  assert.equal(due({ ...BEAT, signedIn: false, now: BEAT.now + 1e9 }), null);
  assert.equal(due(BEAT), null);
});

test('a pipeline that is going is looked at often, the whole list less often, the view open quicker', () => {
  const active = { ...BEAT, anyActive: true };
  assert.equal(due({ ...active, now: BEAT.now + 29_000 }), null);
  assert.equal(due({ ...active, now: BEAT.now + 31_000 }), 'pulse');
  assert.equal(due({ ...active, viewOpen: true, now: BEAT.now + 11_000 }), 'pulse');
  assert.equal(due({ ...active, now: BEAT.now + 121_000 }), 'full');
  assert.equal(due({ ...BEAT, now: BEAT.now + 4 * 60_000 }), null, 'nothing is going: five minutes between full refreshes');
  assert.equal(due({ ...BEAT, now: BEAT.now + 5 * 60_000 + 1 }), 'full');
  assert.equal(due({ ...BEAT, viewOpen: true, now: BEAT.now + 2 * 60_000 + 1 }), 'full');
});

test('a backlog of jobs is worked through a little at a time', () => {
  assert.equal(due({ ...BEAT, backlog: true, now: BEAT.now + 2_000 }), null);
  assert.equal(due({ ...BEAT, backlog: true, now: BEAT.now + 6_000 }), 'pulse');
});

test('after a failure it waits longer each time, to a ceiling, and then tries again', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map(backoff), [30e3, 60e3, 120e3, 240e3, 480e3, 900e3, 900e3, 900e3]);
  const failed = { ...BEAT, anyActive: true, failures: 2, lastFailure: BEAT.now, lastFull: 0 };
  assert.equal(due({ ...failed, now: BEAT.now + 59_000 }), null);
  assert.equal(due({ ...failed, now: BEAT.now + 61_000 }), 'full');
});

test('a settled pipeline is asked about again only when something changed, or after a while', () => {
  const request = { sha: 'a', updatedAt: iso(1) };
  const known = { active: false, sha: 'a', mrUpdatedAt: iso(1), checkedAt: NOW };
  assert.equal(pipelinesDue({ known, mr: request, now: NOW + 1000 }), false);
  assert.equal(pipelinesDue({ known, mr: { ...request, sha: 'b' }, now: NOW + 1000 }), true, 'somebody pushed');
  assert.equal(pipelinesDue({ known, mr: { ...request, updatedAt: iso(2) }, now: NOW + 1000 }), true);
  assert.equal(pipelinesDue({ known, mr: request, now: NOW + SETTLED_RECHECK_MS }), true);
  assert.equal(pipelinesDue({ known: { ...known, active: true }, mr: request, now: NOW + 1 }), true);
  assert.equal(pipelinesDue({ known, mr: request, now: NOW + 1, force: true }), true, 'a person pressed refresh');
  assert.equal(pipelinesDue({ known: undefined, mr: request, now: NOW }), true);
});

// -- what is kept ------------------------------------------------------------

function filled(count = 3) {
  const mergeRequests = Array.from({ length: count }, (_, i) => MR(10, i + 1, iso(i)));
  const state = { server: BASE, user: { id: 7 }, fetchedAt: NOW, mergeRequests, projects: { 10: { id: 10, name: 'Vision' } },
    pipelines: {}, jobs: {} };
  for (const request of mergeRequests) {
    state.pipelines[request.id] = { list: [P(request.id * 10, 'success', iso(request.iid)), P(request.id * 10 + 1, 'failed', iso(0)),
      P(request.id * 10 + 2, 'failed', iso(0)), P(request.id * 10 + 3, 'failed', iso(0))], active: false, sha: '', mrUpdatedAt: '', checkedAt: NOW, error: 'timeout' };
    state.jobs[request.id * 10] = { key: 'k', jobs: [{ id: 1, name: 'n', stage: 's', status: 'success' }] };
  }
  return state;
}

test('what is kept comes back for the same account on the same server, within a day', () => {
  const state = filled();
  const kept = restore(JSON.parse(JSON.stringify(snapshotOf(state, NOW))), { server: BASE, userId: 7, now: NOW + 3600_000 });
  assert.equal(kept.mergeRequests.length, 3);
  assert.equal(kept.fetchedAt, NOW);
  assert.equal(Object.keys(kept.jobs).length, 3);
});

test('it is refused for another account, another server, a stale date, or anything malformed', () => {
  const snapshot = JSON.parse(JSON.stringify(snapshotOf(filled(), NOW)));
  const ask = (overrides, change = {}) => restore({ ...snapshot, ...change }, { server: BASE, userId: 7, now: NOW + 1000, ...overrides });
  assert.ok(ask({}));
  assert.equal(ask({ userId: 8 }), null);
  assert.equal(ask({ server: 'https://other.example.com' }), null);
  assert.equal(ask({ now: NOW + TTL_MS + 1 }), null);
  assert.equal(ask({}, { savedAt: NOW + 3_600_000 }), null, 'dated in the future');
  assert.equal(ask({}, { version: 99 }), null);
  assert.equal(ask({}, { mergeRequests: 'nope' }), null);
  assert.equal(ask({ userId: null }), null);
  for (const junk of [null, undefined, 'x', 42, []]) assert.equal(restore(junk, { server: BASE, userId: 7, now: NOW }), null);
});

test('what is kept is bounded, and clears the errors of the last round', () => {
  const state = filled(LIMITS.mergeRequests + 20);
  const snapshot = snapshotOf(state, NOW);
  assert.equal(snapshot.mergeRequests.length, LIMITS.mergeRequests);
  assert.ok(Object.values(snapshot.pipelines).every((entry) => entry.list.length <= LIMITS.pipelinesPerMr && entry.error === null));
  assert.ok(Object.keys(snapshot.jobs).length <= LIMITS.hydrated);
});

test('what is kept has no token in it, because there is none to keep', () => {
  assert.ok(!/token|secret|credential|authorization/i.test(JSON.stringify(snapshotOf(filled(), NOW))));
});

test('what is read back from the disk is cleaned as if it came from the network', () => {
  const snapshot = JSON.parse(JSON.stringify(snapshotOf(filled(), NOW)));
  const [first] = snapshot.mergeRequests;
  first.webUrl = 'javascript:alert(1)';
  snapshot.mergeRequests[1].webUrl = 'https://evil.example/x';
  snapshot.mergeRequests.push({ id: 'x' }, null, 'text');
  snapshot.mergeRequests[2].extra = 'not a field of ours';
  const entry = Object.values(snapshot.pipelines)[0];
  entry.list[0].webUrl = 'data:text/html,x';
  entry.list.push({ nope: true });
  const withJobs = Object.keys(snapshot.jobs)[0];
  snapshot.jobs[withJobs].jobs[0].webUrl = 'javascript:1';
  snapshot.jobs.broken = { key: 'k' };
  snapshot.jobs.alsoBroken = 'text';
  snapshot.pipelines.broken = { list: 'nope' };
  snapshot.projects[10].webUrl = 'http://gitlab.example.com/plain';

  const kept = restore(snapshot, { server: BASE, userId: 7, now: NOW + 1000 });
  assert.equal(kept.mergeRequests.length, 3, 'what is not a merge request is dropped');
  assert.equal(kept.mergeRequests[0].webUrl, null, 'no javascript: link');
  assert.equal(kept.mergeRequests[1].webUrl, null, 'no other site');
  assert.ok(kept.mergeRequests[2].webUrl.startsWith(BASE), 'the instance\'s own pages stay');
  assert.ok(!('extra' in kept.mergeRequests[2]), 'only the fields a screen draws');
  assert.equal(Object.values(kept.pipelines)[0].list[0].webUrl, null);
  assert.ok(Object.values(kept.pipelines)[0].list.every((pipeline) => Number.isFinite(pipeline.id)));
  assert.equal(kept.pipelines.broken.list.length, 0, 'a shape the screens would throw on is made an empty one');
  assert.equal(kept.jobs[withJobs].jobs[0].webUrl, null);
  assert.ok(!('broken' in kept.jobs) && !('alsoBroken' in kept.jobs), 'a jobs entry with no jobs is dropped');
  assert.equal(kept.projects[10].webUrl, null);
});
