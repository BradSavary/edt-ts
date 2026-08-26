# Build de production et déploiement

Deux artefacts, produits par `npm run build` à la racine :

| Artefact | Chemin | Taille | Nature |
|---|---|---|---|
| Client | `packages/scheduler-client/out/` | ~2,5 Mo | site **statique** (Next.js `output: 'export'`), servi par Apache sous `/edtts` |
| API | `packages/scheduler-api/dist/` | ~1,4 Mo | `server.cjs` + `scheduler.worker.cjs` (bundles esbuild CJS, autoportants) |

Le moteur CP-SAT n'est **pas** buildé : c'est du Python + une bibliothèque native C++ à provisionner
sur la machine cible (§3).

---

## 1. Build

```bash
npm install
npm run build          # = api:build && client:build
```

- `api:build` — esbuild bundle `src/index.ts` → `dist/server.cjs` et `src/jobs/scheduler.worker.ts`
  → `dist/scheduler.worker.cjs`. Les deux doivent rester **dans le même dossier** : le serveur
  charge son worker à côté de lui (`__dirname`). Pas de typecheck dans le build → lancer
  `npm run typecheck` séparément.
- `client:build` — `next build` en mode export statique. Lit `packages/scheduler-client/.env.production`,
  qui fixe `NEXT_PUBLIC_API_BASE=/edtts`. **Cette valeur est inscrite en dur dans le bundle au moment
  du build** : elle ne peut pas être changée après coup côté serveur. Sans elle, le client appellerait
  `/api/*` à la racine du domaine au lieu de `/edtts/api/*` → 404 en production.

Vérification rapide après build :

```bash
grep -ro '"/edtts"' packages/scheduler-client/out/_next/static/chunks | head -1
```

## 2. Lancer l'API en production

```bash
cd packages/scheduler-api
PORT=3000 CORS_ORIGIN=https://<domaine> node dist/server.cjs
```

> ⚠️ **Lancer depuis `packages/scheduler-api`.** La passerelle CP-SAT localise `cpsat_runner.py`
> relativement à `process.cwd()` (`../scheduler-cpsat`, `packages/scheduler-cpsat`, `scheduler-cpsat`).
> Depuis un autre répertoire, le moteur core continue de marcher mais CP-SAT échoue avec
> « impossible de localiser cpsat_runner.py ». Alternative : fixer `CPSAT_RUNNER` en absolu.

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `3000` | port d'écoute |
| `HOST` | `127.0.0.1` | interface d'écoute — la boucle locale par défaut, l'API n'étant censée être jointe qu'à travers le reverse-proxy. `0.0.0.0` pour exposer au réseau (choix explicite) |
| `CORS_ORIGIN` | `*` | à restreindre au domaine de production |
| `SCHEDULER_WORKER_PATH` | `<dist>/scheduler.worker.cjs` | override du worker pré-compilé |
| `CPSAT_PYTHON` | venv auto-détecté, sinon `python3` | interpréteur Python du moteur CP-SAT |
| `CPSAT_RUNNER` | auto-détecté depuis le cwd | chemin de `cpsat_runner.py` |

Le processus est un serveur Node nu : le confier à un superviseur (systemd) pour le redémarrage
automatique, et le placer derrière le reverse-proxy Apache existant (`/edtts/api/*` → `localhost:3000`).

## 3. Contraintes posées par le moteur CP-SAT (OR-Tools, C++)

OR-Tools est une bibliothèque **C++** sans binding Node officiel. Elle est consommée ici via son
wrapper Python officiel, invoqué en **subprocess** depuis l'API (`cpsatGateway.ts`). D'où :

**a. Le venv n'est pas portable — il doit être recréé sur la cible.**
`ortools` est une extension native (`.so` sous Linux, `.pyd` sous Windows) compilée par plateforme :
copier le `.venv` du poste de dev vers le serveur ne marchera pas. Sur la machine de production :

