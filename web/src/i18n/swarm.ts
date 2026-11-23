import type { Lang, SwarmMemberState } from '../types/telemetry';

export interface SwarmStrings {
  cockpitTitle: string;
  goalPrefix: string;
  boardBadge: (seq: number) => string;
  stateLabel: (state: SwarmMemberState) => string;
  workingPill: (n: number) => string;
  waitingPill: (n: number) => string;
  stoppedPill: (n: number) => string;
  killedPill: (n: number) => string;
  swarmTotalLabel: string;
  swarmTotalMeta: (calls: number, outStr: string, costStr: string) => string;
  viewFlat: string;
  viewThread: string;
  unassignedThread: string;
  memberCallsZero: string;
  memberMeta: (calls: number, outStr: string, costStr: string) => string;
  lastPostTag: (seq: number) => string;
  workspaceLabel: (mode: string) => string;
  workspaceTip: (mode: string) => string;
  pendingConv: string;
  backCoordinator: (swarmTitle: string) => string;
  backCoordinatorTip: (swarmTitle: string, coordId: string, quotaTip?: string) => string;
  coordSwarmPillWorking: (working: number, total: number) => string;
  coordSwarmPillIdle: (total: number) => string;
  coordSwarmPillTip: (
    title: string,
    working: number,
    waiting: number,
    stopped: number,
    killed: number,
    boardSeq: number,
    goal?: string,
  ) => string;
  workerBadgeTip: (
    roster: string,
    state: string,
    task?: string,
    thread?: string,
    workspace?: string,
    model?: string,
  ) => string;
  memberTipThread: (title: string) => string;
  memberTipTask: (task: string) => string;
  memberTipBoard: (readSeq: number | undefined, boardSeq: number, postSeq?: number, postTime?: string) => string;
  memberTipLatest: (snippet: string) => string;
  swarmRoleBadge: string;
  subagentRoleFallback: (role: string, shortId: string) => string;
}

const enSwarm: SwarmStrings = {
  cockpitTitle: 'SWARM COCKPIT',
  goalPrefix: 'Goal',
  boardBadge: (seq) => `Board #${seq}`,
  stateLabel: (state) => {
    if (state === 'working') return 'working';
    if (state === 'waiting') return 'waiting';
    if (state === 'stopped') return 'stopped';
    return 'killed';
  },
  workingPill: (n) => `${n} working`,
  waitingPill: (n) => `${n} waiting`,
  stoppedPill: (n) => `${n} stopped`,
  killedPill: (n) => `${n} killed`,
  swarmTotalLabel: 'Swarm Total',
  swarmTotalMeta: (calls, outStr, costStr) =>
    `${calls} calls · ${outStr} out${costStr ? ` · ${costStr}` : ''}`,
  viewFlat: 'Flat',
  viewThread: 'By Thread',
  unassignedThread: 'Other Members',
  memberCallsZero: '0 calls',
  memberMeta: (calls, outStr, costStr) =>
    `${calls}c · ${outStr} out${costStr ? ` · ${costStr}` : ''}`,
  lastPostTag: (seq) => `post #${seq}`,
  workspaceLabel: (mode) => mode,
  workspaceTip: (mode) => {
    if (mode === 'share') return 'Isolated git worktree (share)';
    if (mode === 'branch') return 'Isolated repo clone (branch)';
    return 'Shared workspace (inherit)';
  },
  pendingConv: 'Starting…',
  backCoordinator: (swarmTitle) => `@coordinator · ${swarmTitle}`,
  backCoordinatorTip: (swarmTitle, coordId, quotaTip) =>
    `Jump to swarm coordinator (${coordId.slice(0, 8)}…)\nSwarm: ${swarmTitle}${quotaTip ? `\n\n${quotaTip}` : ''}`,
  coordSwarmPillWorking: (working, total) => `Swarm · ${working}/${total} working`,
  coordSwarmPillIdle: (total) => `Swarm · ${total} members`,
  coordSwarmPillTip: (title, working, waiting, stopped, killed, boardSeq, goal) => {
    const counts = [
      working > 0 ? `${working} working` : '',
      waiting > 0 ? `${waiting} waiting` : '',
      stopped > 0 ? `${stopped} stopped` : '',
      killed > 0 ? `${killed} killed` : '',
    ].filter(Boolean).join(' · ');
    return `${title}${goal ? `\n${goal}` : ''}\n${counts || '0 members'}${boardSeq > 0 ? ` · Board #${boardSeq}` : ''}\nClick to jump to Swarm Cockpit`;
  },
  workerBadgeTip: (roster, state, task, thread, workspace, model) => {
    const lines = [`@${roster} · ${state}`];
    if (model) lines.push(`Model: ${model}`);
    if (workspace) lines.push(`Workspace: ${workspace}`);
    if (thread) lines.push(`Thread: ${thread}`);
    if (task) lines.push(`Task: ${task}`);
    return lines.join('\n');
  },
  memberTipThread: (title) => `Thread: ${title}`,
  memberTipTask: (task) => `Task: ${task}`,
  memberTipBoard: (readSeq, boardSeq, postSeq, postTime) => {
    const parts: string[] = [];
    if (readSeq !== undefined && boardSeq > 0) parts.push(`Read #${readSeq}/${boardSeq}`);
    else if (readSeq !== undefined) parts.push(`Read #${readSeq}`);
    if (postSeq !== undefined) parts.push(`Last post #${postSeq}${postTime ? ` (${postTime})` : ''}`);
    return parts.join(' · ');
  },
  memberTipLatest: (snippet) => `Latest: ${snippet}`,
  swarmRoleBadge: 'SWARM',
  subagentRoleFallback: (role, shortId) => `${role || 'Subagent'} · ${shortId}…`,
};

