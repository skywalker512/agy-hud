import { useCallback, useEffect, useState } from 'preact/hooks';
import { Footer } from './components/Footer';
import { HeroSection } from './components/HeroSection';
import { HighlightsSection } from './components/HighlightsSection';
import { Navbar } from './components/Navbar';
import { COPY, detectInitialLocale, saveLocale, type Locale } from './i18n/content';
import {
  AGY_THEMES,
  applyAgyThemeToDocument,
  getInitialContrast,
  getInitialThemeId,
  getThemeById,
  saveContrast,
  saveThemeId,
  type ContrastMode,
} from './themes/agyThemes';

export function App() {
  const [themeId, setThemeId] = useState<string>(() => getInitialThemeId());
  const [previewThemeId, setPreviewThemeId] = useState<string | null>(null);
  const [contrast, setContrast] = useState<ContrastMode>(() => getInitialContrast());
  const [locale, setLocale] = useState<Locale>(() => detectInitialLocale());

  const activeTheme = getThemeById(themeId);
  const displayTheme = previewThemeId ? getThemeById(previewThemeId) : activeTheme;

  useEffect(() => {
    applyAgyThemeToDocument(displayTheme, contrast);
  }, [displayTheme, contrast]);

  useEffect(() => {
    saveThemeId(themeId);
  }, [themeId]);

  useEffect(() => {
    saveContrast(contrast);
  }, [contrast]);

  useEffect(() => {
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
    document.title =
      locale === 'zh'
        ? 'AGY-HUD — Google Antigravity 原生遥测侧边栏'
        : 'AGY-HUD — Native Telemetry for Google Antigravity';
    saveLocale(locale);
  }, [locale]);

  const handleCycleTheme = useCallback(() => {
    setThemeId((curr) => {
      const idx = AGY_THEMES.findIndex((t) => t.id === curr);
      const next = AGY_THEMES[(idx + 1) % AGY_THEMES.length];
      return next.id;
    });
  }, []);

  const copy = COPY[locale];

  return (
    <div class="site-ambient min-h-screen text-[var(--fg)]">
      <Navbar
        locale={locale}
        activeTheme={activeTheme}
        contrast={contrast}
        copy={copy}
        onToggleLocale={() => setLocale((l) => (l === 'en' ? 'zh' : 'en'))}
        onSelectTheme={setThemeId}
        onPreviewTheme={setPreviewThemeId}
        onSelectContrast={setContrast}
      />

      <main>
        <HeroSection
          locale={locale}
          theme={displayTheme}
          contrast={contrast}
          copy={copy}
          onCycleTheme={handleCycleTheme}
        />
        <HighlightsSection copy={copy} />
      </main>

      <Footer locale={locale} copy={copy} />
    </div>
  );
}
