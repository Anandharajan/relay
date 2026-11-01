import type { KeyboardEvent, ReactNode } from "react";
import type { Tab } from "./model";
export function PaneTabs({
  tabs,
  tab,
  setTab,
}: {
  tabs: { id: Tab; label: string; marker?: ReactNode }[];
  tab: Tab;
  setTab: (t: Tab) => void;
}) {
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    const next = tabs[(i + step + tabs.length) % tabs.length];
    setTab(next.id);
    document.getElementById(`vd-tab-${next.id}`)?.focus();
  };
  return (
    <div className="vd-tabs" role="tablist" aria-label="Agents pane">
      {tabs.map((t, i) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          id={`vd-tab-${t.id}`}
          aria-selected={tab === t.id}
          aria-controls={`vd-panel-${t.id}`}
          tabIndex={tab === t.id ? 0 : -1}
          onKeyDown={(e) => onKey(e, i)}
          onClick={() => setTab(t.id)}
        >
          {t.label} {t.marker}
        </button>
      ))}
    </div>
  );
}
