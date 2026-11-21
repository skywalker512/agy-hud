/**
 * Read-only, mtime-cached discovery and parsing of native Antigravity Swarm state
 * under `<appDataDir>/brain/<coordinator_conv_id>/.system_generated/swarm/`.
 */
import { closeSync, openSync, readdirSync, readFileSync, readSync } from 'node:fs';
import { join } from 'node:path';
import { clipText, parseIsoMs, statSafe, UUID_RE } from './constants.ts';
import type { AppDataRoot } from './constants.ts';

export type SwarmMemberState = 'working' | 'waiting' | 'stopped' | 'killed';

export interface SwarmMemberMeta {
  rosterName: string;
  swarmRole: 'coordinator' | 'worker';
  swarmState: SwarmMemberState;
  taskTitle?: string;
  threadId?: string;
  threadTitle?: string;
  model?: string;
  workspaceMode?: 'inherit' | 'share' | 'branch' | string;
  lastReadSeq?: number;
  lastPostSeq?: number;
  lastPostSnippet?: string;
  lastPostTime?: string;
}

export interface SwarmThreadMeta {
  id: string;
  title: string;
  goal?: string;
  members: string[];
}

export interface SwarmOverview {
  swarmId: string;
  coordinatorConvId: string;
  swarmTitle: string;
  goalTitle?: string;
  goalLine?: string;
  createdAt?: string;
  boardSeq: number;
  memberCount: number;
  workingCount: number;
  waitingCount: number;
  stoppedCount: number;
  killedCount: number;
  isCoordinatorView: boolean;
  selfMember?: SwarmMemberMeta | null;
  threads?: SwarmThreadMeta[];
}

export interface RawSwarmMember {
  conversation_id?: string;
  role?: string;
  desired_state?: string;
  phase?: string;
  wake_mode?: string;
  wait_since?: number;
  last_read_seq?: number;
  killed?: boolean;
  model?: string;
  applied_model?: string;
  desired_model?: string;
  workspace_mode?: string;
}

export interface ParsedSwarmMemberRecord {
  rosterName: string;
  conversationId: string;
  role: 'coordinator' | 'worker';
  state: SwarmMemberState;
  meta: SwarmMemberMeta;
}

export interface ParsedSwarmRecord {
  swarmId: string;
  coordinatorConvId: string;
  swarmDir: string;
  sig: string;
  swarmTitle: string;
  goalTitle?: string;
  goalLine?: string;
  createdAt?: string;
  boardSeq: number;
  members: Map<string, ParsedSwarmMemberRecord>;
  memberByConvId: Map<string, ParsedSwarmMemberRecord>;
  threads: SwarmThreadMeta[];
  memberCount: number;
  workingCount: number;
  waitingCount: number;
  stoppedCount: number;
  killedCount: number;
}

export interface SwarmMemberLookup {
  coordinatorConvId: string;
  rosterName: string;
  swarm: ParsedSwarmRecord;
  member: ParsedSwarmMemberRecord;
}

export interface SwarmIndex {
  swarmsByCoordinator: Map<string, ParsedSwarmRecord>;
  memberLookup: Map<string, SwarmMemberLookup>;
  sig: string;
}

interface BoardPostSummary {
  seq: number;
  snippet: string;
  time?: string;
}

interface ParsedBoardMeta {
  boardSeq: number;
  lastPostByAgent: Map<string, BoardPostSummary>;
  briefByAgent: Map<string, string>;
}

const BOARD_TAIL_BYTES = 65_536;
const BOARD_HEAD_BYTES = 32_768;

const swarmRecordCache = new Map<string, { sig: string; record: ParsedSwarmRecord | null }>();
const brainDirEntriesCache = new Map<string, { mtimeMs: number; convIds: string[] }>();

let cacheHits = 0;
let cacheMisses = 0;

export function getSwarmCacheStats() {
  return { hits: cacheHits, misses: cacheMisses, entries: swarmRecordCache.size };
}

