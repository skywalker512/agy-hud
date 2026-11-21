import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  cleanFallbackPromptTitle,
  getConversationSwarmMeta,
} from '../lib/graph.ts';
import {
  clearSwarmCache,
  deriveSwarmMemberState,
  extractBriefSummary,
  getSwarmCacheStats,
  loadSwarmIndex,
  parseBoardJsonl,
  parseSwarmDirectory,
} from '../lib/swarm.ts';
import {
  buildSessionInfo,
  getConversationGraph,
  listConversations,
} from '../server.ts';
import {
  bField,
  buildGenMetadataBlob,
  buildPlannerStepPayload,
  buildStepMetadata,
  createSchema,
} from './helpers/fixtures.ts';

function createConvDb(dbPath: string, {
  calls = 1,
  output = 250,
  promptText = '',
  parentId = '',
  tsSec = Math.floor(Date.now() / 1000) - 60,
}: {
  calls?: number;
  output?: number;
  promptText?: string;
  parentId?: string;
  tsSec?: number;
} = {}) {
  const db = createSchema(dbPath);
  const insGm = db.prepare('INSERT INTO gen_metadata (idx, data) VALUES (?, ?)');
  const insStep = db.prepare('INSERT INTO steps (idx, step_type, status, metadata, step_payload) VALUES (?, ?, ?, ?, ?)');
  let stepIdx = 0;
  if (promptText) {
    // step_type 14 = USER_INPUT; field 19 -> field 2 = text
    const userPayload = bField(19, bField(2, promptText));
    insStep.run(stepIdx++, 14, 3, buildStepMetadata({ createdSec: tsSec - 5, completedSec: tsSec - 5 }), userPayload);
  }
  for (let i = 0; i < calls; i++) {
    insGm.run(i, buildGenMetadataBlob({ newIn: 20_000, cached: 40_000, output }));
    insStep.run(
      stepIdx++,
      15,
      3,
      buildStepMetadata({ createdSec: tsSec + i * 5, streamStartSec: tsSec + i * 5 + 1, completedSec: tsSec + i * 5 + 3, gmIdx: i }),
      buildPlannerStepPayload({ reply: `reply ${i}` }),
    );
  }
  if (parentId) {
    db.prepare('INSERT INTO parent_references (idx, data) VALUES (?, ?)').run(0, bField(6, parentId));
  }
  db.close();
}

test('deriveSwarmMemberState handles working, waiting, stopped, killed, and malformed inputs', () => {
  assert.equal(deriveSwarmMemberState({ phase: 'RUNNING', desired_state: 'RUNNING', wake_mode: 'working', killed: false }), 'working');
  assert.equal(deriveSwarmMemberState({ phase: 'RUNNING', desired_state: 'RUNNING', wake_mode: 'mentions', killed: false }), 'waiting');
  assert.equal(deriveSwarmMemberState({ phase: 'RUNNING', desired_state: 'RUNNING', wake_mode: 'all', killed: false }), 'waiting');
  assert.equal(deriveSwarmMemberState({ phase: 'RUNNING', desired_state: 'RUNNING', killed: false }), 'waiting');
  assert.equal(deriveSwarmMemberState({ phase: 'STOPPED', desired_state: 'RUNNING', wake_mode: 'working', killed: false }), 'stopped');
  assert.equal(deriveSwarmMemberState({ phase: 'PAUSED', desired_state: 'PAUSED', wake_mode: 'working', killed: false }), 'stopped');
  assert.equal(deriveSwarmMemberState({ phase: 'RUNNING', desired_state: 'RUNNING', wake_mode: 'working', killed: true }), 'killed');
  assert.equal(deriveSwarmMemberState({ phase: 'KILLED', desired_state: 'KILLED', wake_mode: 'working', killed: false }), 'killed');
  assert.equal(deriveSwarmMemberState({ phase: 'RUNNING', desired_state: 'KILLED', wake_mode: 'mentions', killed: false }), 'killed');
  assert.equal(deriveSwarmMemberState(null), 'stopped');
  assert.equal(deriveSwarmMemberState(undefined), 'stopped');
});

