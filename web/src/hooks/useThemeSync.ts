import { useEffect } from 'preact/hooks';

interface ThemePayload {
  fontFamily?: string;
  fontSize?: string | number;
  contrast?: string;
  cssVariables?: Record<string, string>;
}

export function useThemeSync(): void {
  useEffect(() => {
    const themeCanvas = document.createElement('canvas');
    themeCanvas.width = 1;
    themeCanvas.height = 1;
    let themeCtx: CanvasRenderingContext2D | null = null;
    try {
      themeCtx = themeCanvas.getContext('2d', { willReadFrequently: true });
    } catch {
      themeCtx = null;
    }

    const lastThemeState: Record<string, string> = {
      theme: '',
      contrast: '',
      card: '',
      accentFg: '',
      accentInk: '',
      font: '',
      fontScale: '',
    };
    let themeTimer: ReturnType<typeof setTimeout> | null = null;
    let lastThemePayload: ThemePayload | null = null;

    function sampleCssRgba(cssExpr: string): [number, number, number, number] | null {
      const probe = document.createElement('span');
      probe.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;color:${cssExpr}`;
      const host = document.body || document.documentElement;
      host.appendChild(probe);
      const computed = getComputedStyle(probe).color;
      probe.remove();
      if (!computed || computed === 'transparent' || computed === 'none') return null;

      if (themeCtx) {
        try {
          themeCtx.clearRect(0, 0, 1, 1);
          themeCtx.fillStyle = 'rgba(0,0,0,0)';
          themeCtx.fillStyle = computed;
          themeCtx.fillRect(0, 0, 1, 1);
          const [r, g, b, a] = themeCtx.getImageData(0, 0, 1, 1).data;
          if (a > 0) return [r, g, b, a / 255];
        } catch {
          /* fall through */
        }
      }

      const nums = (computed.match(/[\d.]+/g) || []).map(Number);
      if (nums.length >= 3) {
        const scale = computed.startsWith('color(') ? 1 : 255;
        const [r, g, b] = nums.slice(0, 3).map((v) => Math.round((v / scale) * 255));
        const a = nums.length >= 4 ? nums[3] : 1;
        return a === 0 ? null : [r, g, b, a];
      }
      return null;
    }

    function relLum(rgba: [number, number, number, number] | null): number | null {
      if (!rgba) return null;
      const toLin = (c: number) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * toLin(rgba[0]) + 0.7152 * toLin(rgba[1]) + 0.0722 * toLin(rgba[2]);
    }

    function applyBodyVar(key: string, propName: string, val: string): void {
      if (lastThemeState[key] === val) return;
      lastThemeState[key] = val;
      const bodyStyle = document.body?.style;
      if (!bodyStyle) return;
      if (val) bodyStyle.setProperty(propName, val);
      else bodyStyle.removeProperty(propName);
    }

    function readRootVar(names: string[]): string {
      const rootStyle = document.documentElement?.style;
      const cs = getComputedStyle(document.documentElement);
      for (const name of names) {
        const val = (rootStyle?.getPropertyValue?.(name) || cs.getPropertyValue(name) || '').trim();
        if (val) return val;
      }
      return '';
    }

    function sampleHostFontPx(): number {
      const cssVars = lastThemePayload?.cssVariables || {};
      const explicit =
        lastThemePayload?.fontSize ||
        cssVars['--font-size'] ||
        cssVars['--ui-font-size'] ||
        cssVars['--base-font-size'] ||
        cssVars['--vscode-font-size'] ||
        readRootVar(['--font-size', '--ui-font-size', '--base-font-size', '--text-base', '--vscode-font-size', '--body-font-size']) ||
        document.documentElement?.style?.fontSize ||
        '';
      const raw = typeof explicit === 'number' ? `${explicit}px` : String(explicit).trim();
      if (!raw) return 14;
      const probe = document.createElement('span');
      probe.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;font-size:${raw}`;
      (document.body || document.documentElement).appendChild(probe);
      const px = parseFloat(getComputedStyle(probe).fontSize);
      probe.remove();
      return Number.isFinite(px) && px >= 8 ? Math.max(10, Math.min(24, px)) : 14;
    }

    function detectStrongContrast(bgLum: number | null, isDark: boolean): boolean {
      const cssVars = lastThemePayload?.cssVariables || {};
      const rawContrast = String(
        lastThemePayload?.contrast ||
        cssVars['--contrast'] ||
        cssVars['--high-contrast'] ||
        readRootVar(['--contrast', '--high-contrast']) ||
        '',
      ).trim();
      if (/strong|high|more|contrast/i.test(rawContrast) && !/default|normal|off|false|0/i.test(rawContrast)) {
        return true;
      }
      if (bgLum === null) return false;
      const borderRgba = sampleCssRgba('var(--card-border, var(--border))') || sampleCssRgba('var(--border)');
      if (!borderRgba) return false;
      const borderLum = relLum(borderRgba);
      if (borderRgba[3] >= 0.24) return true;
      if (borderLum === null) return false;
      const bgRgba = sampleCssRgba('var(--background)');
      if (!bgRgba) return false;
      const a = borderRgba[3];
      const blended: [number, number, number, number] = [
        borderRgba[0] * a + bgRgba[0] * (1 - a),
        borderRgba[1] * a + bgRgba[1] * (1 - a),
        borderRgba[2] * a + bgRgba[2] * (1 - a),
        1,
      ];
      const blendedLum = relLum(blended);
      if (blendedLum === null) return false;
      const delta = Math.abs(blendedLum - bgLum);
      return isDark ? delta >= 0.08 : delta >= 0.16;
    }

    function syncTheme(): void {
      try {
        const bgRgba = sampleCssRgba('var(--background)');
        const bgLum = relLum(bgRgba);
        const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
        const isDark = bgLum !== null ? bgLum < 0.45 : Boolean(prefersDark);
        const theme = isDark ? 'dark' : 'light';
        if (lastThemeState.theme !== theme || document.documentElement.dataset.theme !== theme) {
          lastThemeState.theme = theme;
          document.documentElement.dataset.theme = theme;
        }

        const contrast = detectStrongContrast(bgLum, isDark) ? 'strong' : 'default';
        if (lastThemeState.contrast !== contrast || document.documentElement.dataset.contrast !== contrast) {
          lastThemeState.contrast = contrast;
          document.documentElement.dataset.contrast = contrast;
        }

        let nextCard = '';
        const cardRgba = sampleCssRgba('var(--card)');
        const cardLum = relLum(cardRgba);
        if (bgLum !== null) {
          const flatOrInverted =
            !cardRgba ||
            cardRgba[3] < 0.85 ||
            cardLum === null ||
            (isDark ? cardLum <= bgLum + 0.008 : Math.abs(cardLum - bgLum) < 0.008);
          if (flatOrInverted) {
            nextCard = isDark ? 'color-mix(in srgb, var(--hud-fg) 3.5%, var(--hud-bg))' : '#ffffff';
          }
        }
        applyBodyVar('card', '--hud-card', nextCard);

        let nextAccentFg = '';
        let nextAccentInk = '';
        const priRgba = sampleCssRgba('var(--primary)');
        const priLum = relLum(priRgba);
        const priFgRgba = sampleCssRgba('var(--primary-foreground)');
        if (priLum !== null) {
          if (!priFgRgba || priFgRgba[3] < 0.85) {
            nextAccentFg = priLum > 0.44 ? '#111316' : '#ffffff';
          }
          if ((isDark && priLum < 0.22) || (!isDark && priLum > 0.36)) {
            nextAccentInk = 'color-mix(in srgb, var(--hud-accent) 68%, var(--hud-fg))';
          }
        }
        applyBodyVar('accentFg', '--hud-accent-fg', nextAccentFg);
        applyBodyVar('accentInk', '--hud-accent-ink', nextAccentInk);

        const cssVars = lastThemePayload?.cssVariables || {};
        const hasVarFont = Boolean(readRootVar(['--font-family', '--ui-font-family', '--vscode-font-family']));
        const payloadFont = String(lastThemePayload?.fontFamily || cssVars['--font-family'] || '').trim();
        const rootInlineFont = (document.documentElement?.style?.fontFamily || '').trim();
        const nextFont = !hasVarFont ? payloadFont || rootInlineFont : '';
        applyBodyVar('font', '--hud-font', nextFont);

        const hostPx = sampleHostFontPx();
        const scale = hostPx / 14;
        applyBodyVar('fontScale', '--hud-font-scale', Math.abs(scale - 1) < 0.005 ? '' : scale.toFixed(4));
      } catch {
        const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
        document.documentElement.dataset.theme = prefersDark ? 'dark' : 'light';
      }
    }

    let rootObs: MutationObserver | null = null;
    let headObs: MutationObserver | null = null;

    function scheduleSyncTheme(): void {
      if (themeTimer) return;
      themeTimer = setTimeout(() => {
        themeTimer = null;
        syncTheme();
        rootObs?.takeRecords?.();
        headObs?.takeRecords?.();
      }, 32);
    }

    syncTheme();
    rootObs = new MutationObserver(scheduleSyncTheme);
    rootObs.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });
    if (document.head) {
      headObs = new MutationObserver(scheduleSyncTheme);
      headObs.observe(document.head, { childList: true, subtree: true, characterData: true });
    }
    const mql = window.matchMedia?.('(prefers-color-scheme: dark)');
    mql?.addEventListener?.('change', scheduleSyncTheme);

    const onMessage = (event: MessageEvent) => {
      if (event?.data?.type === 'theme-change') {
        lastThemePayload = event.data.payload || null;
        scheduleSyncTheme();
      }
    };
    window.addEventListener?.('message', onMessage);

    return () => {
      if (themeTimer) clearTimeout(themeTimer);
      rootObs?.disconnect();
      headObs?.disconnect();
      mql?.removeEventListener?.('change', scheduleSyncTheme);
      window.removeEventListener?.('message', onMessage);
    };
  }, []);
}