```bash
cd packages/scheduler-cpsat
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

Empreinte disque mesurée : ~82 Mo pour `ortools` seul, ~242 Mo pour le venv complet
(numpy/pandas/protobuf inclus). Prévoir la place.

**b. Python 3 est un prérequis serveur.** C'est le premier composant non-Node du projet. Les wheels
`ortools` sont publiées pour Linux x86_64 et aarch64 (glibc récente) — pas de compilation nécessaire
sur une distribution courante, mais `pip install` doit pouvoir sortir sur le réseau.

**c. Si CP-SAT n'est pas provisionné, l'application reste fonctionnelle.** Le moteur `core` est le
défaut ; seules les requêtes `engine: 'cpsat'` échouent, avec un message explicite
(« Moteur CP-SAT indisponible (Python/ortools non provisionné) »). Un déploiement peut donc partir
sans CP-SAT et l'ajouter ensuite.

**d. Dimensionnement CPU — le point le plus important.**
CP-SAT lance par défaut autant de threads de recherche que de cœurs (`num_workers = 0` = auto).
Mesures sur données réelles (semaines 4 et 12, 83–86 cours, pause fixe 12:00–13:30) :

| Configuration | 1 worker | 2 workers | 4 workers | auto (16) |
|---|---|---|---|---|
| Placement seul (aucune préférence douce) | 0,6–1,0 s | 0,4–0,5 s | 0,4–0,5 s | 0,5–0,6 s |
| Toutes préférences douces activées | 61,6 s | 61,2 s | 61,0 s | 61,3 s |

Deux enseignements :

1. **Le placement seul est trivial** — optimum prouvé en ~1 s même sur un seul cœur. Un VPS modeste
   suffit largement pour cet usage.
2. **Dès qu'une préférence douce est activée** (`compactTeacherHalfDays`, `minimizeTeacherDays`,
   `balanceTeacherDailyLoad`, `crossNoonGap`, `minimizeTeacherRoomChanges`), les passes 2 à 4
   consomment **la totalité** du budget `timeoutSeconds`, quel que soit le nombre de cœurs — ajouter
   des cœurs n'accélère pas, cela augmente seulement la puissance dépensée. Pendant toute cette
   durée, le subprocess sature tous les cœurs visibles.

Conséquence pratique : sur un petit VPS, une requête CP-SAT avec préférences douces occupe la machine
pendant tout son timeout. Si cela gêne (API qui devient molle, voisinage sur la même machine), fixer
explicitement `solver.parameters.num_workers` dans `cpsat_engine.py` plutôt que d'agrandir la machine —
le tableau ci-dessus montre que la qualité du résultat n'en souffrira pas sur ces instances.

**e. Garde-fous déjà en place.** Le gateway tue le subprocess (`SIGKILL`) à `timeoutSeconds + 5 s`,
et force `PYTHONUTF8=1` (sans quoi les accents des noms d'enseignants sont corrompus).

## 4. Capacité de l'API (indépendant de CP-SAT)

- La file de jobs exécute **un seul job à la fois pour tout le serveur** (`JobQueue`, un worker actif).
  Les requêtes concurrentes attendent. Avec un timeout CP-SAT de 60 s, deux utilisateurs simultanés
  signifient 60 s d'attente pour le second.
- Les jobs sont stockés **en mémoire** : un redémarrage de l'API perd les jobs en cours et leurs
  résultats. Purge par TTL toutes les heures.
- Limite de corps de requête : 10 Mo. Un payload de semaine réelle (86 cours) pèse ~56 Ko — large marge.

## 5. Contrôles avant mise en ligne

```bash
npm run typecheck                                   # 4 workspaces
npm test --workspace=packages/scheduler-core        # 149 tests
npm test --workspace=packages/scheduler-api         # 7 tests (dont la passerelle CP-SAT)
cd packages/scheduler-cpsat && .venv/bin/pytest     # moteur Python
```

Puis, API lancée, un aller-retour réel sur les deux moteurs :

```bash
curl -s localhost:3000/api/schedule/health
# POST /api/schedule/v2/async avec options.engine = 'core' puis 'cpsat'
```