const zhSwarm: SwarmStrings = {
  cockpitTitle: '蜂群总控台',
  goalPrefix: '目标',
  boardBadge: (seq) => `消息板 #${seq}`,
  stateLabel: (state) => {
    if (state === 'working') return '工作中';
    if (state === 'waiting') return '等待中';
    if (state === 'stopped') return '已停止';
    return '已结束';
  },
  workingPill: (n) => `${n} 工作中`,
  waitingPill: (n) => `${n} 等待中`,
  stoppedPill: (n) => `${n} 已停止`,
  killedPill: (n) => `${n} 已结束`,
  swarmTotalLabel: '蜂群合计',
  swarmTotalMeta: (calls, outStr, costStr) =>
    `${calls} 次调用 · 输出 ${outStr}${costStr ? ` · ${costStr}` : ''}`,
  viewFlat: '平铺',
  viewThread: '按线程',
  unassignedThread: '其他成员',
  memberCallsZero: '0 次调用',
  memberMeta: (calls, outStr, costStr) =>
    `${calls}次 · 输出 ${outStr}${costStr ? ` · ${costStr}` : ''}`,
  lastPostTag: (seq) => `发言 #${seq}`,
  workspaceLabel: (mode) => mode,
  workspaceTip: (mode) => {
    if (mode === 'share') return '独立 Git Worktree (share)';
    if (mode === 'branch') return '独立仓库副本 (branch)';
    return '共享工作区 (inherit)';
  },
  pendingConv: '初始化中…',
  backCoordinator: (swarmTitle) => `@coordinator · ${swarmTitle}`,
  backCoordinatorTip: (swarmTitle, coordId, quotaTip) =>
    `返回蜂群协调者主会话 (${coordId.slice(0, 8)}…)\n蜂群: ${swarmTitle}${quotaTip ? `\n\n${quotaTip}` : ''}`,
  coordSwarmPillWorking: (working, total) => `蜂群 · ${working}/${total} 工作中`,
  coordSwarmPillIdle: (total) => `蜂群 · ${total} 成员`,
  coordSwarmPillTip: (title, working, waiting, stopped, killed, boardSeq, goal) => {
    const counts = [
      working > 0 ? `${working} 工作中` : '',
      waiting > 0 ? `${waiting} 等待中` : '',
      stopped > 0 ? `${stopped} 已停止` : '',
      killed > 0 ? `${killed} 已结束` : '',
    ].filter(Boolean).join(' · ');
    return `${title}${goal ? `\n${goal}` : ''}\n${counts || '0 成员'}${boardSeq > 0 ? ` · 消息板 #${boardSeq}` : ''}\n点击定位到蜂群总控台`;
  },
  workerBadgeTip: (roster, state, task, thread, workspace, model) => {
    const lines = [`@${roster} · ${state}`];
    if (model) lines.push(`模型: ${model}`);
    if (workspace) lines.push(`工作区: ${workspace}`);
    if (thread) lines.push(`线程: ${thread}`);
    if (task) lines.push(`任务: ${task}`);
    return lines.join('\n');
  },
  memberTipThread: (title) => `线程: ${title}`,
  memberTipTask: (task) => `任务: ${task}`,
  memberTipBoard: (readSeq, boardSeq, postSeq, postTime) => {
    const parts: string[] = [];
    if (readSeq !== undefined && boardSeq > 0) parts.push(`已读 #${readSeq}/${boardSeq}`);
    else if (readSeq !== undefined) parts.push(`已读 #${readSeq}`);
    if (postSeq !== undefined) parts.push(`最近发言 #${postSeq}${postTime ? ` (${postTime})` : ''}`);
    return parts.join(' · ');
  },
  memberTipLatest: (snippet) => `最新动态: ${snippet}`,
  swarmRoleBadge: '蜂群',
  subagentRoleFallback: (role, shortId) => `${role || '子会话'} · ${shortId}…`,
};

export function getSwarmStrings(lang: Lang = 'en'): SwarmStrings {
  return lang === 'zh' ? zhSwarm : enSwarm;
}