test('coordinator view enriches sessionInfo.swarm, childSessions (including 0-call newly spawned workers), and dropdown badges', () => {
  const root = mkdtempSync(join(tmpdir(), 'agy-hud-swarm-coord-'));
  clearSwarmCache();
  try {
    const appDir = join(root, 'antigravity');
    const convDir = join(appDir, 'conversations');
    const coordId = '4e85af51-1ab3-4850-997b-e3408f268015';
    const workerActiveId = '9720b80c-13b7-4fc6-8cef-ea8498f9b4cb';
    const workerWaitingId = '9e13c13c-ca32-41e9-98c4-7c28d7c5ecd2';
    const workerNewSpawnId = '7e567111-5ec8-4c1f-a018-0c2e4095cdea'; // no SQLite DB created yet!
    const workerKilledId = '14a02e57-5482-45bf-b86f-2c580c8b3eba';
    const swarmDir = join(appDir, 'brain', coordId, '.system_generated', 'swarm');

    mkdirSync(convDir, { recursive: true });
    mkdirSync(swarmDir, { recursive: true });

    createConvDb(join(convDir, `${coordId}.db`), { calls: 4, output: 400 });
    createConvDb(join(convDir, `${workerActiveId}.db`), { calls: 3, output: 900, parentId: coordId });
    createConvDb(join(convDir, `${workerWaitingId}.db`), { calls: 2, output: 300 }); // no parent_references!
    createConvDb(join(convDir, `${workerKilledId}.db`), { calls: 1, output: 200, parentId: coordId });

    writeFileSync(join(swarmDir, 'swarm.json'), JSON.stringify({
      version: 1,
      backend: 'local',
      swarm_id: coordId,
      created_at: '2026-11-21T15:21:04Z',
    }));
    writeFileSync(join(swarmDir, 'members.json'), JSON.stringify({
      title: 'AGY-HUD Commercial Upgrade',
      members: {
        coordinator: {
          conversation_id: coordId,
          role: 'coordinator',
          desired_state: 'RUNNING',
          phase: 'RUNNING',
          wake_mode: 'mentions',
          last_read_seq: 17,
          killed: false,
          applied_model: 'gemini-4-neon-high',
          workspace_mode: 'inherit',
        },
        'swarm-telemetry': {
          conversation_id: workerActiveId,
          role: 'worker',
          desired_state: 'RUNNING',
          phase: 'RUNNING',
          wake_mode: 'working',
          last_read_seq: 16,
          killed: false,
          applied_model: 'gemini-4-neon-high',
          workspace_mode: 'share',
        },
        inspector: {
          conversation_id: workerWaitingId,
          role: 'worker',
          desired_state: 'RUNNING',
          phase: 'RUNNING',
          wake_mode: 'mentions',
          last_read_seq: 17,
          killed: false,
          model: 'gemini-4-carbon-high',
          workspace_mode: 'inherit',
        },
        'trend-viz': {
          conversation_id: workerNewSpawnId,
          role: 'worker',
          desired_state: 'RUNNING',
          phase: 'RUNNING',
          wake_mode: 'working',
          last_read_seq: 14,
          killed: false,
          desired_model: 'gemini-4-neon-high',
          workspace_mode: 'branch',
        },
        researcher: {
          conversation_id: workerKilledId,
          role: 'worker',
          desired_state: 'KILLED',
          phase: 'KILLED',
          wake_mode: 'working',
          last_read_seq: 10,
          killed: true,
          applied_model: 'gemini-4-neon-high',
          workspace_mode: 'inherit',
        },
      },
    }));
    writeFileSync(join(swarmDir, 'plan.json'), JSON.stringify({
      goal: {
        title: 'Upgrade AGY-HUD to Commercial-Grade Release',
        line: 'Ship Swarm Cockpit, Brush/Zoom Trends, and Call Inspector.',
      },
      tasks: {
        'swarm-telemetry': 'Native AGY Swarm metadata parser and Swarm Cockpit UI',
        inspector: 'Audit Wave 2 diffs, boundaries, tests, and commercial polish',
        'trend-viz': 'Full-history TrendChartCard with minimap brush and drag-to-zoom',
      },
      threads: [
        { id: 't-swarm', title: 'Native AGY Swarm Cockpit', goal: 'Surface roster & states', tasks: ['swarm-telemetry'] },
        { id: 't-trend', title: 'Historical Time-Series', tasks: ['trend-viz'] },
        { id: 't-qa', title: 'Global Quality Inspection', tasks: ['inspector'] },
      ],
    }));
    writeFileSync(join(swarmDir, 'board.jsonl'), [
      JSON.stringify({ seq: 1, agent: 'coordinator', text: '@researcher You own **Competitive & UX Research** for AGY-HUD.\nMore details here.', time: '2026-11-21 23:21:06', kind: 'brief' }),
      JSON.stringify({ seq: 8, agent: 'researcher', text: '@coordinator [done] Spec written to research_spec.md', time: '2026-11-21 23:30:07' }),
      JSON.stringify({ seq: 15, agent: 'inspector', text: '@coordinator Wave 1 approved, watching Wave 2.', time: '2026-11-21 23:41:00' }),
      JSON.stringify({ seq: 17, agent: 'swarm-telemetry', text: 'Implementing lib/swarm.ts and Swarm Cockpit UI.', time: '2026-11-21 23:42:09' }),
    ].join('\n') + '\n');

    const convs = listConversations([{ appDataDir: appDir, conversationsDir: convDir, annotationsDir: '', source: 'app' }], '', 0);
    const graph = getConversationGraph(convs, { requiredConvId: coordId, syncAll: true, appDataRoots: [appDir] });
    const session = buildSessionInfo(coordId, graph);

    assert.ok(session.swarm, 'sessionInfo.swarm should be populated for coordinator');
    assert.equal(session.swarm.isCoordinatorView, true);
    assert.equal(session.swarm.swarmId, coordId);
    assert.equal(session.swarm.coordinatorConvId, coordId);
    assert.equal(session.swarm.swarmTitle, 'AGY-HUD Commercial Upgrade');
    assert.equal(session.swarm.goalTitle, 'Upgrade AGY-HUD to Commercial-Grade Release');
    assert.equal(session.swarm.goalLine, 'Ship Swarm Cockpit, Brush/Zoom Trends, and Call Inspector.');
    assert.equal(session.swarm.boardSeq, 17);
    assert.equal(session.swarm.memberCount, 4);
    assert.equal(session.swarm.workingCount, 2);
    assert.equal(session.swarm.waitingCount, 1);
    assert.equal(session.swarm.stoppedCount, 0);
    assert.equal(session.swarm.killedCount, 1);
    assert.equal(session.swarm.selfMember?.rosterName, 'coordinator');
    assert.equal(session.swarm.threads?.length, 3);

    // All 4 workers should appear in childSessions — including trend-viz with 0 SQLite calls!
    assert.equal(session.childSessions.length, 4);
    const byRoster = new Map<string, any>(session.childSessions.map((c: any) => [c.swarm?.rosterName || '', c]));

    const swTel = byRoster.get('swarm-telemetry');
    assert.ok(swTel);
    assert.equal(swTel.calls, 3);
    assert.equal(swTel.swarm.swarmState, 'working');
    assert.equal(swTel.swarm.workspaceMode, 'share');
    assert.equal(swTel.swarm.model, 'gemini-4-neon-high');
    assert.equal(swTel.swarm.threadId, 't-swarm');
    assert.equal(swTel.swarm.threadTitle, 'Native AGY Swarm Cockpit');
    assert.equal(swTel.swarm.taskTitle, 'Native AGY Swarm metadata parser and Swarm Cockpit UI');
    assert.equal(swTel.swarm.lastReadSeq, 16);
    assert.equal(swTel.swarm.lastPostSeq, 17);
    assert.equal(swTel.swarm.lastPostSnippet, 'Implementing lib/swarm.ts and Swarm Cockpit UI.');
    assert.equal(swTel.swarm.lastPostTime, '2026-11-21 23:42:09');

    const trendChild = byRoster.get('trend-viz');
    assert.ok(trendChild, 'newly spawned worker without DB yet must appear gracefully');
    assert.equal(trendChild.id, workerNewSpawnId);
    assert.equal(trendChild.calls, 0);
    assert.equal(trendChild.outputTokens, 0);
    assert.equal(trendChild.swarm.swarmState, 'working');
    assert.equal(trendChild.swarm.workspaceMode, 'branch');
    assert.equal(trendChild.swarm.model, 'gemini-4-neon-high');

    // Researcher had no plan.json task -> fell back to first clean line of board.jsonl brief!
    const resChild = byRoster.get('researcher');
    assert.ok(resChild);
    assert.equal(resChild.swarm.swarmState, 'killed');
    assert.equal(resChild.swarm.taskTitle, 'You own Competitive & UX Research for AGY-HUD.');
    assert.equal(resChild.swarm.lastPostSeq, 8);

    // Dropdown metadata helper
    assert.deepEqual(getConversationSwarmMeta(coordId, graph), { swarmRosterName: 'coordinator', swarmState: 'waiting' });
    assert.deepEqual(getConversationSwarmMeta(workerActiveId, graph), { swarmRosterName: 'swarm-telemetry', swarmState: 'working' });
    assert.deepEqual(getConversationSwarmMeta(workerWaitingId, graph), { swarmRosterName: 'inspector', swarmState: 'waiting' });
    assert.deepEqual(getConversationSwarmMeta(workerKilledId, graph), { swarmRosterName: 'researcher', swarmState: 'killed' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('worker reverse-lookup populates sessionInfo.swarm and parentSession even when SQLite parent_references is absent', () => {
  const root = mkdtempSync(join(tmpdir(), 'agy-hud-swarm-worker-'));
  clearSwarmCache();
  try {
    const appDir = join(root, 'antigravity');
    const convDir = join(appDir, 'conversations');
    const coordId = 'aaaaaaaa-1111-2222-3333-444444444444';
    const workerId = 'bbbbbbbb-1111-2222-3333-444444444444';
    const swarmDir = join(appDir, 'brain', coordId, '.system_generated', 'swarm');
    mkdirSync(convDir, { recursive: true });
    mkdirSync(swarmDir, { recursive: true });

    // Worker DB intentionally has NO parent_references table rows, and coordinator DB is not even present yet!
    createConvDb(join(convDir, `${workerId}.db`), { calls: 2, output: 500 });

    writeFileSync(join(swarmDir, 'swarm.json'), JSON.stringify({
      version: 1,
      swarm_id: coordId,
      created_at: '2026-11-21T16:00:00Z',
    }));
    writeFileSync(join(swarmDir, 'members.json'), JSON.stringify({
      title: 'Reverse Lookup Swarm',
      members: {
        coordinator: { conversation_id: coordId, role: 'coordinator', phase: 'RUNNING', desired_state: 'RUNNING', wake_mode: 'mentions', killed: false },
        'worker-alpha': { conversation_id: workerId, role: 'worker', phase: 'RUNNING', desired_state: 'RUNNING', wake_mode: 'working', killed: false, workspace_mode: 'share', applied_model: 'gemini-4-carbon-high', last_read_seq: 5 },
      },
    }));
    writeFileSync(join(swarmDir, 'board.jsonl'), JSON.stringify({
      seq: 5,
      agent: 'coordinator',
      kind: 'brief',
      text: '@worker-alpha Build reverse lookup and worker breadcrumb UI.',
      time: '2026-11-21 16:01:00',
    }) + '\n');

    const convs = listConversations([{ appDataDir: appDir, conversationsDir: convDir, annotationsDir: '', source: 'app' }], '', 0);
    const graph = getConversationGraph(convs, { requiredConvId: workerId, syncAll: true, appDataRoots: [appDir] });
    const session = buildSessionInfo(workerId, graph);

    assert.equal(session.kind, 'subagent');
    assert.ok(session.parentSession, 'parentSession must be linked to coordinator via reverse-lookup');
    assert.equal(session.parentSession.id, coordId);
    assert.equal(session.parentSession.title, 'Reverse Lookup Swarm');
    assert.ok(session.swarm);
    assert.equal(session.swarm.isCoordinatorView, false);
    assert.equal(session.swarm.coordinatorConvId, coordId);
    assert.equal(session.swarm.swarmTitle, 'Reverse Lookup Swarm');
    assert.equal(session.swarm.boardSeq, 5);
    assert.equal(session.swarm.selfMember?.rosterName, 'worker-alpha');
    assert.equal(session.swarm.selfMember?.swarmState, 'working');
    assert.equal(session.swarm.selfMember?.taskTitle, 'Build reverse lookup and worker breadcrumb UI.');
    assert.equal(session.swarm.selfMember?.workspaceMode, 'share');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('mtime+size caching avoids re-parsing on steady-state polls and invalidates immediately on file update', () => {
  const root = mkdtempSync(join(tmpdir(), 'agy-hud-swarm-cache-'));
  clearSwarmCache();
  try {
    const appDir = join(root, 'antigravity');
    const coordId = 'cccccccc-1111-2222-3333-444444444444';
    const workerId = 'dddddddd-1111-2222-3333-444444444444';
    const swarmDir = join(appDir, 'brain', coordId, '.system_generated', 'swarm');
    mkdirSync(swarmDir, { recursive: true });

    const membersPath = join(swarmDir, 'members.json');
    const boardPath = join(swarmDir, 'board.jsonl');
    writeFileSync(join(swarmDir, 'swarm.json'), JSON.stringify({ version: 1, swarm_id: coordId }));
    writeFileSync(membersPath, JSON.stringify({
      title: 'Cache Test Swarm',
      members: {
        coordinator: { conversation_id: coordId, role: 'coordinator', phase: 'RUNNING', desired_state: 'RUNNING', wake_mode: 'mentions', killed: false },
        builder: { conversation_id: workerId, role: 'worker', phase: 'RUNNING', desired_state: 'RUNNING', wake_mode: 'working', killed: false },
      },
    }));
    writeFileSync(boardPath, JSON.stringify({ seq: 1, agent: 'coordinator', kind: 'brief', text: '@builder Ship feature' }) + '\n');

    const idx1 = loadSwarmIndex([appDir]);
    const stats1 = getSwarmCacheStats();
    assert.equal(stats1.misses, 1);
    assert.equal(stats1.hits, 0);
    assert.equal(idx1.swarmsByCoordinator.get(coordId)?.workingCount, 1);

    // Second call with unchanged files must hit mtime+size cache
    const idx2 = loadSwarmIndex([appDir]);
    const stats2 = getSwarmCacheStats();
    assert.equal(stats2.misses, 1);
    assert.equal(stats2.hits, 1);
    assert.equal(idx2.sig, idx1.sig);

    // Mutate members.json (working -> waiting) and bump mtime -> cache must invalidate
    writeFileSync(membersPath, JSON.stringify({
      title: 'Cache Test Swarm',
      members: {
        coordinator: { conversation_id: coordId, role: 'coordinator', phase: 'RUNNING', desired_state: 'RUNNING', wake_mode: 'mentions', killed: false },
        builder: { conversation_id: workerId, role: 'worker', phase: 'RUNNING', desired_state: 'RUNNING', wake_mode: 'mentions', killed: false },
      },
    }));
    const futureSec = Math.floor(Date.now() / 1000) + 10;
    utimesSync(membersPath, futureSec, futureSec);

    const idx3 = loadSwarmIndex([appDir]);
    const stats3 = getSwarmCacheStats();
    assert.equal(stats3.misses, 2);
    assert.notEqual(idx3.sig, idx1.sig);
    assert.equal(idx3.swarmsByCoordinator.get(coordId)?.workingCount, 0);
    assert.equal(idx3.swarmsByCoordinator.get(coordId)?.waitingCount, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('bounded tail read handles large (>64KB) board.jsonl and recovers both latest seq and early briefs', () => {
  const root = mkdtempSync(join(tmpdir(), 'agy-hud-swarm-large-board-'));
  try {
    const boardPath = join(root, 'board.jsonl');
    const lines: string[] = [
      JSON.stringify({ seq: 1, agent: 'coordinator', kind: 'brief', text: '@early-worker Build the core parser module.\nDetails follow.' }),
    ];
    const filler = 'x'.repeat(2048);
    for (let seq = 2; seq <= 60; seq++) {
      lines.push(JSON.stringify({ seq, agent: 'chatter', text: `Update #${seq} ${filler}`, time: '2026-11-21 20:00:00' }));
    }
    lines.push(JSON.stringify({ seq: 61, agent: 'early-worker', text: '@coordinator [done] Parser complete.', time: '2026-11-21 20:30:00' }));
    const content = lines.join('\n') + '\n';
    assert.ok(Buffer.byteLength(content, 'utf8') > 90_000, 'test board.jsonl must exceed 64KB tail cap');
    writeFileSync(boardPath, content, 'utf8');

    const meta = parseBoardJsonl(boardPath, Buffer.byteLength(content, 'utf8'), true);
    assert.equal(meta.boardSeq, 61);
    assert.equal(meta.lastPostByAgent.get('early-worker')?.seq, 61);
    assert.equal(meta.lastPostByAgent.get('early-worker')?.snippet, '@coordinator [done] Parser complete.');
    assert.equal(meta.briefByAgent.get('early-worker'), 'Build the core parser module.');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('resilience against malformed JSON, partial board lines, and missing files', () => {
  const root = mkdtempSync(join(tmpdir(), 'agy-hud-swarm-malformed-'));
  clearSwarmCache();
  try {
    const coordId = 'eeeeeeee-1111-2222-3333-444444444444';
    const workerId = 'ffffffff-1111-2222-3333-444444444444';

    // 1. Completely missing directory -> null
    assert.equal(parseSwarmDirectory(join(root, 'nonexistent'), coordId), null);

    // 2. Corrupt swarm.json & members.json -> null (no throw)
    const badDir = join(root, 'bad');
    mkdirSync(badDir, { recursive: true });
    writeFileSync(join(badDir, 'swarm.json'), '{not valid json');
    writeFileSync(join(badDir, 'members.json'), '<<<corrupt>>>');
    assert.equal(parseSwarmDirectory(badDir, coordId), null);

    // 3. Valid members.json without swarm.json, malformed plan.json, and mixed valid/corrupt board.jsonl lines
    const partialDir = join(root, 'partial');
    mkdirSync(partialDir, { recursive: true });
    writeFileSync(join(partialDir, 'members.json'), JSON.stringify({
      title: 'Resilient Swarm',
      members: {
        coordinator: { conversation_id: coordId, role: 'coordinator', phase: 'RUNNING', desired_state: 'RUNNING', wake_mode: 'mentions', killed: false },
        fixer: { conversation_id: workerId, role: 'worker', phase: 'STOPPED', desired_state: 'STOPPED', killed: false },
      },
    }));
    writeFileSync(join(partialDir, 'plan.json'), '{ broken plan json');
    writeFileSync(join(partialDir, 'board.jsonl'), [
      'not json at all',
      '{"seq": 2, "agent": "coordinator", "kind": "brief", "text": "@fixer Fix edge-case crash"}',
      '{"seq": 3, "agent": "fixer", "text": "truncated line without closing brace',
      JSON.stringify({ seq: 4, agent: 'fixer', text: 'Patched cleanly.', time: '2026-11-21 21:00:00' }),
    ].join('\n'));

    const parsed = parseSwarmDirectory(partialDir, coordId);
    assert.ok(parsed);
    assert.equal(parsed.swarmTitle, 'Resilient Swarm');
    assert.equal(parsed.boardSeq, 4);
    assert.equal(parsed.stoppedCount, 1);
    const fixer = parsed.members.get('fixer');
    assert.ok(fixer);
    assert.equal(fixer.state, 'stopped');
    assert.equal(fixer.meta.taskTitle, 'Fix edge-case crash');
    assert.equal(fixer.meta.lastPostSeq, 4);
    assert.equal(fixer.meta.lastPostSnippet, 'Patched cleanly.');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('cleanFallbackPromptTitle and extractBriefSummary strip wrapper tags and markdown cleanly', () => {
  assert.equal(
    cleanFallbackPromptTitle('<SYSTEM_MESSAGE>ignored</SYSTEM_MESSAGE>\n\n## **Audit** `server.ts` routes\nSecond line'),
    'Audit server.ts routes',
  );
  assert.equal(
    extractBriefSummary('@swarm-telemetry You own **Wave 2 Track C**: `Swarm Cockpit`.\nDetails below.', 'swarm-telemetry'),
    'You own Wave 2 Track C: Swarm Cockpit.',
  );

  // Verify non-Swarm subagent fallback title in summarizeConversationDb
  const root = mkdtempSync(join(tmpdir(), 'agy-hud-non-swarm-sub-'));
  try {
    const appDir = join(root, 'antigravity');
    const convDir = join(appDir, 'conversations');
    mkdirSync(convDir, { recursive: true });
    const mainId = '11111111-aaaa-bbbb-cccc-000000000001';
    const subId = '11111111-aaaa-bbbb-cccc-000000000002';
    createConvDb(join(convDir, `${mainId}.db`), { calls: 1, output: 100 });
    createConvDb(join(convDir, `${subId}.db`), {
      calls: 1,
      output: 120,
      parentId: mainId,
      promptText: '<SYSTEM_MESSAGE>meta</SYSTEM_MESSAGE>\n# **Investigate** `quota-fitter.ts` drift warning',
    });

    const convs = listConversations([{ appDataDir: appDir, conversationsDir: convDir, annotationsDir: '', source: 'app' }], '', 0);
    const graph = getConversationGraph(convs, { syncAll: true, appDataRoots: [appDir] });
    const session = buildSessionInfo(mainId, graph);
    assert.equal(session.swarm, undefined);
    assert.equal(session.childSessions.length, 1);
    assert.equal(session.childSessions[0].title, 'Investigate quota-fitter.ts drift warning');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
