import { createContext, type ComponentChildren } from 'preact';
import { useContext, useEffect, useState } from 'preact/hooks';

const NowContext = createContext<number>(Date.now());

interface NowProviderProps {
  isActiveStep: boolean;
  clockSkewMs: number;
  children: ComponentChildren;
}

/**
 * Isolated live-clock context so 100ms/1s ticks only re-render clock-driven leaf components
 * (TopBar, PulseBar, HeroSpeedCards, LiveCallRow, ContextWindowCard, LiveQuotaCard, QuotaPoolsList)
 * instead of triggering full-tree re-renders across TrendChartCard and CallLogCard.
 */
export function NowProvider({ isActiveStep, clockSkewMs, children }: NowProviderProps) {
  const [tickNow, setTickNow] = useState<number>(() => Date.now());

  useEffect(() => {
    if (isActiveStep && !document.hidden) {
      setTickNow(Date.now());
    }
    const intervalMs = isActiveStep ? 100 : 1000;
    const id = setInterval(() => {
      if (!document.hidden) setTickNow(Date.now());
    }, intervalMs);
    return () => clearInterval(id);
  }, [isActiveStep]);

  return <NowContext.Provider value={tickNow - clockSkewMs}>{children}</NowContext.Provider>;
}

export function useNowMs(): number {
  return useContext(NowContext);
}
