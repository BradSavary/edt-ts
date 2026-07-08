'use client';

import { useState } from 'react';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { fetchSchoolHolidayConfig, getAvailableSchoolYears, type SchoolYearConfig } from '@/lib/schoolHolidays';

type LoadStatus = 'idle' | 'loading' | 'success' | 'error';

const ZONES = ['A', 'B', 'C'] as const;

interface SchoolYearPickerProps {
  /** Configuration déjà chargée à afficher/pré-sélectionner (ex: projet existant). Absent = premier chargement (ex: création de projet). */
  initialConfig?: SchoolYearConfig | null;
  /** Appelé avec la configuration chargée avec succès — au wizard/appelant de décider où la stocker. */
  onLoaded: (config: SchoolYearConfig) => void;
}

/**
 * Composant contrôlé : ne lit/n'écrit jamais un store directement.
 * Extrait de l'ancien `SchoolYearBlock.tsx` pour être réutilisable à la fois dans
 * l'assistant de création de projet (état local, rien n'est encore persisté) et
 * dans les paramètres du projet actif (`SchoolYearBlock`, thin wrapper autour de ce composant).
 */
export function SchoolYearPicker({ initialConfig, onLoaded }: SchoolYearPickerProps) {
  const availableYears = getAvailableSchoolYears();
  const [selectedYear, setSelectedYear] = useState<string>(
    initialConfig?.year ?? availableYears[1] ?? availableYears[0] ?? '',
  );
  const [selectedZone, setSelectedZone] = useState<'A' | 'B' | 'C'>(
    initialConfig?.zone ?? 'A',
  );
  const [loadedConfig, setLoadedConfig] = useState<SchoolYearConfig | null>(initialConfig ?? null);
  const [status, setStatus] = useState<LoadStatus>('idle');
  const [errorMsg, setErrorMsg] = useState<string>('');

  async function handleLoad() {
    setStatus('loading');
    setErrorMsg('');
    try {
      const config: SchoolYearConfig = await fetchSchoolHolidayConfig(selectedYear, selectedZone);
      setLoadedConfig(config);
      onLoaded(config);
      setStatus('success');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  }

  const isLoaded =
    loadedConfig !== null &&
    loadedConfig.year === selectedYear &&
    loadedConfig.zone === selectedZone;

  const vacationCount = loadedConfig?.periods.filter((p) => p.type === 'vacation').length ?? 0;
  const holidayCount = loadedConfig?.periods.filter((p) => p.type === 'public-holiday').length ?? 0;

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-6">
      <div>
        <h2 className="text-sm font-semibold mb-0.5">Année scolaire &amp; vacances</h2>
        <p className="text-xs text-muted-foreground">
          Charge automatiquement les vacances scolaires et jours fériés comme zones visuelles dans le calendrier.
        </p>
      </div>

      {/* Sélecteur d'année scolaire */}
      <div className="space-y-1.5">
        <Label>Année scolaire</Label>
        <select
          value={selectedYear}
          onChange={(e) => setSelectedYear(e.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {availableYears.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      {/* Sélecteur de zone */}
      <div className="space-y-1.5">
        <Label>Zone de vacances scolaires</Label>
        <div className="flex gap-3">
          {ZONES.map((z) => (
            <label key={z} className="flex items-center gap-1.5 cursor-pointer text-sm">
              <input
                type="radio"
                name="school-zone"
                value={z}
                checked={selectedZone === z}
                onChange={() => setSelectedZone(z)}
                className="accent-primary"
              />
              Zone {z}
            </label>
          ))}
        </div>
      </div>

      {/* Bouton charger */}
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          onClick={handleLoad}
          disabled={status === 'loading'}
        >
          {status === 'loading' ? 'Chargement…' : 'Charger les données'}
        </Button>
      </div>

      {/* Statut */}
      {status === 'error' && (
        <div className="flex items-start gap-2 rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-3 py-2">
          <span className="text-red-600 dark:text-red-400 text-xs shrink-0">❌</span>
          <span className="text-xs text-red-700 dark:text-red-300">{errorMsg}</span>
        </div>
      )}

      {isLoaded && status !== 'error' && (
        <div className="flex items-center gap-2 rounded-md border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30 px-3 py-2">
          <span className="text-green-600 dark:text-green-400 text-xs shrink-0">✅</span>
          <span className="text-xs text-green-700 dark:text-green-300">
            <span className="font-medium">{loadedConfig!.year} — Zone {loadedConfig!.zone}</span>
            {' · '}
            {vacationCount} période{vacationCount > 1 ? 's' : ''} de vacances
            {' · '}
            {holidayCount} jour{holidayCount > 1 ? 's' : ''} férié{holidayCount > 1 ? 's' : ''}
          </span>
        </div>
      )}

      {!isLoaded && loadedConfig && status !== 'loading' && status !== 'error' && (
        <div className="flex items-center gap-2 rounded-md border border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-950/30 px-3 py-2">
          <span className="text-yellow-600 dark:text-yellow-400 text-xs shrink-0">⚠️</span>
          <span className="text-xs text-yellow-700 dark:text-yellow-300">
            Données chargées pour {loadedConfig.year} — Zone {loadedConfig.zone}. Cliquez &laquo; Charger &raquo; pour mettre à jour.
          </span>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Les zones s&apos;affichent dans le calendrier à chaque changement de semaine et sont supprimables individuellement.
        Sources : <span className="font-medium">data.education.gouv.fr</span> · <span className="font-medium">calendrier.api.gouv.fr</span>
      </p>
    </div>
  );
}
