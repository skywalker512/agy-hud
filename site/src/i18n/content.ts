export type Locale = 'en' | 'zh';

export interface CreditProject {
  name: string;
  href: string;
  role: string;
}

export interface SiteCopy {
  nav: {
    overview: string;
    credits: string;
    docs: string;
    github: string;
  };
  hero: {
    headline: string;
    subhead: string;
    meta: string;
    interactiveHint: string;
    copy: string;
    copied: string;
    autoDetected: string;
    tabs: {
      unix: string;
      windows: string;
      agent: string;
      manual: string;
    };
    doctorTip: string;
    agentHint: string;
    licenseTip: string;
  };
  highlights: {
    items: ReadonlyArray<{
      title: string;
      body: string;
    }>;
  };
  credits: {
    heading: string;
    lead: string;
    items: readonly CreditProject[];
  };
  footer: {
    guideLink: string;
    installGuideLink: string;
    changelogLink: string;
    releasesLink: string;
    issuesLink: string;
    note: string;
  };
}

export const COPY: Record<Locale, SiteCopy> = {
  en: {
    nav: {
      overview: 'Overview',
      credits: 'Credits',
      docs: 'Guide',
      github: 'GitHub',
    },
    hero: {
      headline: 'See what Antigravity is really doing.',
      subhead:
        'A quiet native side panel for Google Antigravity — real speed, first-token wait, context pressure, prompt cache survival, and quota runway. Local, read-only, and synced to your theme.',
      meta: 'Official sidecar · Zero CDP · 100% local read-only · Node.js 22.18+',
      interactiveHint: 'Live HUD embedded above — switch tabs, drag the chart, inspect a call, or try any Antigravity theme.',
      copy: 'Copy',
      copied: 'Copied',
      autoDetected: 'Recommended',
      tabs: {
        unix: 'macOS / Linux',
        windows: 'Windows',
        agent: 'AI Agent',
        manual: 'Source',
      },
      doctorTip: 'Installs to ~/.gemini/config/plugins/agy-hud · zero dependencies',
      agentHint: 'Paste into Antigravity, Claude Code, or Codex — installs and verifies via AGENTS.md',
      licenseTip: 'MIT License',
    },
    highlights: {
      items: [
        {
          title: 'Blends into Antigravity, not on top of it',
          body: 'Automatically mirrors your active Antigravity theme, font scale, and high-contrast mode. Try any of the 16 built-in themes in the top bar — the live panel adapts on the spot.',
        },
        {
          title: 'Know why a turn felt slow',
          body: 'Separates steady token throughput from first-token wait, shows which tools fill your context window, and lets you inspect any call’s timing waterfall, thinking, and tool calls.',
        },
        {
          title: 'Stay ahead of cache expiry and compactions',
          body: 'Models your prompt cache survival window from local history so you know when a pause will trigger a full re-prefill, and estimates how many turns remain before compaction.',
        },
        {
          title: 'Honest quota runway, zero patching',
          body: 'Combines App, CLI, and IDE usage to project 5-hour and weekly reset headroom. Runs strictly as an official read-only sidecar — no proxy, no debug port, no app modifications.',
        },
      ],
    },
    credits: {
      heading: 'Built with inspiration from the community',
      lead: 'AGY-HUD started as a fork and grew alongside great open-source work around Google Antigravity.',
      items: [
        {
          name: 'adahime/agy-hud',
          href: 'https://github.com/adahime/agy-hud',
          role: 'Upstream origin — read-only local SQLite telemetry & Antigravity sidecar foundation',
        },
        {
          name: 'ATtacK030130/antigrative-dashboard',
          href: 'https://github.com/ATtacK030130/antigrative-dashboard',
          role: 'Inspired the hatched quota runway bar, token iceberg chart, and visual restraint',
        },
        {
          name: 'yuhuan-dev/antigravity-usage-monitor',
          href: 'https://github.com/yuhuan-dev/antigravity-usage-monitor',
          role: 'Inspired the borderless dark surfaces, 2-column context table, and slim sidebar',
        },
        {
          name: 'WhiteBr1ck/agy-powertools',
          href: 'https://github.com/WhiteBr1ck/agy-powertools',
          role: 'Inspired the bottom-anchored speed sparkline and borderless activity heatmap',
        },
        {
          name: 'AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor',
          href: 'https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor',
          role: 'Inspired the one-sentence AGENTS.md agent-assisted installation flow',
        },
      ],
    },
    footer: {
      guideLink: 'User Guide',
      installGuideLink: 'Installation',
      changelogLink: 'Changelog',
      releasesLink: 'Releases',
      issuesLink: 'Issues',
      note: 'MIT License · 100% local read-only telemetry',
    },
  },
  zh: {
    nav: {
      overview: '概览',
      credits: '致谢',
      docs: '使用指南',
      github: 'GitHub',
    },
    hero: {
      headline: '看清 Antigravity 正在发生的一切。',
      subhead:
        '为 Google Antigravity 打造的原生侧边栏面板——实时查看生成速度、首字等待、上下文压力、缓存存活倒计时与配额续航。纯本地只读，自动融入你的 Antigravity 主题。',
      meta: '纯官方 Sidecar · 零 CDP / 零改包 · 100% 本地只读 · Node.js 22.18+',
      interactiveHint: '上方即真实侧边栏组件——可自由切换标签、拖拽趋势图、点开调用详情，或切换右上角 16 套 Antigravity 主题。',
      copy: '复制',
      copied: '已复制',
      autoDetected: '推荐',
      tabs: {
        unix: 'macOS / Linux',
        windows: 'Windows',
        agent: 'AI 一句话安装',
        manual: '源码安装',
      },
      doctorTip: '仅安装至 ~/.gemini/config/plugins/agy-hud · 零第三方依赖',
      agentHint: '直接发给 Antigravity / Claude Code / Codex，按仓库 AGENTS.md 自动安装并验收',
      licenseTip: 'MIT 开源',
    },
    highlights: {
      items: [
        {
          title: '自然融入 Antigravity，像原生自带一样',
          body: '自动同步当前 Antigravity 主题、字号缩放与强对比度模式。你可以直接点击右上角切换 16 套官方主题，右侧真实面板会同步变化。',
        },
        {
          title: '一眼看懂这一轮为什么慢',
          body: '把持续吐字速度与首字等待清晰分开，展开上下文里每个工具的占用，点开任意一次调用即可回看耗时瀑布、思考与工具记录。',
        },
        {
          title: '在掉缓存和触发压缩之前提前知道',
          body: '基于本机历史估算提示词缓存的存活窗口，提醒你晾多久会触发重算多花钱，同时估算距离自动压缩大约还剩几轮对话。',
        },
        {
          title: '透明的配额续航，且绝不侵入宿主',
          body: '汇总桌面端、CLI 与 IDE 用量并结合日常节奏预测 5 小时和周配额余量。严格运行在官方只读 Sidecar 内，不改安装包、不开调试端口、不上传任何数据。',
        },
      ],
    },
    credits: {
      heading: '站在社区的肩膀上',
      lead: 'AGY-HUD 源于上游社区并在众多优秀的 Antigravity 开源项目启发下持续打磨。',
      items: [
        {
          name: 'adahime/agy-hud',
          href: 'https://github.com/adahime/agy-hud',
          role: '上游 Fork 源项目——开创本地只读 SQLite 遥测与初代侧边栏底座',
        },
        {
          name: 'ATtacK030130/antigrative-dashboard',
          href: 'https://github.com/ATtacK030130/antigrative-dashboard',
          role: '启发了斜纹配额续航条、单色 Token 冰山图与克制的极简美学',
        },
        {
          name: 'yuhuan-dev/antigravity-usage-monitor',
          href: 'https://github.com/yuhuan-dev/antigravity-usage-monitor',
          role: '启发了无边框明度分层卡片、双列对齐上下文表与紧凑侧边栏',
        },
        {
          name: 'WhiteBr1ck/agy-powertools',
          href: 'https://github.com/WhiteBr1ck/agy-powertools',
          role: '启发了 Hero 底部渐变折线与无描边柔和热力图设计',
        },
        {
          name: 'AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor',
          href: 'https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor',
          role: '启发了 AGENTS.md 一句话 AI 助手自动安装流程',
        },
      ],
    },
    footer: {
      guideLink: '使用指南',
      installGuideLink: '安装说明',
      changelogLink: '更新日志',
      releasesLink: '版本发布',
      issuesLink: '问题反馈',
      note: 'MIT 开源 · 100% 本地只读遥测',
    },
  },
};

const STORAGE_KEY = 'agy-hud-site-locale';

export function detectInitialLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'zh') return saved;
  } catch {
    /* ignore */
  }
  if (typeof navigator !== 'undefined') {
    const langs = [navigator.language, ...(navigator.languages || [])].filter(Boolean);
    if (langs.some((l) => l.toLowerCase().startsWith('zh'))) return 'zh';
  }
  return 'en';
}

export function saveLocale(locale: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    /* ignore */
  }
}
