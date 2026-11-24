export type ThemeMode = 'dark' | 'light';
export type ContrastMode = 'default' | 'strong';

export interface AgyTheme {
  id: string;
  name: string;
  mode: ThemeMode;
  /** Preview swatch colors: [canvasBg, cardSurface, primaryAccent, secondaryAccent] */
  swatches: [string, string, string, string];
  /** Website design tokens applied to documentElement */
  siteVars: Record<string, string>;
  /** Official Antigravity host CSS variables forwarded to embedded real HUD iframe */
  hostVars: Record<string, string>;
}

interface ThemeSeed {
  id: string;
  name: string;
  mode: ThemeMode;
  bg: string;
  bgSubtle: string;
  surface: string;
  surface2: string;
  surface3: string;
  fg: string;
  fg2: string;
  muted: string;
  faint: string;
  accent: string;
  accentInk: string;
  accentFg: string;
  cache: string;
  input: string;
  think: string;
  out: string;
  bad: string;
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function makeTheme(s: ThemeSeed): AgyTheme {
  const isDark = s.mode === 'dark';
  const borderBase = isDark ? s.fg : '#0f172a';

  return {
    id: s.id,
    name: s.name,
    mode: s.mode,
    swatches: [s.bg, s.surface, s.accent, s.cache],
    siteVars: {
      '--bg': s.bg,
      '--bg-subtle': s.bgSubtle,
      '--surface': s.surface,
      '--surface-2': s.surface2,
      '--surface-3': s.surface3,
      '--fg': s.fg,
      '--fg-2': s.fg2,
      '--muted': s.muted,
      '--faint': s.faint,
      '--accent': s.accent,
      '--accent-ink': s.accentInk,
      '--accent-fg': s.accentFg,
      '--seg-cache': s.cache,
      '--seg-input': s.input,
      '--seg-think': s.think,
      '--seg-out': s.out,
      '--seg-bad': s.bad,
      '--tint-ok': rgba(s.cache, isDark ? 0.13 : 0.1),
      '--tint-ok-border': rgba(s.cache, isDark ? 0.3 : 0.25),
      '--tint-accent': rgba(s.accent, isDark ? 0.14 : 0.1),
      '--tint-accent-border': rgba(s.accent, isDark ? 0.32 : 0.26),
      '--tint-think': rgba(s.think, isDark ? 0.13 : 0.1),
      '--tint-think-border': rgba(s.think, isDark ? 0.3 : 0.25),
      '--tint-out': rgba(s.out, isDark ? 0.13 : 0.1),
      '--tint-out-border': rgba(s.out, isDark ? 0.3 : 0.26),
      '--tint-bad': rgba(s.bad, isDark ? 0.13 : 0.1),
      '--tint-bad-border': rgba(s.bad, isDark ? 0.3 : 0.26),
      '--border': rgba(borderBase, isDark ? 0.095 : 0.085),
      '--border-subtle': rgba(borderBase, isDark ? 0.055 : 0.05),
      '--border-strong': rgba(borderBase, isDark ? 0.18 : 0.16),
      '--glass-bg': rgba(s.bg, isDark ? 0.84 : 0.88),
      '--glow-top': rgba(s.accent, isDark ? 0.09 : 0.055),
      '--glow-warm': rgba(s.think, isDark ? 0.055 : 0.04),
      '--hatch-stripe': isDark ? 'rgba(255, 255, 255, 0.24)' : 'rgba(255, 255, 255, 0.52)',
    },
    hostVars: {
      '--background': s.bg,
      '--card': s.surface,
      '--secondary': s.surface2,
      '--muted': s.bgSubtle,
      '--foreground': s.fg,
      '--secondary-foreground': s.fg2,
      '--muted-foreground': s.muted,
      '--placeholder': s.faint,
      '--border': rgba(borderBase, isDark ? 0.11 : 0.1),
      '--card-border': rgba(borderBase, isDark ? 0.1 : 0.09),
      '--primary': s.accent,
      '--primary-foreground': s.accentFg,
      '--error': s.bad,
    },
  };
}

export const AGY_THEMES: readonly AgyTheme[] = [
  // ── 12 Official Antigravity Dark Themes ──────────────────────────
  makeTheme({
    id: 'default-dark',
    name: 'Default Dark',
    mode: 'dark',
    bg: '#0c0d10',
    bgSubtle: '#101217',
    surface: '#14161c',
    surface2: '#1a1d26',
    surface3: '#222633',
    fg: '#f1f3f7',
    fg2: '#cbd2de',
    muted: '#8b95a5',
    faint: '#606a7b',
    accent: '#4f8cff',
    accentInk: '#79a8ff',
    accentFg: '#ffffff',
    cache: '#34d399',
    input: '#60a5fa',
    think: '#a78bfa',
    out: '#f5b942',
    bad: '#f87171',
  }),
  makeTheme({
    id: 'legacy-dark',
    name: 'Legacy Dark',
    mode: 'dark',
    bg: '#141416',
    bgSubtle: '#18191c',
    surface: '#1c1d20',
    surface2: '#24252a',
    surface3: '#2c2e34',
    fg: '#e5e7eb',
    fg2: '#c4c9d1',
    muted: '#8b9198',
    faint: '#646a72',
    accent: '#3b82f6',
    accentInk: '#60a5fa',
    accentFg: '#ffffff',
    cache: '#66c28b',
    input: '#60a5fa',
    think: '#a985e2',
    out: '#e2be56',
    bad: '#e06c75',
  }),
  makeTheme({
    id: 'catppuccin',
    name: 'Catppuccin',
    mode: 'dark',
    bg: '#1e1e2e',
    bgSubtle: '#181825',
    surface: '#252639',
    surface2: '#2e3046',
    surface3: '#383a54',
    fg: '#cdd6f4',
    fg2: '#bac2de',
    muted: '#9399b2',
    faint: '#6c7086',
    accent: '#89b4fa',
    accentInk: '#a6c8ff',
    accentFg: '#11111b',
    cache: '#a6e3a1',
    input: '#89b4fa',
    think: '#cba6f7',
    out: '#f9e2af',
    bad: '#f38ba8',
  }),
  makeTheme({
    id: 'dracula',
    name: 'Dracula',
    mode: 'dark',
    bg: '#282a36',
    bgSubtle: '#222430',
    surface: '#303342',
    surface2: '#383c4e',
    surface3: '#44475a',
    fg: '#f8f8f2',
    fg2: '#dcdce6',
    muted: '#9ea4c4',
    faint: '#6e7699',
    accent: '#bd93f9',
    accentInk: '#cfb0ff',
    accentFg: '#1e1f29',
    cache: '#50fa7b',
    input: '#8be9fd',
    think: '#bd93f9',
    out: '#ffb86c',
    bad: '#ff5555',
  }),
  makeTheme({
    id: 'everforest',
    name: 'Everforest',
    mode: 'dark',
    bg: '#2d353b',
    bgSubtle: '#272e33',
    surface: '#343f44',
    surface2: '#3d484d',
    surface3: '#475258',
    fg: '#d3c6aa',
    fg2: '#c2b69c',
    muted: '#9da9a0',
    faint: '#7a8478',
    accent: '#a7c080',
    accentInk: '#b7cf92',
    accentFg: '#232a2e',
    cache: '#83c092',
    input: '#7fbbb3',
    think: '#d699b6',
    out: '#dbbc7f',
    bad: '#e67e80',
  }),
  makeTheme({
    id: 'gruvbox-material',
    name: 'Gruvbox Material',
    mode: 'dark',
    bg: '#282828',
    bgSubtle: '#222120',
    surface: '#32302f',
    surface2: '#3c3836',
    surface3: '#494440',
    fg: '#d4be98',
    fg2: '#c5b18e',
    muted: '#a89984',
    faint: '#7c6f64',
    accent: '#d8a657',
    accentInk: '#e5b96f',
    accentFg: '#1d2021',
    cache: '#a9b665',
    input: '#7daea3',
    think: '#d3869b',
    out: '#e78a4e',
    bad: '#ea6962',
  }),
  makeTheme({
    id: 'monokai',
    name: 'Monokai',
    mode: 'dark',
    bg: '#272822',
    bgSubtle: '#21221d',
    surface: '#2f3029',
    surface2: '#383a31',
    surface3: '#45473c',
    fg: '#f8f8f2',
    fg2: '#dcdcd2',
    muted: '#a5a594',
    faint: '#75715e',
    accent: '#a6e22e',
    accentInk: '#b9ef4c',
    accentFg: '#1e1f1a',
    cache: '#a6e22e',
    input: '#66d9ef',
    think: '#ae81ff',
    out: '#fd971f',
    bad: '#f92672',
  }),
  makeTheme({
    id: 'nord',
    name: 'Nord',
    mode: 'dark',
    bg: '#2e3440',
    bgSubtle: '#282e39',
    surface: '#363d4c',
    surface2: '#3f4758',
    surface3: '#4c566a',
    fg: '#eceff4',
    fg2: '#d8dee9',
    muted: '#9aa7be',
    faint: '#728099',
    accent: '#88c0d0',
    accentInk: '#9cd0df',
    accentFg: '#242933',
    cache: '#a3be8c',
    input: '#81a1c1',
    think: '#b48ead',
    out: '#ebcb8b',
    bad: '#bf616a',
  }),
  makeTheme({
    id: 'one-dark-pro',
    name: 'One Dark Pro',
    mode: 'dark',
    bg: '#282c34',
    bgSubtle: '#21252b',
    surface: '#2f343f',
    surface2: '#373d4a',
    surface3: '#424958',
    fg: '#dcdfe4',
    fg2: '#abb2bf',
    muted: '#8791a3',
    faint: '#636b7a',
    accent: '#61afef',
    accentInk: '#7cc0f7',
    accentFg: '#1c2026',
    cache: '#98c379',
    input: '#61afef',
    think: '#c678dd',
    out: '#e5c07b',
    bad: '#e06c75',
  }),
  makeTheme({
    id: 'tokyo-night',
    name: 'Tokyo Night',
    mode: 'dark',
    bg: '#1a1b26',
    bgSubtle: '#16161e',
    surface: '#222436',
    surface2: '#292e42',
    surface3: '#333952',
    fg: '#c0caf5',
    fg2: '#a9b1d6',
    muted: '#7e88b5',
    faint: '#565f89',
    accent: '#7aa2f7',
    accentInk: '#94b5ff',
    accentFg: '#15161e',
    cache: '#9ece6a',
    input: '#7dcfff',
    think: '#bb9af7',
    out: '#e0af68',
    bad: '#f7768e',
  }),
  makeTheme({
    id: 'solarized-dark',
    name: 'Solarized Dark',
    mode: 'dark',
    bg: '#002b36',
    bgSubtle: '#00232c',
    surface: '#073642',
    surface2: '#0d404d',
    surface3: '#154d5c',
    fg: '#eee8d5',
    fg2: '#c5cfc9',
    muted: '#839496',
    faint: '#586e75',
    accent: '#268bd2',
    accentInk: '#55ace8',
    accentFg: '#ffffff',
    cache: '#859900',
    input: '#2aa198',
    think: '#6c71c4',
    out: '#b58900',
    bad: '#dc322f',
  }),
  makeTheme({
    id: 'vesper',
    name: 'Vesper',
    mode: 'dark',
    bg: '#101010',
    bgSubtle: '#0c0c0c',
    surface: '#161616',
    surface2: '#1e1e1e',
    surface3: '#282828',
    fg: '#ffffff',
    fg2: '#d4d4d4',
    muted: '#a0a0a0',
    faint: '#6b6b6b',
    accent: '#ffc799',
    accentInk: '#ffd4b0',
    accentFg: '#101010',
    cache: '#99ffe4',
    input: '#ffc799',
    think: '#d4bfff',
    out: '#ffc799',
    bad: '#ff8080',
  }),

  // ── 4 Light Counterparts ─────────────────────────────────────────
  makeTheme({
    id: 'default-light',
    name: 'Default Light',
    mode: 'light',
    bg: '#fafafa',
    bgSubtle: '#f3f4f6',
    surface: '#ffffff',
    surface2: '#f2f4f7',
    surface3: '#e7eaef',
    fg: '#0f172a',
    fg2: '#334155',
    muted: '#5b6577',
    faint: '#8691a4',
    accent: '#2563eb',
    accentInk: '#1d4ed8',
    accentFg: '#ffffff',
    cache: '#15803d',
    input: '#2563eb',
    think: '#7c3aed',
    out: '#b45309',
    bad: '#dc2626',
  }),
  makeTheme({
    id: 'legacy-light',
    name: 'Legacy Light',
    mode: 'light',
    bg: '#f5f6f8',
    bgSubtle: '#edeff2',
    surface: '#ffffff',
    surface2: '#eef0f3',
    surface3: '#e2e5ea',
    fg: '#1d1f21',
    fg2: '#3d4248',
    muted: '#677078',
    faint: '#8c959e',
    accent: '#1a73e8',
    accentInk: '#1557b0',
    accentFg: '#ffffff',
    cache: '#2e7d32',
    input: '#1a73e8',
    think: '#7c56d8',
    out: '#b57b1b',
    bad: '#c74f4f',
  }),
  makeTheme({
    id: 'catppuccin-latte',
    name: 'Catppuccin Latte',
    mode: 'light',
    bg: '#eff1f5',
    bgSubtle: '#e6e9ef',
    surface: '#ffffff',
    surface2: '#e6e9ef',
    surface3: '#dce0e8',
    fg: '#4c4f69',
    fg2: '#5c5f77',
    muted: '#6c6f85',
    faint: '#8c8fa1',
    accent: '#1e66f5',
    accentInk: '#1754cf',
    accentFg: '#ffffff',
    cache: '#40a02b',
    input: '#1e66f5',
    think: '#8839ef',
    out: '#df8e1d',
    bad: '#d20f39',
  }),
  makeTheme({
    id: 'solarized-light',
    name: 'Solarized Light',
    mode: 'light',
    bg: '#fdf6e3',
    bgSubtle: '#f5eed8',
    surface: '#fffbf0',
    surface2: '#eee8d5',
    surface3: '#e3dcc6',
    fg: '#073642',
    fg2: '#39555c',
    muted: '#586e75',
    faint: '#839496',
    accent: '#268bd2',
    accentInk: '#1c6ca5',
    accentFg: '#ffffff',
    cache: '#667a00',
    input: '#2aa198',
    think: '#6c71c4',
    out: '#b58900',
    bad: '#dc322f',
  }),
];

export const AGY_DARK_THEMES = AGY_THEMES.filter((t) => t.mode === 'dark');
export const AGY_LIGHT_THEMES = AGY_THEMES.filter((t) => t.mode === 'light');

const THEME_STORAGE_KEY = 'agy-hud-site-theme-id';
const LEGACY_THEME_KEY = 'agy-hud-site-theme';
const CONTRAST_STORAGE_KEY = 'agy-hud-site-contrast';

export function getThemeById(id: string | null | undefined): AgyTheme {
  if (!id) return AGY_THEMES[0];
  if (id === 'dark') return AGY_THEMES[0];
  if (id === 'light') return AGY_LIGHT_THEMES[0];
  return AGY_THEMES.find((t) => t.id === id) || AGY_THEMES[0];
}

export function getInitialThemeId(): string {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved) return getThemeById(saved).id;
    const legacy = localStorage.getItem(LEGACY_THEME_KEY);
    if (legacy === 'light') return 'default-light';
    if (legacy === 'dark') return 'default-dark';
  } catch {
    /* ignore */
  }
  return 'default-dark';
}

