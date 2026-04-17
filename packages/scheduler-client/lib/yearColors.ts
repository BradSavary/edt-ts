/**
 * Utilitaires de thème de couleur par année de BUT.
 * Les couleurs sont déclinées en 3 variantes selon le type de séance :
 *   CM (claire), TD (normale), TP (sombre).
 */

export interface YearColorConfig {
  but1: string; // couleur base BUT1 (hex)
  but2: string; // couleur base BUT2 (hex)
  but3: string; // couleur base BUT3 (hex)
}

export const DEFAULT_YEAR_COLORS: YearColorConfig = {
  but1: '#93c5fd', // bleu pastel
  but2: '#fcd34d', // ambre pastel
  but3: '#6ee7b7', // émeraude pastel
};

/** Palette fixe de couleurs proposées à l'utilisateur. */
export const YEAR_COLOR_PALETTE: { label: string; value: string }[] = [
  { label: 'Bleu', value: '#93c5fd' },
  { label: 'Ambre', value: '#fcd34d' },
  { label: 'Émeraude', value: '#6ee7b7' },
  { label: 'Ardoise', value: '#94a3b8' },
  { label: 'Cyan', value: '#67e8f9' },
  { label: 'Lavande', value: '#d8b4fe' },
  { label: 'Fraise', value: '#fda4af' },

];

/**
 * Déduit le niveau BUT (0=BUT1, 1=BUT2, 2=BUT3) depuis le préfixe du code cours.
 * Convention : le premier chiffre trouvé dans le code détermine l'année :
 *   1 ou 2 → BUT1, 3 ou 4 → BUT2, 5 ou 6+ → BUT3.
 * Exemples : R1.12 → 0, SAE2.01 → 0, R3.05 → 1, R4.02 → 1, R5.01 → 2, PORTFOLIO6.01 → 2
 */
export function levelFromCode(code: string): 0 | 1 | 2 {
  const m = code.match(/\d+/);
  if (!m) return 0;
  const n = parseInt(m[0], 10);
  if (n <= 2) return 0;
  if (n <= 4) return 1;
  return 2;
}

// ── Utilitaires de manipulation de couleurs ──────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** Convertit RGB en HSL. Retourne [h: 0-360, s: 0-100, l: 0-100]. */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const r1 = r / 255, g1 = g / 255, b1 = b / 255;
  const max = Math.max(r1, g1, b1), min = Math.min(r1, g1, b1);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r1) h = ((g1 - b1) / d + (g1 < b1 ? 6 : 0)) / 6;
  else if (max === g1) h = ((b1 - r1) / d + 2) / 6;
  else h = ((r1 - g1) / d + 4) / 6;
  return [h * 360, s * 100, l * 100];
}

function hslToHex(h: number, s: number, l: number): string {
  const s1 = s / 100, l1 = l / 100;
  const a = s1 * Math.min(l1, 1 - l1);
  function f(n: number): string {
    const k = (n + h / 30) % 12;
    const color = l1 - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  }
  return `#${f(0)}${f(8)}${f(4)}`;
}

function adjustLightness(hex: string, delta: number): string {
  const [r, g, b] = hexToRgb(hex);
  const [h, s, l] = rgbToHsl(r, g, b);
  return hslToHex(h, s, Math.max(0, Math.min(100, l + delta)));
}

function getTextColor(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luma > 0.6 ? '#1e293b' : '#ffffff';
}

// ── API publique ──────────────────────────────────────────────────────────

export interface EventColors {
  backgroundColor: string;
  borderColor: string;
  textColor: string;
}

/**
 * Retourne les couleurs d'un événement calendrier selon le niveau BUT,
 * le type de séance et la configuration utilisateur.
 *
 * CM → variante claire (+12% lightness)
 * TD → couleur de base
 * TP → variante sombre (-12% lightness)
 * Autres types → même traitement que CM
 */
export function getEventColors(
  level: 0 | 1 | 2,
  type: string,
  config: YearColorConfig,
): EventColors {
  const base = [config.but1, config.but2, config.but3][level];
  const t = type.toUpperCase().trim();
  let bg: string;
  if (t === 'TD') {
    bg = base;
  } else if (t === 'TP') {
    bg = adjustLightness(base, -14);
  } else {
    // CM ou type inconnu → variante claire
    bg = adjustLightness(base, 12);
  }
  return {
    backgroundColor: bg,
    borderColor: adjustLightness(bg, -10),
    textColor: getTextColor(bg),
  };
}