export function clearSwarmCache() {
  swarmRecordCache.clear();
  brainDirEntriesCache.clear();
  cacheHits = 0;
  cacheMisses = 0;
}

export function deriveSwarmMemberState(m: RawSwarmMember | null | undefined): SwarmMemberState {
  if (!m || typeof m !== 'object') return 'stopped';
  const phase = String(m.phase || '').toUpperCase();
  const desired = String(m.desired_state || '').toUpperCase();
  if (m.killed || phase === 'KILLED' || desired === 'KILLED') {
    return 'killed';
  }
  if (phase === 'STOPPED' || (phase !== 'RUNNING' && desired !== 'RUNNING')) {
    return 'stopped';
  }
  if (String(m.wake_mode || '').toLowerCase() === 'working') {
    return 'working';
  }
  return 'waiting';
}

function safeReadJson(filePath: string): any | null {
  try {
    const text = readFileSync(filePath, 'utf8');
    if (!text.trim()) return null;
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function cleanSwarmTextLine(raw: unknown, maxLen = 140): string {
  if (typeof raw !== 'string' || !raw.trim()) return '';
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  return clipText(collapsed, maxLen);
}

export function extractBriefSummary(rawText: string, expectedRoster?: string): string {
  if (typeof rawText !== 'string' || !rawText.trim()) return '';
  let text = rawText.trim();
  // Strip leading @mentions (e.g. "@swarm-telemetry You own ...")
  if (expectedRoster) {
    const escaped = expectedRoster.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(`^@${escaped}(?:\\s+|[:,;-]\\s*)`, 'i'), '');
  }
  text = text.replace(/^(?:@[a-z0-9][a-z0-9_-]*\s+)+/i, '');

  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line) continue;
    if (/^[-*_]{3,}$/.test(line)) continue;
    if (/^<\/?[A-Z_]+>$/.test(line)) continue;
    line = line
      .replace(/^#+\s+/, '')
      .replace(/^[-*•>]\s+/, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
    if (line) {
      return clipText(line, 140);
    }
  }
  return '';
}

function readBoundedRange(filePath: string, offset: number, length: number): string {
  if (length <= 0) return '';
  let fd: number | null = null;
  try {
    fd = openSync(filePath, 'r');
    const buf = Buffer.allocUnsafe(length);
    const bytesRead = readSync(fd, buf, 0, length, offset);
    return buf.subarray(0, bytesRead).toString('utf8');
  } catch {
    return '';
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        /* ignore close error */
      }
    }
  }
}

function parseBoardLines(
  raw: string,
  dropLeadingPartial: boolean,
  dropTrailingPartial: boolean,
  acc: ParsedBoardMeta,
  recordLastPost: boolean,
) {
  if (!raw) return;
  let chunk = raw;
  if (dropLeadingPartial) {
    const firstNl = chunk.indexOf('\n');
    if (firstNl < 0) return;
    chunk = chunk.slice(firstNl + 1);
  }
  if (dropTrailingPartial) {
    const lastNl = chunk.lastIndexOf('\n');
    if (lastNl >= 0) {
      chunk = chunk.slice(0, lastNl);
    }
  }

  for (const rawLine of chunk.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line[0] !== '{') continue;
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!entry || typeof entry !== 'object') continue;
    const seq = Number(entry.seq);
    const validSeq = Number.isFinite(seq) && seq >= 0 ? seq : 0;
    if (validSeq > acc.boardSeq) {
      acc.boardSeq = validSeq;
    }

    const agent = typeof entry.agent === 'string' ? entry.agent.trim() : '';
    const text = typeof entry.text === 'string' ? entry.text : '';
    const time = typeof entry.time === 'string' ? entry.time.trim() : undefined;
    const kind = typeof entry.kind === 'string' ? entry.kind.trim().toLowerCase() : '';

    if (recordLastPost && agent && text.trim()) {
      const prev = acc.lastPostByAgent.get(agent);
      if (!prev || validSeq >= prev.seq) {
        acc.lastPostByAgent.set(agent, {
          seq: validSeq,
          snippet: cleanSwarmTextLine(text, 120),
          ...(time ? { time } : {}),
        });
      }
    }

    // Extract brief fallback for mentioned worker when kind === 'brief' (or coordinator initial assignment)
    if (text && (kind === 'brief' || agent === 'coordinator')) {
      const m = /^@([a-z0-9][a-z0-9_-]*)\b/i.exec(text.trim());
      if (m) {
        const targetRoster = m[1];
        if (targetRoster !== 'all' && targetRoster !== 'coordinator') {
          const summary = extractBriefSummary(text, targetRoster);
          if (summary && (kind === 'brief' || !acc.briefByAgent.has(targetRoster))) {
            acc.briefByAgent.set(targetRoster, summary);
          }
        }
      }
    }
  }
}

