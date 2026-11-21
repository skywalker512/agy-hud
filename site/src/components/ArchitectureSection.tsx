import type { SiteCopy } from '../i18n/content';

interface ArchitectureSectionProps {
  copy: SiteCopy;
}

export function ArchitectureSection({ copy }: ArchitectureSectionProps) {
  const a = copy.arch;

  return (
    <section class="border-y border-[var(--border)] bg-[var(--surface)]/40 py-16 sm:py-22">
      <div class="mx-auto max-w-6xl px-4 sm:px-6">
        <div class="max-w-2xl">
          <div class="font-mono text-[11.5px] font-semibold uppercase tracking-widest" style={{ color: 'var(--seg-cache)' }}>
            {a.kicker}
          </div>
          <h2 class="display-heading mt-2 text-2xl font-bold text-[var(--fg)] sm:text-4xl">
            {a.title}
          </h2>
          <p class="mt-3 text-[15px] leading-relaxed text-[var(--muted)]">{a.subtitle}</p>
        </div>

        {/* Crisp Horizontal Zero-Proxy Architecture Diagram (SVG + Responsive Flow) */}
        <div class="etched-card mt-10 overflow-hidden rounded-2xl p-4 sm:p-6">
          <div class="overflow-x-auto">
            <svg
              viewBox="0 0 960 276"
              class="mx-auto block h-auto w-full min-w-[680px]"
              role="img"
              aria-label="AGY-HUD Local-First Zero-Proxy Architecture"
            >
              <defs>
                <marker id="arrowHead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="var(--muted)" />
                </marker>
                <marker id="arrowGreen" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="var(--seg-cache)" />
                </marker>
              </defs>

              {/* Left Column Container */}
              <rect x="12" y="14" width="320" height="248" rx="14" fill="var(--surface-2)" stroke="var(--border)" />
              <text x="28" y="38" fill="var(--muted)" font-size="11" font-family="var(--font-mono)" font-weight="600">
                {a.sourcesTitle.toUpperCase()}
              </text>

              {/* Source 1: SQLite */}
              <rect x="24" y="52" width="296" height="60" rx="10" fill="var(--surface)" stroke="var(--border-strong)" />
              <circle cx="42" cy="74" r="4.5" fill="var(--seg-input)" />
              <text x="54" y="78" fill="var(--fg)" font-size="12.5" font-family="var(--font-sans)" font-weight="700">
                {a.src1Title}
              </text>
              <text x="54" y="97" fill="var(--muted)" font-size="10.2" font-family="var(--font-mono)">
                ~/.gemini/.../conversations/*.db
              </text>

              {/* Source 2: LS RPC */}
              <rect x="24" y="122" width="296" height="60" rx="10" fill="var(--surface)" stroke="var(--border-strong)" />
              <circle cx="42" cy="144" r="4.5" fill="var(--seg-out)" />
              <text x="54" y="148" fill="var(--fg)" font-size="12.5" font-family="var(--font-sans)" font-weight="700">
                {a.src2Title}
              </text>
              <text x="54" y="167" fill="var(--muted)" font-size="10.2" font-family="var(--font-mono)">
                127.0.0.1 live steps + 5h/7d quota
              </text>

              {/* Source 3: Swarm JSON */}
              <rect x="24" y="192" width="296" height="60" rx="10" fill="var(--surface)" stroke="var(--border-strong)" />
              <circle cx="42" cy="214" r="4.5" fill="var(--seg-think)" />
              <text x="54" y="218" fill="var(--fg)" font-size="12.5" font-family="var(--font-sans)" font-weight="700">
                {a.src3Title}
              </text>
              <text x="54" y="237" fill="var(--muted)" font-size="10.2" font-family="var(--font-mono)">
                swarm · members · plan · board.jsonl
              </text>

              {/* Connectors: Left -> Center */}
              <path d="M 320 82 C 360 82, 360 124, 404 124" fill="none" stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="4 3" marker-end="url(#arrowHead)" />
              <path d="M 320 152 L 404 142" fill="none" stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="4 3" marker-end="url(#arrowHead)" />
              <path d="M 320 222 C 360 222, 360 162, 404 162" fill="none" stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="4 3" marker-end="url(#arrowHead)" />
              <text x="362" y="250" text-anchor="middle" fill="var(--faint)" font-size="10" font-family="var(--font-mono)">
                {a.readOnlyLabel}
              </text>

              {/* Center Node: AGY-HUD Sidecar */}
              <rect x="412" y="64" width="234" height="156" rx="14" fill="var(--surface-2)" stroke="var(--seg-cache)" stroke-width="1.5" />
              <rect x="428" y="80" width="128" height="22" rx="11" fill="var(--tint-ok)" stroke="var(--tint-ok-border)" />
              <text x="492" y="95" text-anchor="middle" fill="var(--seg-cache)" font-size="10" font-family="var(--font-mono)" font-weight="700">
                {a.coreBadge}
              </text>
              <text x="428" y="128" fill="var(--fg)" font-size="15.5" font-family="var(--font-sans)" font-weight="800">
                {a.coreTitle}
              </text>
              <text x="428" y="149" fill="var(--fg-2)" font-size="11" font-family="var(--font-mono)">
                Node 22.18+ node:sqlite
              </text>
              <text x="428" y="168" fill="var(--muted)" font-size="10.5" font-family="var(--font-mono)">
                Protobuf f19 · k-Fitter
              </text>
              <text x="428" y="187" fill="var(--muted)" font-size="10.5" font-family="var(--font-mono)">
                0 runtime deps · mtime cache
              </text>

              {/* Connector: Center -> Right */}
              <path d="M 646 142 L 716 142" fill="none" stroke="var(--seg-cache)" stroke-width="1.8" marker-end="url(#arrowGreen)" />
              <text x="681" y="128" text-anchor="middle" fill="var(--seg-cache)" font-size="9.5" font-family="var(--font-mono)" font-weight="600">
                ETag
              </text>
              <text x="681" y="160" text-anchor="middle" fill="var(--faint)" font-size="9" font-family="var(--font-mono)">
                500ms / 1.5s
              </text>

              {/* Right Node: Side-Pane HUD */}
              <rect x="724" y="64" width="224" height="156" rx="14" fill="var(--surface-2)" stroke="var(--accent)" stroke-width="1.5" />
              <rect x="740" y="80" width="122" height="22" rx="11" fill="var(--tint-accent)" stroke="var(--tint-accent-border)" />
              <text x="801" y="95" text-anchor="middle" fill="var(--accent-ink)" font-size="10" font-family="var(--font-mono)" font-weight="700">
                {a.uiBadge}
              </text>
              <text x="740" y="128" fill="var(--fg)" font-size="15.5" font-family="var(--font-sans)" font-weight="800">
                {a.uiTitle}
              </text>
              <text x="740" y="149" fill="var(--fg-2)" font-size="11" font-family="var(--font-mono)">
                Preact + Tailwind v4
              </text>
              <text x="740" y="168" fill="var(--muted)" font-size="10.5" font-family="var(--font-mono)">
                Live · Calls · Account
              </text>
              <text x="740" y="187" fill="var(--muted)" font-size="10.5" font-family="var(--font-mono)">
                Dark/Light · EN / 中文
              </text>
            </svg>
          </div>
        </div>

        {/* 4 Security & Privacy Guarantees */}
        <div class="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {a.pillars.map((p, idx) => (
            <div key={p.title} class="etched-card rounded-xl p-4">
              <div class="flex items-center gap-2">
                <span
                  class="flex h-6 w-6 items-center justify-center rounded-md font-mono text-[11px] font-bold"
                  style={{
                    backgroundColor: idx % 2 === 0 ? 'var(--tint-ok)' : 'var(--tint-accent)',
                    color: idx % 2 === 0 ? 'var(--seg-cache)' : 'var(--accent-ink)',
                  }}
                >
                  ✓
                </span>
                <h3 class="text-[13.5px] font-bold text-[var(--fg)]">{p.title}</h3>
              </div>
              <p class="mt-2 text-[12.5px] leading-relaxed text-[var(--muted)]">{p.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
