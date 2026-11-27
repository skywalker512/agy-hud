import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildInspectReport,
  configureCliStatusline,
  formatInspectMarkdown,
  inspectCliStatusline,
  parseStatuslineStdin,
  readFastConversationSnapshot,
  removeCliStatusline,
  renderStatusline,
  shortenModelLabel,
  stripAnsi,
  visibleLength,
  type CliStatuslinePayload,
} from '../lib/statusline-core.ts';
import {
  buildContextTreeBlob,
  buildGenMetadataBlob,
  buildStepMetadata,
  createSchema,
} from './helpers/fixtures.ts';

const __filename = fileURLToPath(import.meta.url);
const HUD_PANEL_DIR = resolve(dirname(__filename), '..');
const STATUSLINE_CLI = join(HUD_PANEL_DIR, 'statusline.ts');
const SKILL_INSPECT_CLI = resolve(HUD_PANEL_DIR, '..', '..', 'skills', 'agy-hud', 'scripts', 'inspect.mjs');

function createSyntheticConversationDb(appDataDir: string, convId: string, nowSec: number): string {
  const convDir = join(appDataDir, 'conversations');
  mkdirSync(convDir, { recursive: true });
  const dbPath = join(convDir, `${convId}.db`);
  const db = createSchema(dbPath);

  const ctxTree = buildContextTreeBlob([
    { name: 'System Prompt', items: [{ name: 'core', tokens: 6_000 }] },
    { name: 'Tools', items: [{ name: 'run_command', tokens: 4_000 }, { name: 'read_file', tokens: 3_000 }] },
    {
      name: 'Chat Messages',
      items: [
        { name: 'CORTEX_STEP_TYPE_GENERIC', tokens: 27_000 },
        { name: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE', tokens: 12_000 },
        { name: 'CORTEX_STEP_TYPE_USER_INPUT', tokens: 3_000 },
      ],
    },
  ]);

  const gm1 = buildGenMetadataBlob({
    modelId: 'gemini-4-neon',
    modelDisplay: 'Gemini 4 Neon (High)',
    modelEnum: 1532,
    cached: 30_000,
    newIn: 5_000,
    output: 400,
    thinking: 120,
    candidate: 280,
    reportedCtx: 35_000,
    ctxLimit: 512_000,
    ttftSec: 1.5,
    genSec: 3.2,
  });

  const gm2 = buildGenMetadataBlob({
    modelId: 'gemini-4-neon',
    modelDisplay: 'Gemini 4 Neon (High)',
    modelEnum: 1532,
    cached: 48_000,
    newIn: 7_000,
    output: 500,
    thinking: 150,
    candidate: 350,
    reportedCtx: 55_000,
    ctxLimit: 512_000,
    ttftSec: 1.2,
    genSec: 4.0,
    contextTree: ctxTree,
  });

  db.prepare('INSERT INTO gen_metadata (idx, data) VALUES (?, ?)').run(0, gm1);
  db.prepare('INSERT INTO gen_metadata (idx, data) VALUES (?, ?)').run(1, gm2);

  const meta1 = buildStepMetadata({
    createdSec: nowSec - 90,
    streamStartSec: nowSec - 88,
    completedSec: nowSec - 85,
    modelEnum: 1532,
    gmIdx: 0,
  });
  const meta2 = buildStepMetadata({
    createdSec: nowSec - 20,
    streamStartSec: nowSec - 19,
    completedSec: nowSec - 15,
    modelEnum: 1532,
    gmIdx: 1,
  });

  db.prepare('INSERT INTO steps (idx, step_type, status, metadata, step_payload) VALUES (?, ?, ?, ?, ?)').run(
    0,
    15,
    3,
    meta1,
    Buffer.alloc(0),
  );
  db.prepare('INSERT INTO steps (idx, step_type, status, metadata, step_payload) VALUES (?, ?, ?, ?, ?)').run(
    1,
    15,
    3,
    meta2,
    Buffer.alloc(0),
  );

  db.close();
  return dbPath;
}

test('parseStatuslineStdin handles valid, empty, and malformed inputs safely', () => {
  assert.equal(parseStatuslineStdin(''), null);
  assert.equal(parseStatuslineStdin('not-json'), null);
  assert.equal(parseStatuslineStdin('[1,2,3]'), null);

  const parsed = parseStatuslineStdin(
    JSON.stringify({
      conversation_id: '12345678-abcd-ef01-2345-6789abcdef01',
      model: { display_name: 'Gemini 4 Neon (High)', effort: 'high' },
      context_window: { used_percentage: 42.5, context_window_size: 512000 },
      terminal_width: 112,
    }),
  );
  assert.ok(parsed);
  assert.equal(parsed.conversation_id, '12345678-abcd-ef01-2345-6789abcdef01');
  assert.equal(parsed.terminal_width, 112);
});

test('shortenModelLabel preserves full name on wide terminals and compacts cleanly for narrow width', () => {
  assert.equal(shortenModelLabel('Gemini 4 Neon (High)', false), 'Gemini 4 Neon (High)');
  assert.equal(shortenModelLabel('Gemini 4 Neon (High)', true), 'G4 Neon·H');
  assert.equal(shortenModelLabel('Claude Opus 5.5 (Max)', true), 'C Opus 5.5·Max');
});

test('renderStatusline adapts across narrow, standard, wide, no-color, and two-line layouts without overflowing width', () => {
  const payload: CliStatuslinePayload = {
    conversation_id: '12345678-abcd-ef01-2345-6789abcdef01',
    cwd: '/tmp/my-repo',
    model: { display_name: 'Gemini 4 Neon (High)' },
    context_window: {
      used_percentage: 44.2,
      context_window_size: 512_000,
    },
    quota: {
      'gemini-5h': { remaining_fraction: 0.78, reset_in_seconds: 5400 },
      'gemini-weekly': { remaining_fraction: 0.92, reset_in_seconds: 300000 },
    },
    agent_state: 'working',
    vcs: { type: 'git' },
    cycle_mode: 'plan',
    sandbox: { enabled: true },
    subagents: [{ name: 'worker-1', status: 'running' }],
    task_count: 1,
    cost: { total_usd: 0.42 },
  };

  const dbSnap = {
    conversationId: '12345678-abcd-ef01-2345-6789abcdef01',
    dbPath: '/tmp/conv.db',
    source: 'cli',
    modelDisplay: 'Gemini 4 Neon (High)',
    modelId: 'gemini-4-neon',
    genTps: 125,
    e2eTps: 98,
    avgGenTps: 118,
    ttftSec: 1.2,
    isBuffered: false,
    cacheHitPct: 87.3,
    contextUsed: 226_000,
    contextLimit: 512_000,
    contextPct: 44.2,
    headroomTurns: 14,
    costUSD: 0.42,
    savedUSD: 0.91,
    callCount: 6,
    compactCount: 0,
    latestCallMs: Date.now() - 30_000,
    cacheSurvivalProb: 0.94,
    cacheP80RemSec: 540,
    cacheMissPenaltyUSD: 0.35,
  };

  // Narrow (64 cols)
  const narrow = renderStatusline({ payload, dbSnap, width: 64, color: false });
  assert.ok(visibleLength(narrow) <= 64, `narrow line exceeded 64 cols: "${narrow}"`);
  assert.match(narrow, /G4 Neon·H/);
  assert.match(narrow, /44%/);

  // Standard (105 cols) with ANSI colors
  const std = renderStatusline({ payload, dbSnap, width: 105, color: true });
  assert.ok(std.includes('\x1b['), 'expected ANSI color sequences');
  assert.ok(visibleLength(std) <= 105, `std line exceeded 105 cols: "${stripAnsi(std)}"`);
  const stdPlain = stripAnsi(std);
  assert.match(stdPlain, /Gemini 4 Neon \(High\)/);
  assert.match(stdPlain, /125 t\/s/);
  assert.match(stdPlain, /1\.2s/);
  assert.match(stdPlain, /5h 78%/);

  // Wide (160 cols) includes cache TTL, cost, chips, git dir
  const wide = renderStatusline({ payload, dbSnap, width: 160, color: false });
  assert.ok(visibleLength(wide) <= 160);
  assert.match(wide, /C 87% · TTL ~94%/);
  assert.match(wide, /\$0\.42/);
  assert.match(wide, /sub:1/);
  assert.match(wide, /git:my-repo/);

  // Two-line layout
  const two = renderStatusline({ payload, dbSnap, width: 100, color: false, twoLine: true });
  const lines = two.split('\n');
  assert.equal(lines.length, 2);
  assert.ok(visibleLength(lines[0]) <= 100);
  assert.ok(visibleLength(lines[1]) <= 100);
  assert.match(lines[1], /TTL ~94%/);
});

test('readFastConversationSnapshot and buildInspectReport enrich from real SQLite DB and format Markdown/JSON', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agy-hud-statusline-db-'));
  try {
    const appDataDir = join(root, '.gemini', 'antigravity');
    const convId = '11111111-2222-3333-4444-555555555555';
    const nowSec = Math.floor(Date.now() / 1000);
    createSyntheticConversationDb(appDataDir, convId, nowSec);

    const fast = readFastConversationSnapshot({
      conversationId: convId,
      appDataDir,
      nowMs: nowSec * 1000,
    });
    assert.ok(fast);
    assert.equal(fast.conversationId, convId);
    assert.equal(fast.modelDisplay, 'Gemini 4 Neon (High)');
    assert.ok(fast.genTps !== null && fast.genTps > 100);
    assert.equal(fast.ttftSec, 1.2);
    assert.ok(fast.cacheHitPct !== null && fast.cacheHitPct > 80);
    assert.ok(fast.headroomTurns !== null && fast.headroomTurns > 10);
    assert.ok(fast.cacheSurvivalProb !== null && fast.cacheSurvivalProb > 0.9);

    const report = await buildInspectReport({
      appDataDir,
      conversationId: convId,
      callsLimit: 5,
      includeLiveQuota: false,
      nowMs: nowSec * 1000,
    });
    assert.equal(report.found, true);
    assert.equal(report.conversationId, convId);
    assert.equal(report.session.calls, 2);
    assert.equal(report.recentCalls.length, 2);
    assert.ok(report.context.breakdown);
    assert.equal(report.context.breakdown.toolResults, 27_000);
    assert.equal(report.context.breakdown.topTools[0].name, 'run_command');
    assert.ok(report.cache.ttl);

    const md = formatInspectMarkdown(report);
    assert.match(md, /AGY-HUD Telemetry Snapshot/);
    assert.match(md, /Gemini 4 Neon \(High\)/);
    assert.match(md, /run_command/);
    assert.match(md, /Recent Calls/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('buildInspectReport extracts live quota windows, per-call quota5hPct, and Swarm overview accurately', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agy-hud-statusline-quota-swarm-'));
  try {
    const appDataDir = join(root, '.gemini', 'antigravity');
    const coordId = '22222222-3333-4444-8555-666666666666';
    const worker1Id = '22222222-3333-4444-8555-777777777777';
    const worker2Id = '22222222-3333-4444-8555-888888888888';
    const nowSec = Math.floor(Date.now() / 1000);
    const nowMs = nowSec * 1000;

    createSyntheticConversationDb(appDataDir, coordId, nowSec);
    createSyntheticConversationDb(appDataDir, worker1Id, nowSec);

    // Create native AGY Swarm metadata on disk
    const swarmDir = join(appDataDir, 'brain', coordId, '.system_generated', 'swarm');
    mkdirSync(swarmDir, { recursive: true });
    writeFileSync(
      join(swarmDir, 'swarm.json'),
      JSON.stringify({ swarm_id: coordId, title: 'Release QA Swarm' }),
      'utf8',
    );
    writeFileSync(
      join(swarmDir, 'members.json'),
      JSON.stringify({
        title: 'Release QA Swarm',
        members: {
          coordinator: {
            role: 'coordinator',
            conversation_id: coordId,
            phase: 'RUNNING',
            desired_state: 'RUNNING',
            wake_mode: 'mentions',
            killed: false,
          },
          reviewer: {
            role: 'worker',
            conversation_id: worker1Id,
            phase: 'RUNNING',
            desired_state: 'RUNNING',
            wake_mode: 'working',
            killed: false,
          },
          tester: {
            role: 'worker',
            conversation_id: worker2Id,
            phase: 'RUNNING',
            desired_state: 'RUNNING',
            wake_mode: 'mentions',
            killed: false,
          },
        },
      }),
      'utf8',
    );

    const reset5h = nowMs + 3 * 3_600_000;
    const reset7d = nowMs + 5 * 86_400_000;
    const rawQuotaOverride = {
      available: true,
      planName: 'Pro',
      tierName: 'Pro',
      teamsTier: 'PRO',
      fetchedAtMs: nowMs,
      pools: [
        {
          label: 'Gemini',
          remainingPct: 12,
          resetAtMs: reset5h,
          windows: [
            { spanKey: '5h', label: '5h', remainingPct: 12, resetTime: '', resetAtMs: reset5h },
            { spanKey: '7d', label: '7d', remainingPct: 68, resetTime: '', resetAtMs: reset7d },
          ],
        },
      ],
    };

    const report = await buildInspectReport({
      appDataDir,
      conversationId: coordId,
      callsLimit: 5,
      rawQuotaOverride,
      nowMs,
    });

    assert.equal(report.found, true);
    assert.equal(report.account.quotaAvailable, true);
    assert.equal(report.account.pools.length, 1);
    assert.equal(report.account.pools[0].label, 'Gemini');
    assert.equal(report.account.pools[0].remainingPct5h, 12);
    assert.equal(report.account.pools[0].usedPct5h, 88);
    assert.equal(report.account.pools[0].reset5hMs, reset5h);
    assert.equal(report.account.pools[0].remainingPct7d, 68);
    assert.equal(report.account.pools[0].usedPct7d, 32);
    assert.ok(report.hints.some((h) => h.includes('5h quota is low (12% remaining)')));

    assert.ok(report.session.swarm, 'expected swarm summary');
    assert.equal(report.session.swarm.title, 'Release QA Swarm');
    assert.equal(report.session.swarm.memberCount, 2);
    assert.equal(report.session.swarm.workingCount, 1);
    assert.equal(report.session.swarm.waitingCount, 1);
    assert.ok(
      typeof report.recentCalls[0]?.quota5hPct === 'number' && report.recentCalls[0].quota5hPct > 0,
      'expected per-call quota5hPct to be populated from quotaPct5h',
    );

    const md = formatInspectMarkdown(report);
    assert.match(md, /\*\*Quota \[Gemini\]\*\*: 5h 12% left · 7d 68% left/);
    assert.match(md, /Release QA Swarm · 2 workers \(1 working, 1 waiting\)/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('configureCliStatusline and removeCliStatusline preserve unrelated settings, enforce 0600, and protect foreign commands', () => {
  const root = mkdtempSync(join(tmpdir(), 'agy-hud-settings-'));
  try {
    const fakeHome = join(root, 'home');
    const settingsPath = join(fakeHome, '.gemini', 'antigravity-cli', 'settings.json');
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(
      settingsPath,
      JSON.stringify({ colorScheme: 'tokyo night', notifications: true }, null, 2),
      'utf8',
    );

    const scriptPath = join(
      fakeHome,
      '.gemini',
      'config',
      'plugins',
      'agy-hud',
      'sidecars',
      'hud_panel',
      'statusline.ts',
    );

    const cfg = configureCliStatusline({
      settingsPath,
      scriptPath,
      homeDir: fakeHome,
      twoLine: true,
      stackWithDefault: true,
    });
    assert.equal(cfg.ok, true);
    assert.equal(cfg.action, 'configured');

    const saved = JSON.parse(readFileSync(settingsPath, 'utf8'));
    assert.equal(saved.colorScheme, 'tokyo night');
    assert.equal(saved.notifications, true);
    assert.equal(saved.statusLine.type, 'command');
    assert.equal(saved.statusLine.enabled, true);
    assert.equal(saved.statusLine.stack_with_default, true);
    assert.match(saved.statusLine.command, /statusline\.ts/);
    assert.match(saved.statusLine.command, /--two-line/);

    if (process.platform !== 'win32') {
      const mode = statSync(settingsPath).mode & 0o777;
      assert.equal(mode, 0o600);
    }

    const inspected = inspectCliStatusline({ settingsPath, homeDir: fakeHome });
    assert.equal(inspected.configured, true);
    assert.equal(inspected.isAgyHud, true);
    assert.equal(inspected.enabled, true);

    const removed = removeCliStatusline({ settingsPath, homeDir: fakeHome });
    assert.equal(removed.ok, true);
    assert.equal(removed.action, 'removed');
    const afterRemove = JSON.parse(readFileSync(settingsPath, 'utf8'));
    assert.equal(afterRemove.statusLine, undefined);
    assert.equal(afterRemove.colorScheme, 'tokyo night');

    // Foreign statusLine is protected unless --force
    afterRemove.statusLine = { type: 'command', command: '~/.gemini/antigravity-cli/custom.sh' };
    writeFileSync(settingsPath, JSON.stringify(afterRemove, null, 2), 'utf8');

    const blocked = removeCliStatusline({ settingsPath, homeDir: fakeHome, force: false });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.action, 'blocked');

    const forced = removeCliStatusline({ settingsPath, homeDir: fakeHome, force: true });
    assert.equal(forced.ok, true);
    assert.equal(forced.action, 'removed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('statusline.ts and skill scripts/inspect.mjs run end-to-end as CLI subprocesses', () => {
  const root = mkdtempSync(join(tmpdir(), 'agy-hud-cli-subproc-'));
  try {
    const appDataDir = join(root, '.gemini', 'antigravity');
    const convId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    createSyntheticConversationDb(appDataDir, convId, Math.floor(Date.now() / 1000));

    // 1. Pipe official stdin payload into statusline.ts
    const stdinPayload = JSON.stringify({
      conversation_id: convId,
      model: { display_name: 'Gemini 4 Neon (High)' },
      context_window: { used_percentage: 10.7, context_window_size: 512_000 },
      quota: { 'gemini-5h': { remaining_fraction: 0.85, reset_in_seconds: 3600 } },
      agent_state: 'idle',
      terminal_width: 120,
    });
    const slOut = execFileSync(
      process.execPath,
      [STATUSLINE_CLI, '--no-color', '--data-dir', appDataDir],
      { input: stdinPayload, encoding: 'utf8' },
    ).trim();
    assert.match(slOut, /Gemini 4 Neon \(High\)/);
    assert.match(slOut, /125 t\/s/);
    assert.match(slOut, /5h 85%/);

    // 2. Run skill wrapper scripts/inspect.mjs --inspect --json
    assert.equal(existsSync(SKILL_INSPECT_CLI), true);
    const inspRaw = execFileSync(
      process.execPath,
      [SKILL_INSPECT_CLI, '--inspect', '--json', '--data-dir', appDataDir, '--conversation', convId],
      { encoding: 'utf8' },
    );
    const insp = JSON.parse(inspRaw);
    assert.equal(insp.found, true);
    assert.equal(insp.conversationId, convId);
    assert.equal(insp.session.calls, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