export function parseBoardJsonl(boardPath: string, fileSize: number, needHeadBriefFallback = false): ParsedBoardMeta {
  const acc: ParsedBoardMeta = {
    boardSeq: 0,
    lastPostByAgent: new Map(),
    briefByAgent: new Map(),
  };
  if (fileSize <= 0) return acc;

  if (fileSize <= BOARD_TAIL_BYTES) {
    try {
      const full = readFileSync(boardPath, 'utf8');
      parseBoardLines(full, false, false, acc, true);
    } catch {
      /* ignore read errors */
    }
    return acc;
  }

  // Bounded tail read (~64KB) for large board.jsonl files
  const tailOffset = Math.max(0, fileSize - BOARD_TAIL_BYTES);
  const tailText = readBoundedRange(boardPath, tailOffset, BOARD_TAIL_BYTES);
  parseBoardLines(tailText, true, false, acc, true);

  // If plan.json is absent/incomplete and briefs scrolled past the 64KB tail, scan bounded 32KB head for briefs only
  if (needHeadBriefFallback) {
    const headLen = Math.min(BOARD_HEAD_BYTES, tailOffset);
    if (headLen > 0) {
      const headText = readBoundedRange(boardPath, 0, headLen);
      parseBoardLines(headText, false, true, acc, false);
    }
  }

  return acc;
}

