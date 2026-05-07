'use client';

import { useSchedulerStore } from '@/store/useSchedulerStore';

const DEFAULT_TIGHT = 0.5;
const DEFAULT_CRITICAL = 0.85;

export function TightThresholdBlock() {
  const tightThreshold = useSchedulerStore((s) => s.tightThreshold);
  const setTightThreshold = useSchedulerStore((s) => s.setTightThreshold);
  const criticalThreshold = useSchedulerStore((s) => s.criticalThreshold);
  const setCriticalThreshold = useSchedulerStore((s) => s.setCriticalThreshold);

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-6">
      <div>
        <h2 className="text-sm font-semibold mb-0.5">Analyse des contraintes pré-planification</h2>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Seuil de tri des cours en "tendu" ou "critique". Plus la valeur est basse, plus les cours seront considérés comme contraints.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground w-20">Tendu ≥</span>
          <input
            type="number"
            min={0.01}
            max={0.99}
            value={tightThreshold}
            onChange={(e) => {
              if (e.target.value === '') { setTightThreshold(DEFAULT_TIGHT); return; }
              setTightThreshold(parseFloat(e.target.value));
            }}
            className="w-24 rounded-md border border-input bg-background px-2 py-1 text-sm text-center tabular-nums focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <span className="text-xs text-muted-foreground">(défaut : {DEFAULT_TIGHT})</span>
          {tightThreshold !== DEFAULT_TIGHT && (
            <button
              onClick={() => setTightThreshold(DEFAULT_TIGHT)}
              className="text-xs text-muted-foreground underline hover:text-foreground"
            >
              Réinitialiser
            </button>
          )}
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground w-20">Critique ≥</span>
          <input
            type="number"
            min={0.01}
            max={0.99}
            value={criticalThreshold}
            onChange={(e) => {
              if (e.target.value === '') { setCriticalThreshold(DEFAULT_CRITICAL); return; }
              setCriticalThreshold(parseFloat(e.target.value));
            }}
            className="w-24 rounded-md border border-input bg-background px-2 py-1 text-sm text-center tabular-nums focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <span className="text-xs text-muted-foreground">(défaut : {DEFAULT_CRITICAL})</span>
          {criticalThreshold !== DEFAULT_CRITICAL && (
            <button
              onClick={() => setCriticalThreshold(DEFAULT_CRITICAL)}
              className="text-xs text-muted-foreground underline hover:text-foreground"
            >
              Réinitialiser
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
