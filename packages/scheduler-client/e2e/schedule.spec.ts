import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';

// ─── Helpers fixtures ────────────────────────────────────────────────────────

/** Crée un fichier JSON temporaire et retourne son chemin absolu. */
function tmpJson(content: unknown): string {
  const file = path.join(os.tmpdir(), `test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(file, JSON.stringify(content));
  return file;
}

/** Crée un fichier CSV temporaire et retourne son chemin absolu. */
function tmpCsv(content: string): string {
  const file = path.join(os.tmpdir(), `test-${Date.now()}-${Math.random().toString(36).slice(2)}.csv`);
  fs.writeFileSync(file, content);
  return file;
}

const RESOURCES_FIXTURE = [
  { resourceType: 'teacher', resources: [{ id: 'DUPONT Jean' }, { id: 'MARTIN Paul' }] },
  { resourceType: 'room', resources: [{ id: 'A101' }, { id: 'B201' }] },
];

const CSV_S47 = [
  'Semestre,Parcours,Code,Enseignement,Intervenant,Nature,Groupes,Salles,S46,S47,S48',
  'S1,INFO,R101,Algorithmique,DUPONT Jean,CM,G1,A101,0,2,0',
  'S1,INFO,R102,Réseaux,MARTIN Paul,TD,G2,B201,0,1.5,0',
].join('\n');

const MOCK_RESULT = {
  isComplete: true,
  scheduledCount: 2,
  conflictCount: 0,
  solutions: [
    {
      taskId: 'task-0',
      code: 'R101',
      name: 'Algorithmique',
      type: 'CM',
      week: 47,
      startTime: 480,
      duration: 120,
      resources: [
        { id: 'DUPONT Jean', type: 'teacher' },
        { id: 'A101', type: 'room' },
      ],
    },
    {
      taskId: 'task-1',
      code: 'R102',
      name: 'Réseaux',
      type: 'TD',
      week: 47,
      startTime: 600,
      duration: 90,
      resources: [
        { id: 'MARTIN Paul', type: 'teacher' },
        { id: 'B201', type: 'room' },
      ],
    },
  ],
};

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe('SchedulePage — chargement', () => {
  test('affiche le formulaire de planification', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Planification')).toBeVisible();
    await expect(page.getByRole('button', { name: /Planifier/i })).toBeVisible();
  });

  test('affiche les labels des champs fichiers', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(/Resources/i)).toBeVisible();
    await expect(page.getByText(/Cours/i)).toBeVisible();
    await expect(page.getByText(/Contraintes/i)).toBeVisible();
  });

  test('le champ semaine est présent avec valeur initiale 1', async ({ page }) => {
    await page.goto('/');
    const weekInput = page.locator('input[type="number"]');
    await expect(weekInput).toHaveValue('1');
  });
});

test.describe('SchedulePage — upload CSV', () => {
  test('affiche les cartes de cours après upload du CSV pour une semaine', async ({ page }) => {
    const csvPath = tmpCsv(CSV_S47);

    try {
      await page.goto('/');

      // Saisir la semaine 47
      const weekInput = page.locator('input[type="number"]');
      await weekInput.fill('47');

      // Uploader le CSV
      const csvInput = page.locator('input[type="file"][accept=".csv"]');
      await csvInput.setInputFiles(csvPath);

      // Les cartes de cours doivent apparaître
      await expect(page.getByText('R101')).toBeVisible({ timeout: 5000 });
      await expect(page.getByText('Algorithmique')).toBeVisible();
      await expect(page.getByText('R102')).toBeVisible();
    } finally {
      fs.unlinkSync(csvPath);
    }
  });

  test('affiche le nombre de cours chargés', async ({ page }) => {
    const csvPath = tmpCsv(CSV_S47);

    try {
      await page.goto('/');
      await page.locator('input[type="number"]').fill('47');
      await page.locator('input[type="file"][accept=".csv"]').setInputFiles(csvPath);

      await expect(page.getByText('2 cours')).toBeVisible({ timeout: 5000 });
    } finally {
      fs.unlinkSync(csvPath);
    }
  });
});

test.describe('SchedulePage — soumission et résultats', () => {
  test('affiche un résumé de planification après réponse API réussie', async ({ page }) => {
    const resourcesPath = tmpJson(RESOURCES_FIXTURE);
    const csvPath = tmpCsv(CSV_S47);

    try {
      await page.route('/api/schedule', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_RESULT),
        });
      });

      await page.goto('/');
      await page.locator('input[type="number"]').fill('47');
      await page.locator('input[type="file"][accept=".json"]').first().setInputFiles(resourcesPath);
      await page.locator('input[type="file"][accept=".csv"]').setInputFiles(csvPath);

      await page.getByRole('button', { name: /Planifier/i }).click();

      // Le message de succès doit apparaître dans la bannière
      await expect(page.getByText(/Planification complète|planifiés/i)).toBeVisible({ timeout: 10000 });
    } finally {
      fs.unlinkSync(resourcesPath);
      fs.unlinkSync(csvPath);
    }
  });

  test('affiche un message d\'erreur si l\'API retourne une erreur', async ({ page }) => {
    const resourcesPath = tmpJson(RESOURCES_FIXTURE);
    const csvPath = tmpCsv(CSV_S47);

    try {
      await page.route('/api/schedule', async (route) => {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Erreur interne du serveur' }),
        });
      });

      await page.goto('/');
      await page.locator('input[type="number"]').fill('47');
      await page.locator('input[type="file"][accept=".json"]').first().setInputFiles(resourcesPath);
      await page.locator('input[type="file"][accept=".csv"]').setInputFiles(csvPath);

      await page.getByRole('button', { name: /Planifier/i }).click();

      await expect(page.getByText(/Erreur interne/i)).toBeVisible({ timeout: 10000 });
    } finally {
      fs.unlinkSync(resourcesPath);
      fs.unlinkSync(csvPath);
    }
  });
});

test.describe('SchedulePage — recherche dans les résultats', () => {
  test('affiche le champ de recherche après réception des résultats', async ({ page }) => {
    const resourcesPath = tmpJson(RESOURCES_FIXTURE);
    const csvPath = tmpCsv(CSV_S47);

    try {
      await page.route('/api/schedule', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_RESULT),
        });
      });

      await page.goto('/');
      await page.locator('input[type="number"]').fill('47');
      await page.locator('input[type="file"][accept=".json"]').first().setInputFiles(resourcesPath);
      await page.locator('input[type="file"][accept=".csv"]').setInputFiles(csvPath);
      await page.getByRole('button', { name: /Planifier/i }).click();

      // Le champ de recherche devient visible après les résultats
      await expect(page.locator('input[type="search"]')).toBeVisible({ timeout: 10000 });
    } finally {
      fs.unlinkSync(resourcesPath);
      fs.unlinkSync(csvPath);
    }
  });
});