export function parseSwarmDirectory(swarmDir: string, fallbackConvId = ''): ParsedSwarmRecord | null {
  const swarmJsonPath = join(swarmDir, 'swarm.json');
  const membersJsonPath = join(swarmDir, 'members.json');
  const planJsonPath = join(swarmDir, 'plan.json');
  const boardJsonlPath = join(swarmDir, 'board.jsonl');

  const sSwarm = statSafe(swarmJsonPath);
  const sMembers = statSafe(membersJsonPath);
  if (sSwarm.size === 0 && sMembers.size === 0) {
    swarmRecordCache.delete(swarmDir);
    return null;
  }

  const sPlan = statSafe(planJsonPath);
  const sBoard = statSafe(boardJsonlPath);
  const sig = `${sSwarm.mtimeMs}:${sSwarm.size}|${sMembers.mtimeMs}:${sMembers.size}|${sPlan.mtimeMs}:${sPlan.size}|${sBoard.mtimeMs}:${sBoard.size}`;

  const cached = swarmRecordCache.get(swarmDir);
  if (cached && cached.sig === sig) {
    cacheHits += 1;
    return cached.record;
  }
  cacheMisses += 1;

  const swarmJson = sSwarm.size > 0 ? safeReadJson(swarmJsonPath) : null;
  const membersJson = sMembers.size > 0 ? safeReadJson(membersJsonPath) : null;
  if (!swarmJson && !membersJson) {
    swarmRecordCache.set(swarmDir, { sig, record: null });
    return null;
  }

  const planJson = sPlan.size > 0 ? safeReadJson(planJsonPath) : null;
  const rawMembers: Record<string, RawSwarmMember> =
    membersJson?.members && typeof membersJson.members === 'object' && !Array.isArray(membersJson.members)
      ? membersJson.members
      : {};
  const planTasks: Record<string, string> =
    planJson?.tasks && typeof planJson.tasks === 'object' && !Array.isArray(planJson.tasks)
      ? planJson.tasks
      : {};

  const memberNames = Object.keys(rawMembers);
  const missingPlanTasks = memberNames.some(
    (name) => name !== 'coordinator' && rawMembers[name]?.role !== 'coordinator' && !planTasks[name],
  );
  const boardMeta = parseBoardJsonl(boardJsonlPath, sBoard.size, missingPlanTasks);

  // Resolve coordinator conversation id
  const explicitCoordEntry = Object.entries(rawMembers).find(
    ([name, m]) => m && (m.role === 'coordinator' || name === 'coordinator') && typeof m.conversation_id === 'string' && UUID_RE.test(m.conversation_id),
  );
  const swarmId = typeof swarmJson?.swarm_id === 'string' && UUID_RE.test(swarmJson.swarm_id)
    ? swarmJson.swarm_id
    : (explicitCoordEntry?.[1]?.conversation_id || fallbackConvId);
  const coordinatorConvId = explicitCoordEntry?.[1]?.conversation_id || swarmId || fallbackConvId;
  if (!coordinatorConvId) {
    swarmRecordCache.set(swarmDir, { sig, record: null });
    return null;
  }

  // Parse plan threads & map rosterName -> thread
  const threads: SwarmThreadMeta[] = [];
  const threadByMember = new Map<string, { id: string; title: string }>();
  if (Array.isArray(planJson?.threads)) {
    for (const rawThread of planJson.threads) {
      if (!rawThread || typeof rawThread !== 'object') continue;
      const id = typeof rawThread.id === 'string' ? rawThread.id.trim() : '';
      const title = cleanSwarmTextLine(rawThread.title, 100);
      if (!id || !title) continue;
      const rawList = Array.isArray(rawThread.tasks)
        ? rawThread.tasks
        : (Array.isArray(rawThread.members) ? rawThread.members : []);
      const members = rawList
        .map((x: unknown) => (typeof x === 'string' ? x.trim() : ''))
        .filter(Boolean);
      const goal = cleanSwarmTextLine(rawThread.goal, 160) || undefined;
      threads.push({ id, title, ...(goal ? { goal } : {}), members });
      for (const mName of members) {
        if (!threadByMember.has(mName)) {
          threadByMember.set(mName, { id, title });
        }
      }
    }
  }

  const members = new Map<string, ParsedSwarmMemberRecord>();
  const memberByConvId = new Map<string, ParsedSwarmMemberRecord>();
  let memberCount = 0;
  let workingCount = 0;
  let waitingCount = 0;
  let stoppedCount = 0;
  let killedCount = 0;

  for (const [rosterName, raw] of Object.entries(rawMembers)) {
    if (!rosterName || !raw || typeof raw !== 'object') continue;
    const convId = typeof raw.conversation_id === 'string' ? raw.conversation_id.trim() : '';
    const isCoord = raw.role === 'coordinator' || rosterName === 'coordinator' || (Boolean(convId) && convId === coordinatorConvId);
    const role: 'coordinator' | 'worker' = isCoord ? 'coordinator' : 'worker';
    const state = deriveSwarmMemberState(raw);
    const planTask = cleanSwarmTextLine(planTasks[rosterName], 160);
    const briefTask = boardMeta.briefByAgent.get(rosterName) || '';
    const taskTitle = planTask || briefTask || undefined;
    const thread = threadByMember.get(rosterName);
    const model = (typeof raw.applied_model === 'string' && raw.applied_model.trim())
      || (typeof raw.model === 'string' && raw.model.trim())
      || (typeof raw.desired_model === 'string' && raw.desired_model.trim())
      || undefined;
    const workspaceMode = typeof raw.workspace_mode === 'string' && raw.workspace_mode.trim()
      ? raw.workspace_mode.trim()
      : undefined;
    const lastReadSeq = typeof raw.last_read_seq === 'number' && Number.isFinite(raw.last_read_seq)
      ? raw.last_read_seq
      : undefined;
    const lastPost = boardMeta.lastPostByAgent.get(rosterName);

    const meta: SwarmMemberMeta = {
      rosterName,
      swarmRole: role,
      swarmState: state,
      ...(taskTitle ? { taskTitle } : {}),
      ...(thread ? { threadId: thread.id, threadTitle: thread.title } : {}),
      ...(model ? { model } : {}),
      ...(workspaceMode ? { workspaceMode } : {}),
      ...(lastReadSeq !== undefined ? { lastReadSeq } : {}),
      ...(lastPost ? {
        lastPostSeq: lastPost.seq,
        ...(lastPost.snippet ? { lastPostSnippet: lastPost.snippet } : {}),
        ...(lastPost.time ? { lastPostTime: lastPost.time } : {}),
      } : {}),
    };

    const rec: ParsedSwarmMemberRecord = {
      rosterName,
      conversationId: convId,
      role,
      state,
      meta,
    };
    members.set(rosterName, rec);
    if (convId && UUID_RE.test(convId)) {
      memberByConvId.set(convId, rec);
    }

    if (role === 'worker') {
      memberCount += 1;
      if (state === 'working') workingCount += 1;
      else if (state === 'waiting') waitingCount += 1;
      else if (state === 'stopped') stoppedCount += 1;
      else if (state === 'killed') killedCount += 1;
    }
  }

  const goalTitle = cleanSwarmTextLine(planJson?.goal?.title, 120) || undefined;
  const goalLine = cleanSwarmTextLine(planJson?.goal?.line, 180) || undefined;
  const swarmTitle = cleanSwarmTextLine(membersJson?.title, 120) || goalTitle || `Swarm ${swarmId.slice(0, 8)}`;
  const createdAt = typeof swarmJson?.created_at === 'string' && swarmJson.created_at.trim()
    ? swarmJson.created_at.trim()
    : undefined;

  const record: ParsedSwarmRecord = {
    swarmId,
    coordinatorConvId,
    swarmDir,
    sig,
    swarmTitle,
    ...(goalTitle ? { goalTitle } : {}),
    ...(goalLine ? { goalLine } : {}),
    ...(createdAt ? { createdAt } : {}),
    boardSeq: boardMeta.boardSeq,
    members,
    memberByConvId,
    threads,
    memberCount,
    workingCount,
    waitingCount,
    stoppedCount,
    killedCount,
  };

  swarmRecordCache.set(swarmDir, { sig, record });
  return record;
}

