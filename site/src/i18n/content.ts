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
    badge: string;
    headline: string;
    subhead: string;
    meta: string;
    interactiveHint: string;
    themeStripLabel: string;
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
    eyebrow: string;
    heading: string;
    subhead: string;
    tryLive: string;
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
      overview: 'Features',
      credits: 'Credits',
      docs: 'Guide',
      github: 'GitHub',
    },
    hero: {
      badge: 'v1.2 · OpenRouter 7d/24h Curves · Cyber Arena PK · 2x Wrapped Poster',
      headline: 'See what Antigravity is really doing.',
      subhead:
        'A native telemetry cockpit built into Google Antigravity’s side pane — real GEN speed, TTFT root-cause attribution, global Gemini 7d/24h curves & Cyber Arena PK, calibrated Ultra 20x quota runway, recursive Swarm rollup, and 2x PNG Wrapped posters.',
      meta: 'Pure Official Sidecar · Zero CDP / Zero Patching · 100% Local Read-Only · Node.js 22.18+',
      interactiveHint: '100% real embedded AGY-HUD above — click the tour bar below the panel to jump directly to Global Curves, Arena PK, or 2x Wrapped Poster.',
      themeStripLabel: 'Live 16-theme sync',
      copy: 'Copy',
      copied: 'Copied',
      autoDetected: 'Recommended',
      tabs: {
        unix: 'macOS / Linux',
        windows: 'Windows',
        agent: 'AI Agent',
        manual: 'Source',
      },
      doctorTip: 'Installs to ~/.gemini/config/plugins/agy-hud · zero runtime dependencies',
      agentHint: 'Paste into Antigravity, Claude Code, or Codex — installs and verifies via AGENTS.md',
      licenseTip: 'MIT License',
    },
    highlights: {
      eyebrow: 'TELEMETRY COCKPIT',
      heading: 'Every blind spot in Antigravity, made visible.',
      subhead:
        'From why a single turn stalled to how your local account stacks up against the global Gemini pool — every chart below runs live in the embedded panel above.',
      tryLive: 'Try live',
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
      overview: '核心能力',
      credits: '致谢',
      docs: '使用指南',
      github: 'GitHub',
    },
    hero: {
      badge: 'v1.2 · OpenRouter 7d/24h 大盘折线 · ⚔ 赛博斗蛐蛐 · 2x 战报海报',
      headline: '看清 Antigravity 正在发生的一切。',
      subhead:
        '专为 Google Antigravity 打造的原生遥测驾驶舱——实时生成速度、首字慢归因、Gemini 全球 7 天/24h 大盘折线与赛博斗蛐蛐 PK、Ultra 20x 配额续航、Swarm 递归合并统计，以及一键生成 2x 高清分享战报海报。',
      meta: '纯官方 Sidecar · 零改包 / 零 CDP · 100% 本地只读 · Node.js 22.18+',
      interactiveHint: '上方即 100% 真实嵌入的 AGY-HUD 面板——点击底部导览栏，直接体验「大盘折线」「赛博斗蛐蛐」与「2x 战报海报」。',
      themeStripLabel: '16 套官方主题实时同步',
      copy: '复制',
      copied: '已复制',
      autoDetected: '推荐',
      tabs: {
        unix: 'macOS / Linux',
        windows: 'Windows',
        agent: 'AI 一句话安装',
        manual: '源码安装',
      },
      doctorTip: '仅安装至 ~/.gemini/config/plugins/agy-hud · 零第三方运行时依赖',
      agentHint: '直接发给 Antigravity / Claude Code / Codex，按仓库 AGENTS.md 自动安装并验收',
      licenseTip: 'MIT 开源',
    },
    highlights: {
      eyebrow: '全链路可观测性',
      heading: '把 Antigravity 的每个黑盒，变成透明仪表盘。',
      subhead:
        '从「这一轮为什么卡首字」到「我的 Ultra 账号跟全球大盘比到底快不快」，下面每项能力都可以直接在上方真实面板中点开体验。',
      tryLive: '在面板中体验',
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
