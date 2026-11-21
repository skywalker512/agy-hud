import { useEffect, useState } from 'preact/hooks';
import type { SiteCopy } from '../i18n/content';

export type InstallMethod = 'unix' | 'windows' | 'source' | 'devlink';

const COMMANDS: Record<InstallMethod, { prompt: string; cmd: string }> = {
  unix: {
    prompt: '$',
    cmd: 'curl -fsSL https://raw.githubusercontent.com/skywalker512/agy-hud/main/scripts/install.sh | sh',
  },
  windows: {
    prompt: 'PS>',
    cmd: 'irm https://raw.githubusercontent.com/skywalker512/agy-hud/main/scripts/install.ps1 | iex',
  },
  source: {
    prompt: '$',
    cmd: 'git clone https://github.com/skywalker512/agy-hud.git && node agy-hud/plugin/install.mjs',
  },
  devlink: {
    prompt: '$',
    cmd: 'node agy-hud/plugin/install.mjs --link',
  },
};

function detectDefaultMethod(): InstallMethod {
  if (typeof navigator === 'undefined') return 'unix';
  const ua = `${navigator.userAgent || ''} ${navigator.platform || ''}`.toLowerCase();
  if (ua.includes('win')) return 'windows';
  return 'unix';
}

interface InstallSwitcherProps {
  copy: SiteCopy;
  compact?: boolean;
}

export function InstallSwitcher({ copy, compact = false }: InstallSwitcherProps) {
  const [detected] = useState<InstallMethod>(() => detectDefaultMethod());
  const [method, setMethod] = useState<InstallMethod>(detected);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(id);
  }, [copied]);

  const active = COMMANDS[method];

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
    { id: 'source', label: copy.hero.tabs.source },
    { id: 'devlink', label: copy.hero.tabs.devlink },
  ];

  return (
    <div class="etched-card overflow-hidden rounded-xl">
      {/* Tab strip */}
      <div class="flex flex-wrap items-center justify-between gap-1 border-b border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5">
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
                class={`inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
                  isActive
                    ? 'bg-[var(--surface)] text-[var(--fg)] shadow-xs ring-1 ring-[var(--border-strong)]'
                    : 'text-[var(--muted)] hover:text-[var(--fg)]'
                }`}
              >
                <span>{tab.label}</span>
                {tab.id === detected && (
                  <span
                    class="rounded px-1 py-px font-mono text-[9.5px] font-semibold"
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

      {/* Command row */}
      <div class={`flex items-center gap-2.5 bg-[var(--surface)] ${compact ? 'px-3 py-2.5' : 'px-3.5 py-3'}`}>
        <span class="shrink-0 select-none font-mono text-[12px] font-semibold" style={{ color: 'var(--seg-cache)' }}>
          {active.prompt}
        </span>
        <div class="hud-scroll min-w-0 flex-1 overflow-x-auto">
          <code class="block whitespace-nowrap font-mono text-[12px] leading-relaxed text-[var(--fg)] sm:text-[12.5px]">
            {active.cmd}
          </code>
        </div>
        <button
          type="button"
          onClick={handleCopy}
          class="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-mono text-[11px] font-semibold transition-colors"
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
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M20 6 9 17l-5-5" />
              </svg>
              <span>{copy.hero.copied}</span>
            </>
          ) : (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="9" y="9" width="13" height="13" rx="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              <span>{copy.hero.copy}</span>
            </>
          )}
        </button>
      </div>

      {/* Footer footnote */}
      <div class="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] bg-[var(--surface-2)]/60 px-3.5 py-2 text-[11px] text-[var(--muted)]">
        <span class="font-mono text-[10.5px]">{copy.hero.doctorTip}</span>
        <span>{copy.hero.licenseTip}</span>
      </div>
    </div>
  );
}