function listBrainConvIdsCached(brainDir: string): string[] {
  const dirStat = statSafe(brainDir);
  if (dirStat.mtimeMs === 0) {
    brainDirEntriesCache.delete(brainDir);
    return [];
  }
  const cached = brainDirEntriesCache.get(brainDir);
  if (cached && cached.mtimeMs === dirStat.mtimeMs) {
    return cached.convIds;
  }
  let entries: string[];
  try {
    entries = readdirSync(brainDir);
  } catch {
    return [];
  }
  const convIds = entries.filter((name) => UUID_RE.test(name));
  brainDirEntriesCache.set(brainDir, { mtimeMs: dirStat.mtimeMs, convIds });
  return convIds;
}

export function loadSwarmIndex(
  appDataRoots: (string | AppDataRoot)[],
  candidateConvIds: Iterable<string> = [],
): SwarmIndex {
  const swarmsByCoordinator = new Map<string, ParsedSwarmRecord>();
  const memberLookup = new Map<string, SwarmMemberLookup>();
  const seenAppDirs = new Set<string>();
  const extraIds = new Set<string>();
  for (const id of candidateConvIds) {
    if (typeof id === 'string' && UUID_RE.test(id)) extraIds.add(id);
  }

  for (const root of appDataRoots || []) {
    const appDataDir = typeof root === 'string' ? root : root?.appDataDir;
    if (!appDataDir || seenAppDirs.has(appDataDir)) continue;
    seenAppDirs.add(appDataDir);

    const brainDir = join(appDataDir, 'brain');
    const brainIds = listBrainConvIdsCached(brainDir);
    if (!brainIds.length && !extraIds.size) continue;

    const toCheck = new Set<string>(brainIds);
    for (const id of extraIds) toCheck.add(id);

    for (const convId of toCheck) {
      const swarmDir = join(brainDir, convId, '.system_generated', 'swarm');
      // Single fast stat on the swarm directory before checking individual JSON files
      const dirStat = statSafe(swarmDir);
      if (dirStat.mtimeMs === 0) {
        swarmRecordCache.delete(swarmDir);
        continue;
      }
      const parsed = parseSwarmDirectory(swarmDir, convId);
      if (!parsed) continue;

      const existing = swarmsByCoordinator.get(parsed.coordinatorConvId);
      if (
        !existing
        || parsed.boardSeq > existing.boardSeq
        || parseIsoMs(parsed.createdAt) >= parseIsoMs(existing.createdAt)
      ) {
        swarmsByCoordinator.set(parsed.coordinatorConvId, parsed);
      }
    }
  }

  // Build reverse-lookup index (workerConvId -> { coordinatorConvId, rosterName, swarm, member })
  for (const swarm of swarmsByCoordinator.values()) {
    for (const member of swarm.members.values()) {
      if (!member.conversationId || !UUID_RE.test(member.conversationId)) continue;
      if (member.conversationId === swarm.coordinatorConvId) continue;
      memberLookup.set(member.conversationId, {
        coordinatorConvId: swarm.coordinatorConvId,
        rosterName: member.rosterName,
        swarm,
        member,
      });
    }
  }

  const sigParts: string[] = [];
  for (const coordId of [...swarmsByCoordinator.keys()].sort()) {
    const sw = swarmsByCoordinator.get(coordId)!;
    sigParts.push(`${coordId}=${sw.sig}`);
  }

  return {
    swarmsByCoordinator,
    memberLookup,
    sig: sigParts.join(';'),
  };
}

