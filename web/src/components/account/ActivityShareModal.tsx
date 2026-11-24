import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { AccountHistory, DailyHeatmapDay } from '../../types/telemetry';
import { computeActivityInsights } from '../../utils/activityStats';
import { copyText } from '../../utils/clipboard';
import { buildWrappedTextReport, renderActivityPoster, type PosterThemeId } from '../../utils/posterCanvas';
import { IconCheck, IconCopy, IconDownload, IconX } from '../common/Icons';

interface ActivityShareModalProps {
  open: boolean;
  onClose: () => void;
  history: AccountHistory | undefined;
  initialSpan: '16w' | '52w';
  initialChartMode: 'heatmap' | 'iceberg';
  has52w: boolean;
  hasIceberg: boolean;
  isZh: boolean;
  tierLabel?: string;
}

export function ActivityShareModal({
  open,
  onClose,
  history,
  initialSpan,
  initialChartMode,
  has52w,
  hasIceberg,
  isZh,
  tierLabel,
}: ActivityShareModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [theme, setTheme] = useState<PosterThemeId>('cyber');
  const [span, setSpan] = useState<'16w' | '52w'>(initialSpan);
  const [chartMode, setChartMode] = useState<'heatmap' | 'iceberg'>(initialChartMode);
  const [hideSpend, setHideSpend] = useState<boolean>(false);
  const [statusMsg, setStatusMsg] = useState<string>('');
  const [copiedText, setCopiedText] = useState(false);
  const [copiedImg, setCopiedImg] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    setSpan(initialSpan);
    setChartMode(initialChartMode);
    setStatusMsg('');
  }, [open, initialSpan, initialChartMode]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const hm = history?.dailyHeatmap;
  const activeSpan: '16w' | '52w' = has52w ? span : '16w';
  const activeChart: 'heatmap' | 'iceberg' = hasIceberg ? chartMode : 'heatmap';

  const days = useMemo<DailyHeatmapDay[]>(() => {
    if (!hm) return [];
    if (activeSpan === '52w' && hm.days52 && hm.days52.length > 0) return hm.days52;
    return hm.days || [];
  }, [hm, activeSpan]);

  const weeks = useMemo(() => {
    if (!hm) return 16;
    return activeSpan === '52w'
      ? hm.weeks52 || Math.ceil(days.length / 7)
      : hm.weeks || Math.ceil(days.length / 7);
  }, [hm, activeSpan, days.length]);

  const insights = useMemo(
    () => computeActivityInsights(days, history, hm?.streakDays),
    [days, history, hm?.streakDays],
  );

  useEffect(() => {
    if (!open || !canvasRef.current || days.length === 0) return;
    renderActivityPoster(canvasRef.current, {
      theme,
      span: activeSpan,
      chartMode: activeChart,
      hideSpend,
      isZh,
      days,
      weeks,
      insights,
      tierLabel,
    });
  }, [open, theme, activeSpan, activeChart, hideSpend, isZh, days, weeks, insights, tierLabel]);

  if (!open || !hm) return null;

  const flashStatus = (msg: string) => {
    setStatusMsg(msg);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setStatusMsg(''), 2200);
  };

  const handleDownloadPng = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `agy-hud-wrapped-${activeSpan}-${new Date().toISOString().slice(0, 10)}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    flashStatus(isZh ? '已保存 2x 高清战报 PNG' : 'Saved 2x PNG poster');
  };

  const handleCopyPng = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('no-blob');
      const CItem = (window as any).ClipboardItem;
      if (navigator.clipboard?.write && CItem) {
        await navigator.clipboard.write([new CItem({ 'image/png': blob })]);
        setCopiedImg(true);
        setTimeout(() => setCopiedImg(false), 1600);
        flashStatus(isZh ? '已复制高清 PNG，可直接粘贴发群/发推' : 'PNG copied to clipboard!');
        return;
      }
      throw new Error('clipboard-img-unsupported');
    } catch {
      // Fallback: download PNG cleanly when iframe blocks binary clipboard write
      handleDownloadPng();
      flashStatus(isZh ? '当前环境限制图片剪贴板，已自动保存 PNG 文件' : 'Clipboard image blocked; downloaded PNG instead');
    }
  };

  const handleCopyText = async () => {
    const text = buildWrappedTextReport({ insights, span: activeSpan, hideSpend, isZh, tierLabel });
    const ok = await copyText(text);
    if (!ok) return;
    setCopiedText(true);
    setTimeout(() => setCopiedText(false), 1500);
    flashStatus(isZh ? '已复制文字战报' : 'Text summary copied');
  };

  const themes: Array<{ id: PosterThemeId; label: string; dot: string }> = [
    { id: 'cyber', label: isZh ? '暗夜霓虹' : 'Cyber', dot: '#34D399' },
    { id: 'gold', label: isZh ? '黑金 Ultra' : 'Gold', dot: '#F5C451' },
    { id: 'light', label: isZh ? '极简白' : 'Light', dot: '#E2E8F0' },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-2.5 bg-black/60 backdrop-blur-[3px]"
      role="dialog"
      aria-modal="true"
      aria-label={isZh ? '生成分享战报' : 'Share Wrapped Poster'}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[440px] max-h-[92vh] overflow-y-auto rounded-xl bg-hud-card border border-hud-border shadow-2xl p-3 flex flex-col gap-2.5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="font-hud text-[12px] font-bold text-hud-fg truncate">
              {isZh ? '✨ 一键生成分享战报' : '✨ Wrapped Share Poster'}
            </span>
            <span className="px-1.5 py-[0.5px] rounded-full bg-hud-fill font-hud-mono text-[9px] text-hud-muted">
              2x PNG
            </span>
          </div>
          <button
            type="button"
            className="collapse-btn"
            aria-label="Close"
            onClick={onClose}
          >
            <IconX size={12} />
          </button>
        </div>

        {/* Customization controls */}
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          {/* Theme selector */}
          <div className="flex items-center gap-1">
            {themes.map((th) => (
              <button
                key={th.id}
                type="button"
                onClick={() => setTheme(th.id)}
                className={`inline-flex items-center gap-1 px-2 py-[3px] rounded-full border font-hud text-[10px] cursor-pointer transition-colors ${
                  theme === th.id
                    ? 'bg-hud-surface-2 border-hud-accent text-hud-fg font-semibold'
                    : 'bg-hud-fill/60 border-transparent text-hud-muted hover:text-hud-fg'
                }`}
              >
                <span className="w-2 h-2 rounded-full border border-black/15" style={{ background: th.dot }} />
                <span>{th.label}</span>
              </button>
            ))}
          </div>

          {/* Span + Chart + Privacy */}
          <div className="flex flex-wrap items-center gap-1">
            {has52w && (
              <div className="metric-tabs">
                <button
                  type="button"
                  className={`metric-tab font-hud-mono${activeSpan === '16w' ? ' is-active' : ''}`}
                  onClick={() => setSpan('16w')}
                >
                  16w
                </button>
                <button
                  type="button"
                  className={`metric-tab font-hud-mono${activeSpan === '52w' ? ' is-active' : ''}`}
                  onClick={() => setSpan('52w')}
                >
                  52w
                </button>
              </div>
            )}
            {hasIceberg && (
              <div className="metric-tabs">
                <button
                  type="button"
                  className={`metric-tab${activeChart === 'heatmap' ? ' is-active' : ''}`}
                  onClick={() => setChartMode('heatmap')}
                >
                  {isZh ? '热力' : 'Grid'}
                </button>
                <button
                  type="button"
                  className={`metric-tab${activeChart === 'iceberg' ? ' is-active' : ''}`}
                  onClick={() => setChartMode('iceberg')}
                >
                  {isZh ? '冰山' : 'Ice'}
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={() => setHideSpend((v) => !v)}
              className={`px-1.5 py-[2.5px] rounded border font-hud text-[9.5px] cursor-pointer transition-colors ${
                hideSpend
                  ? 'bg-tint-accent border-tint-accent-border text-hud-accent-ink font-semibold'
                  : 'bg-hud-fill border-transparent text-hud-muted hover:text-hud-fg'
              }`}
            >
              {hideSpend ? (isZh ? '已隐金额' : '$ Hidden') : isZh ? '隐藏金额' : 'Hide $'}
            </button>
          </div>
        </div>

        {/* Live 2x Canvas Preview */}
        <div className="l2-well p-1.5 flex items-center justify-center overflow-hidden">
          <canvas
            ref={canvasRef}
            className="w-full max-w-[360px] h-auto rounded-lg shadow-md block"
            style={{ aspectRatio: '1200 / 1480' }}
          />
        </div>

        {/* Export actions */}
        <div className="narrow-grid-2 grid grid-cols-3 gap-1.5">
          <button
            type="button"
            className="inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-hud-accent text-hud-accent-fg font-hud text-[10.5px] font-semibold cursor-pointer hover:opacity-90 transition-opacity"
            onClick={() => void handleCopyPng()}
          >
            {copiedImg ? <IconCheck size={11} /> : <IconCopy size={11} />}
            <span>{copiedImg ? (isZh ? '已复制' : 'Copied') : isZh ? '复制海报' : 'Copy PNG'}</span>
          </button>
          <button
            type="button"
            className="inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-hud-surface-2 border border-hud-border text-hud-fg font-hud text-[10.5px] font-semibold cursor-pointer hover:border-hud-accent transition-colors"
            onClick={handleDownloadPng}
          >
            <IconDownload size={11} />
            <span>{isZh ? '保存 PNG' : 'Save PNG'}</span>
          </button>
          <button
            type="button"
            className="inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-hud-fill text-hud-fg/90 font-hud text-[10.5px] font-medium cursor-pointer hover:bg-hud-surface-2 transition-colors"
            onClick={handleCopyText}
          >
            {copiedText ? <IconCheck size={11} className="text-hud-ok" /> : <IconCopy size={11} />}
            <span>{copiedText ? (isZh ? '已复制' : 'Copied') : isZh ? '文字战报' : 'Copy Text'}</span>
          </button>
        </div>

        {statusMsg && (
          <div className="text-center font-hud text-[10px] text-hud-ok font-medium">
            {statusMsg}
          </div>
        )}
      </div>
    </div>
  );
}