export function saveThemeId(id: string): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, id);
    const t = getThemeById(id);
    localStorage.setItem(LEGACY_THEME_KEY, t.mode);
  } catch {
    /* ignore */
  }
}

export function getInitialContrast(): ContrastMode {
  try {
    const saved = localStorage.getItem(CONTRAST_STORAGE_KEY);
    if (saved === 'strong' || saved === 'default') return saved;
  } catch {
    /* ignore */
  }
  return 'default';
}

export function saveContrast(contrast: ContrastMode): void {
  try {
    localStorage.setItem(CONTRAST_STORAGE_KEY, contrast);
  } catch {
    /* ignore */
  }
}

export function applyAgyThemeToDocument(theme: AgyTheme, contrast: ContrastMode): void {
  const root = document.documentElement;
  root.dataset.theme = theme.mode;
  root.dataset.themeId = theme.id;
  root.dataset.contrast = contrast;
  root.style.colorScheme = theme.mode;

  for (const [k, v] of Object.entries(theme.siteVars)) {
    root.style.setProperty(k, v);
  }

  if (contrast === 'strong') {
    const isDark = theme.mode === 'dark';
    const base = isDark ? theme.siteVars['--fg'] : '#0f172a';
    root.style.setProperty('--border', rgba(base, isDark ? 0.24 : 0.24));
    root.style.setProperty('--border-strong', rgba(base, isDark ? 0.36 : 0.36));
  }

  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) {
    metaTheme.setAttribute('content', theme.siteVars['--bg']);
  }
}

export function buildHostThemePayload(theme: AgyTheme, contrast: ContrastMode) {
  const cssVariables: Record<string, string> = { ...theme.hostVars };
  if (contrast === 'strong') {
    const isDark = theme.mode === 'dark';
    const base = isDark ? theme.hostVars['--foreground'] : '#0f172a';
    cssVariables['--border'] = rgba(base, 0.28);
    cssVariables['--card-border'] = rgba(base, 0.28);
    cssVariables['--contrast'] = 'strong';
  } else {
    cssVariables['--contrast'] = 'default';
  }
  return {
    contrast,
    cssVariables,
  };
}