export function buildSwarmOverview(
  swarm: ParsedSwarmRecord,
  isCoordinatorView: boolean,
  selfMember?: SwarmMemberMeta | null,
): SwarmOverview {
  const coordMember = swarm.members.get('coordinator') || swarm.memberByConvId.get(swarm.coordinatorConvId) || null;
  const resolvedSelf = selfMember ?? (isCoordinatorView ? (coordMember?.meta || null) : null);

  return {
    swarmId: swarm.swarmId,
    coordinatorConvId: swarm.coordinatorConvId,
    swarmTitle: swarm.swarmTitle,
    ...(swarm.goalTitle ? { goalTitle: swarm.goalTitle } : {}),
    ...(swarm.goalLine ? { goalLine: swarm.goalLine } : {}),
    ...(swarm.createdAt ? { createdAt: swarm.createdAt } : {}),
    boardSeq: swarm.boardSeq,
    memberCount: swarm.memberCount,
    workingCount: swarm.workingCount,
    waitingCount: swarm.waitingCount,
    stoppedCount: swarm.stoppedCount,
    killedCount: swarm.killedCount,
    isCoordinatorView,
    ...(resolvedSelf ? { selfMember: resolvedSelf } : {}),
    ...(swarm.threads.length > 0 ? { threads: swarm.threads } : {}),
  };
}
