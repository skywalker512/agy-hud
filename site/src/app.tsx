import { useEffect, useState } from 'preact/hooks';
import { BentoGrid } from './components/BentoGrid';
import { CompareSection } from './components/CompareSection';
import { CraftSection } from './components/CraftSection';
import { DocsHub } from './components/DocsHub';
import { Footer } from './components/Footer';
import { HeroSection } from './components/HeroSection';
import { InstallGuideSection } from './components/InstallGuideSection';
import { Navbar } from './components/Navbar';
import { COPY, detectInitialLocale, saveLocale, type Locale } from './i18n/content';

const THEME_STORAGE_KEY = 'agy-hud-site-theme';

function getInitialTheme(): 'dark' | 'light' {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* ignore */
  }
  return 'dark';
}

export function App() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => getInitialTheme());
  const [locale, setLocale] = useState<Locale>(() => detectInitialLocale());

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute('content', theme === 'dark' ? '#0a0b0e' : '#fafafa');
    }
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
    document.title =
      locale === 'zh'
        ? 'AGY-HUD — 原生融入 Google Antigravity 的实时遥测驾驶舱'
        : 'AGY-HUD — Native Telemetry for Google Antigravity';
    saveLocale(locale);
  }, [locale]);

  const copy = COPY[locale];

  return (
    <div class="site-ambient min-h-screen text-[var(--fg)]">
      <Navbar
        locale={locale}
        theme={theme}
        copy={copy}
        onToggleLocale={() => setLocale((l) => (l === 'en' ? 'zh' : 'en'))}
        onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
      />

      <main>
        <HeroSection locale={locale} copy={copy} />
        <BentoGrid copy={copy} />
        <CraftSection copy={copy} />
        <InstallGuideSection locale={locale} copy={copy} />
        <CompareSection copy={copy} />
        <DocsHub copy={copy} />
      </main>

      <Footer copy={copy} />
    </div>
  );
}
