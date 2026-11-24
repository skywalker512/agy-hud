export const CJK_FALLBACK_FONTS = [
  '"PingFang SC"',
  '"Hiragino Sans GB"',
  '"Microsoft YaHei UI"',
  '"Microsoft YaHei"',
  '"Noto Sans SC"',
  '"Noto Sans CJK SC"',
] as const;

const DEFAULT_LATIN_SANS = ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', '"Helvetica Neue"', 'Arial'] as const;
const DEFAULT_LATIN_MONO = ['SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', '"Liberation Mono"'] as const;

const CJK_FONT_RE =
  /(pingfang|hiragino|yahei|noto\s*sans\s*(?:sc|cjk|tc|hans|hant)|source\s*han|sarasa|harmonyos|misans|wenquanyi|simhei|heiti|stxihei|stheiti|dengxian|yu\s*gothic|meiryo|malgun|maple\s*mono.*cn|lxgw)/i;

const EMOJI_FONT_RE = /(color\s*emoji|segoe\s*ui\s*(?:emoji|symbol)|apple\s*color\s*emoji|noto\s*color\s*emoji)/i;

const GENERIC_FAMILIES = new Set([
  'sans-serif',
  'serif',
  'monospace',
  'system-ui',
  'ui-sans-serif',
  'ui-serif',
  'ui-monospace',
  'ui-rounded',
  'cursive',
  'fantasy',
  'emoji',
  'math',
  'fangsong',
]);

function splitFontList(raw: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: '"' | "'" | '' = '';
  let parenDepth = 0;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (quote) {
      cur += ch;
      if (ch === quote && raw[i - 1] !== '\\') quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === '(') {
      parenDepth++;
      cur += ch;
      continue;
    }
    if (ch === ')' && parenDepth > 0) {
      parenDepth--;
      cur += ch;
      continue;
    }
    if (ch === ',' && parenDepth === 0) {
      const token = cur.trim();
      if (token) out.push(token);
      cur = '';
      continue;
    }
    cur += ch;
  }

  const tail = cur.trim();
  if (tail) out.push(tail);
  return out;
}

function unquote(token: string): string {
  return token.replace(/^['"]|['"]$/g, '').trim();
}

/**
 * Ensures host-injected CSS font stacks always include explicit CJK UI fonts
 * (PingFang SC / Microsoft YaHei UI / Microsoft YaHei / Noto Sans SC) BEFORE
 * any generic family (`system-ui`, `sans-serif`, `ui-monospace`, `monospace`),
 * preventing Windows Chromium/Electron from falling back to jagged SimSun / NSimSun.
 */
export function buildHudFontStack(rawFont: string, kind: 'sans' | 'mono'): string {
  const trimmed = String(rawFont || '').trim();
  if (!trimmed) return '';
  if (/\bvar\s*\(/i.test(trimmed)) return '';
  if (CJK_FONT_RE.test(trimmed)) return trimmed;

  const tokens = splitFontList(trimmed);
  if (tokens.length === 0) return '';

  const named: string[] = [];
  const generics: string[] = [];
  const emoji: string[] = [];
  const seen = new Set<string>();

  for (const token of tokens) {
    const norm = unquote(token).toLowerCase();
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);

    if (GENERIC_FAMILIES.has(norm)) {
      generics.push(norm);
    } else if (EMOJI_FONT_RE.test(norm)) {
      emoji.push(token);
    } else {
      named.push(token);
    }
  }

  if (kind === 'sans') {
    // Align 1:1 with Antigravity Hub & official Swarm sidecar:
    // Keep `system-ui` right after Google Sans / host UI face so Windows DirectWrite
    // uses the exact same native UI font chain as Antigravity App itself, and place
    // explicit CJK fallbacks right before `sans-serif` as a safety net for en-US / Linux.
    const prefix: string[] = [];
    const hostTailGenerics: string[] = [];
    const addedSystemUi = new Set<string>();
    const pushUnique = (val: string) => {
      const key = unquote(val).toLowerCase();
      if (!addedSystemUi.has(key)) {
        addedSystemUi.add(key);
        prefix.push(val);
      }
    };

    for (const token of tokens) {
      const norm = unquote(token).toLowerCase();
      if (!norm) continue;
      if (norm === 'system-ui') {
        pushUnique('system-ui');
      } else if (GENERIC_FAMILIES.has(norm)) {
        if (!hostTailGenerics.includes(norm)) hostTailGenerics.push(norm);
      } else if (!EMOJI_FONT_RE.test(norm)) {
        pushUnique(token);
      }
    }

    if (!addedSystemUi.has('system-ui')) {
      const insertAt = prefix.findIndex((f) => !/^google\s+sans/i.test(unquote(f)));
      if (insertAt === -1) prefix.push('system-ui');
      else prefix.splice(insertAt, 0, 'system-ui');
    }
    if (named.length === 0) {
      for (const fallback of DEFAULT_LATIN_SANS) pushUnique(fallback);
    }
    if (!hostTailGenerics.includes('sans-serif')) {
      hostTailGenerics.push('sans-serif');
    }

    return [...prefix, ...CJK_FALLBACK_FONTS, ...hostTailGenerics, ...emoji].join(', ');
  }

  // Monospace: place explicit CJK fallbacks BEFORE `ui-monospace` / `monospace`
  // so Windows Chinese labels inside mono elements never fall back to jagged NSimSun.
  const latinPrefix = named.length > 0 ? named : [...DEFAULT_LATIN_MONO];
  const tailGenerics = [...generics];
  if (!tailGenerics.includes('ui-monospace')) {
    tailGenerics.unshift('ui-monospace');
  }
  if (!tailGenerics.includes('monospace')) {
    tailGenerics.push('monospace');
  }

  return [...latinPrefix, ...CJK_FALLBACK_FONTS, ...tailGenerics, ...emoji].join(', ');
}
