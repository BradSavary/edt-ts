'use client';

import { useSchedulerStore } from '@/store/useSchedulerStore';

const DEFAULT_THRESHOLD = 0.175;

export function TightThresholdBlock() {
  const tightThreshold = useSchedulerStore((s) => s.tightThreshold);
  const setTightThreshold = useSchedulerStore((s) => s.setTightThreshold);

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-6">
      <div>
        <h2 className="text-sm font-semibold mb-0.5">Analyse des contraintes pré-planification</h2>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Un seuil plus bas augmentera le nombre de ressources considérées comme tendues.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <input
          type="number"
          min={0.01}
          max={0.99}
          step={0.005}
          value={tightThreshold}
          onChange={(e) => {
            if (e.target.value === '') {
              setTightThreshold(DEFAULT_THRESHOLD);
              return;
            }
            setTightThreshold(parseFloat(e.target.value));
          }}
          className="w-24 rounded-md border border-input bg-background px-2 py-1 text-sm text-center tabular-nums focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <span className="text-xs text-muted-foreground">(défaut : {DEFAULT_THRESHOLD})</span>
        {tightThreshold !== DEFAULT_THRESHOLD && (
          <button
            onClick={() => setTightThreshold(DEFAULT_THRESHOLD)}
            className="text-xs text-muted-foreground underline hover:text-foreground"
          >
            Réinitialiser
          </button>
        )}
      </div>
    </div>
  );
}
