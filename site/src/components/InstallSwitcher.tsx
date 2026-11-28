import { useEffect, useState } from 'preact/hooks';
import type { Locale, SiteCopy } from '../i18n/content';
import { IconCheck, IconCopy } from './Icons';

export type InstallMethod = 'unix' | 'windows' | 'agent' | 'manual';

function getCommand(method: InstallMethod, locale: Locale): { prompt: string; cmd: string; isPromptText?: boolean } {
  switch (method) {
    case 'unix':
      return {
        prompt: '$',
        cmd: 'curl -fsSL https://h.512.pub | sh',
      };
    case 'windows':
      return {
        prompt: 'PS>',
        cmd: 'irm https://h.512.pub | iex',
      };
    case 'agent':
      return {
        prompt: '>',
        cmd:
          locale === 'zh'
            ? '帮我按 https://h.512.pub/agent 安装 AGY-HUD 并验收。'
            : 'Install AGY-HUD following https://h.512.pub/agent and verify.',
        isPromptText: true,
      };
    case 'manual':
      return {
        prompt: '$',
        cmd: 'git clone https://github.com/skywalker512/agy-hud.git && node agy-hud/plugin/install.mjs',
      };
  }
}

function detectDefaultMethod(): InstallMethod {
  if (typeof navigator === 'undefined') return 'unix';
  const ua = `${navigator.userAgent || ''} ${navigator.platform || ''}`.toLowerCase();
  if (ua.includes('win')) return 'windows';
  return 'unix';
}

interface InstallSwitcherProps {
  locale: Locale;
  copy: SiteCopy;
  compact?: boolean;
}

export function InstallSwitcher({ locale, copy, compact = false }: InstallSwitcherProps) {
  const [detected] = useState<InstallMethod>(() => detectDefaultMethod());
  const [method, setMethod] = useState<InstallMethod>(detected);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(id);
  }, [copied]);

  const active = getCommand(method, locale);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(active.cmd);
      setCopied(true);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = active.cmd;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
    }
  };

  const tabs: Array<{ id: InstallMethod; label: string }> = [
    { id: 'unix', label: copy.hero.tabs.unix },
    { id: 'windows', label: copy.hero.tabs.windows },
    { id: 'agent', label: copy.hero.tabs.agent },
    { id: 'manual', label: copy.hero.tabs.manual },
  ];

  return (
    <div class="surface-card overflow-hidden rounded-xl">
      {/* Tab strip */}
      <div class="flex flex-wrap items-center justify-between gap-1 border-b border-[var(--border)] bg-[var(--surface-2)]/70 px-2 py-1.5">
        <div class="flex flex-wrap items-center gap-1" role="tablist" aria-label="Install method">
          {tabs.map((tab) => {
            const isActive = method === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => {
                  setMethod(tab.id);
                  setCopied(false);
                }}
                class={`inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors ${
                  isActive
                    ? 'bg-[var(--surface)] text-[var(--fg)] shadow-2xs ring-1 ring-[var(--border-strong)]'
                    : 'text-[var(--muted)] hover:text-[var(--fg)]'
                }`}
              >
                <span>{tab.label}</span>
                {tab.id === detected && (
                  <span
                    class="rounded px-1.5 py-px text-[9.5px] font-semibold"
                    style={{
                      backgroundColor: 'var(--tint-ok)',
                      color: 'var(--seg-cache)',
                    }}
                  >
                    {copy.hero.autoDetected}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Command or Agent prompt row */}
      <div class={`flex items-center gap-3 bg-[var(--surface)] ${compact ? 'px-3.5 py-2.5' : 'px-4 py-3.5'}`}>
        <span
          class="shrink-0 select-none font-mono text-[12px] font-semibold"
          style={{ color: active.isPromptText ? 'var(--accent-ink)' : 'var(--seg-cache)' }}
        >
          {active.prompt}
        </span>
        <div class="hud-scroll min-w-0 flex-1 overflow-x-auto">
          <code
            class={`block whitespace-nowrap text-[12.5px] leading-relaxed text-[var(--fg)] ${
              active.isPromptText ? 'font-sans' : 'font-mono'
            }`}
          >
            {active.cmd}
          </code>
        </div>
        <button
          type="button"
          onClick={handleCopy}
          class="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11.5px] font-medium transition-colors"
          style={
            copied
              ? {
                  backgroundColor: 'var(--tint-ok)',
                  borderColor: 'var(--tint-ok-border)',
                  color: 'var(--seg-cache)',
                }
              : {
                  backgroundColor: 'var(--surface-2)',
                  borderColor: 'var(--border)',
                  color: 'var(--fg-2)',
                }
          }
        >
          {copied ? (
            <>
              <IconCheck size={12} />
              <span>{copy.hero.copied}</span>
            </>
          ) : (
            <>
              <IconCopy size={12} />
              <span>{copy.hero.copy}</span>
            </>
          )}
        </button>
      </div>

      {/* Footnote */}
      <div class="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] bg-[var(--surface-2)]/45 px-4 py-2 text-[11px] text-[var(--muted)]">
        <span class={method === 'agent' ? 'font-sans' : 'font-mono text-[10.5px]'}>
          {method === 'agent' ? copy.hero.agentHint : copy.hero.doctorTip}
        </span>
        <span class="text-[var(--faint)]">{copy.hero.licenseTip}</span>
      </div>
    </div>
  );
}
