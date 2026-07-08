'use client';

import { useProjectStore } from '@/store/useProjectStore';
import { YEAR_COLOR_PALETTE, getEventColors, type YearColorConfig } from '@/lib/calendar/yearColors';

const YEAR_LABELS: { key: keyof YearColorConfig; label: string }[] = [
  { key: 'but1', label: 'BUT 1' },
  { key: 'but2', label: 'BUT 2' },
  { key: 'but3', label: 'BUT 3' },
];

export function YearColorBlock() {
  const yearColorConfig = useProjectStore((s) => s.yearColorConfig);
  const setYearColorConfig = useProjectStore((s) => s.setYearColorConfig);

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-6">
      <div>
        <h2 className="text-sm font-semibold mb-0.5">Thème couleur par année de BUT</h2>
        <p className="text-xs text-muted-foreground">
          Choisissez une couleur par année.
        </p>
      </div>

      {YEAR_LABELS.map(({ key, label }) => {
        const base = yearColorConfig[key];
        const level = key === 'but1' ? 0 : key === 'but2' ? 1 : 2;
        const cmColors = getEventColors(level, 'CM', yearColorConfig);
        const tdColors = getEventColors(level, 'TD', yearColorConfig);
        const tpColors = getEventColors(level, 'TP', yearColorConfig);
        return (
          <div key={key} className="space-y-2">
            <div className="flex items-center gap-3">
              <span className="text-xs font-medium w-12 shrink-0">{label}</span>
              <div className="flex gap-1">
                {[
                  { type: 'CM', colors: cmColors },
                  { type: 'TD', colors: tdColors },
                  { type: 'TP', colors: tpColors },
                ].map(({ type, colors }) => (
                  <span
                    key={type}
                    className="px-2 py-0.5 rounded text-[10px] font-medium border"
                    style={{
                      backgroundColor: colors.backgroundColor,
                      borderColor: colors.borderColor,
                      color: colors.textColor,
                    }}
                  >
                    {type}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 pl-12">
              {YEAR_COLOR_PALETTE.map((color) => (
                <button
                  key={color.value}
                  title={color.label}
                  onClick={() => setYearColorConfig({ ...yearColorConfig, [key]: color.value })}
                  className="w-6 h-6 rounded-full border-2 transition-all hover:scale-110 focus:outline-none focus:ring-2 focus:ring-ring"
                  style={{
                    backgroundColor: color.value,
                    borderColor: base === color.value ? '#1e293b' : 'transparent',
                    boxShadow: base === color.value ? '0 0 0 2px white, 0 0 0 3px #1e293b' : undefined,
                  }}
                  aria-label={`${color.label} pour ${label}`}
                  aria-pressed={base === color.value}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
