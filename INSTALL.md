# Installation en production — Debian 13 (trixie) + Apache

Procédure de déploiement de `edt-ts` sur un serveur Debian 13 avec Apache 2.4 en frontal.

Pour le détail des artefacts, des variables d'environnement et des contraintes du moteur CP-SAT,
voir [`docs/Deploiement.md`](docs/Deploiement.md). Ce document-ci est la marche à suivre.

## Architecture cible

```
                 ┌───────────────────── Apache 2.4 (:80/:443) ─────────────────────┐
 navigateur ───► │  /edtts/…      → fichiers statiques  /var/www/edtts/            │
                 │  /edtts/api/…  → mandataire          http://127.0.0.1:3000/api/ │
                 └────────────────────────────┬────────────────────────────────────┘
                                              │
                           ┌──────────────────▼──────────────────┐
                           │ systemd : edtts-api.service         │
                           │ node /opt/edtts/api/server.cjs      │
                           └──────────────────┬──────────────────┘
                                              │ subprocess (JSON sur stdin/stdout)
                           ┌──────────────────▼──────────────────┐
                           │ /opt/edtts/cpsat/.venv/bin/python   │
                           │ cpsat_runner.py  (OR-Tools, C++)    │
                           └─────────────────────────────────────┘
```

Deux points qui simplifient beaucoup l'installation, **vérifiés** sur le bundle de production :

- **L'API n'a besoin d'aucun `node_modules`.** `server.cjs` et `scheduler.worker.cjs` sont des
  bundles esbuild autoportants : Express, Zod et `scheduler-core` y sont déjà inclus. Le serveur
  n'a besoin que du binaire `node`. Aucun `npm install` sur la machine de production.
- **Le client est un site 100 % statique.** Apache le sert directement, aucun processus Node.

Le seul composant à provisionner sur le serveur est le moteur CP-SAT (Python + bibliothèque
native C++), à l'étape 4 — et il est **facultatif** : sans lui, l'application fonctionne
normalement avec le moteur `core`.

---

## 1. Prérequis serveur

```bash
sudo apt update
sudo apt install -y nodejs apache2 python3 python3-venv rsync
node --version     # Debian 13 fournit Node.js 20 — suffisant (les bundles ciblent node20)
python3 --version  # Debian 13 fournit Python 3.13
```

Activer les modules Apache nécessaires au mandataire :

```bash
sudo a2enmod proxy proxy_http headers
sudo systemctl restart apache2
```

Créer l'utilisateur de service et l'arborescence :

```bash
sudo useradd --system --home /opt/edtts --shell /usr/sbin/nologin edtts
sudo mkdir -p /opt/edtts/api /opt/edtts/cpsat /var/www/edtts
sudo chown -R edtts:edtts /opt/edtts
```

## 2. Build (sur le poste de développement)

Les artefacts sont indépendants de la plateforme (JavaScript et fichiers statiques) : builder sous
Windows ou macOS pour un serveur Linux ne pose aucun problème.

```bash
npm install
npm run typecheck        # doit être vert
npm run build            # = api:build && client:build
```

Produit :

| Artefact | Chemin |
|---|---|
| API | `packages/scheduler-api/dist/{server.cjs,scheduler.worker.cjs}` |
| Client statique | `packages/scheduler-client/out/` |

> ⚠️ Le client est figé au build sur `NEXT_PUBLIC_API_BASE=/edtts` (fichier
> `packages/scheduler-client/.env.production`, versionné). Cette valeur ne se change pas après coup
> côté serveur : si l'application doit être servie sous un autre préfixe, modifier **à la fois** ce
> fichier et `basePath` dans `next.config.ts`, puis rebuilder.

Contrôle rapide du build client :

```bash
grep -ro '"/edtts"' packages/scheduler-client/out/_next/static/chunks | head -1
```

## 3. Transfert des artefacts

Depuis le poste de développement (adapter `serveur` et les chemins) :

```bash
# API — les deux .cjs doivent rester dans le MÊME dossier
rsync -av --delete packages/scheduler-api/dist/ serveur:/tmp/edtts-api/

# Client statique
rsync -av --delete packages/scheduler-client/out/ serveur:/tmp/edtts-www/

# Moteur CP-SAT — les sources Python seulement, JAMAIS le .venv (voir étape 4)
rsync -av --delete --include='*.py' --include='requirements.txt' --exclude='*' \
  packages/scheduler-cpsat/ serveur:/tmp/edtts-cpsat/
```

Puis, sur le serveur :

```bash
sudo rsync -a --delete /tmp/edtts-api/   /opt/edtts/api/
sudo rsync -a --delete /tmp/edtts-cpsat/ /opt/edtts/cpsat/
sudo rsync -a --delete /tmp/edtts-www/   /var/www/edtts/
sudo chown -R edtts:edtts /opt/edtts
sudo chown -R www-data:www-data /var/www/edtts
```

## 4. Moteur CP-SAT (facultatif)

> **À faire sur le serveur, jamais par copie.** `ortools` embarque une bibliothèque **native C++**
> (`.so` sous Linux, `.pyd` sous Windows) compilée par plateforme et par version de Python : copier
> le `.venv` du poste de développement ne fonctionnera pas.

```bash
sudo -u edtts python3 -m venv /opt/edtts/cpsat/.venv
sudo -u edtts /opt/edtts/cpsat/.venv/bin/pip install --upgrade pip
sudo -u edtts /opt/edtts/cpsat/.venv/bin/pip install -r /opt/edtts/cpsat/requirements.txt
```

Compatibilité Debian 13 (vérifiée) : `ortools` 9.15 publie des wheels `manylinux_2_27` /
`manylinux_2_28` pour x86_64 et aarch64, en Python 3.9 à 3.14. Debian 13 fournit Python 3.13 et
glibc 2.41 — largement au-dessus du seuil. La roue précompilée s'installe donc directement,
**sans compilation**. Il faut en revanche que `pip` puisse joindre PyPI depuis le serveur.

Le venv est volumineux (~240 Mo, dont ~82 Mo pour `ortools` seul) : prévoir la place disque.

Le passage par un venv n'est pas une préférence de style : Debian 13 marque son Python système
« externally managed » (PEP 668) et refuse un `pip install` global.

Vérification :

```bash
sudo -u edtts /opt/edtts/cpsat/.venv/bin/python -c "import ortools; print('ortools ok')"

echo '{"raw":{"week":1,"resources":[],"courses":[]},"config":{}}' \
  | sudo -u edtts /opt/edtts/cpsat/.venv/bin/python /opt/edtts/cpsat/cpsat_runner.py
```

La seconde commande doit répondre par un tableau JSON sur la sortie standard.

## 5. Service systemd

`/etc/systemd/system/edtts-api.service` :

```ini
[Unit]
Description=edt-ts — API de planification
After=network.target

[Service]
Type=simple
User=edtts
Group=edtts
WorkingDirectory=/opt/edtts/api
ExecStart=/usr/bin/node /opt/edtts/api/server.cjs
Restart=on-failure
RestartSec=5

Environment=NODE_ENV=production
Environment=PORT=3000
Environment=CORS_ORIGIN=https://exemple.fr

# Chemins ABSOLUS du moteur CP-SAT. Sans eux, la passerelle cherche `cpsat_runner.py`
# relativement au répertoire courant et ne le trouve pas dans cette arborescence : le moteur
# core continuerait de fonctionner, mais `engine: 'cpsat'` échouerait.
# À retirer si CP-SAT n'est pas provisionné (étape 4).
Environment=CPSAT_PYTHON=/opt/edtts/cpsat/.venv/bin/python
Environment=CPSAT_RUNNER=/opt/edtts/cpsat/cpsat_runner.py

# Durcissement
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/edtts

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now edtts-api
sudo systemctl status edtts-api
curl -s http://127.0.0.1:3000/api/schedule/health   # {"status":"ok",...}
```

> 🔒 **Le serveur Node écoute sur toutes les interfaces**, pas seulement sur la boucle locale. Le
> port 3000 doit donc être fermé de l'extérieur — sinon l'API est joignable en direct, en
> contournant Apache :
>
> ```bash
> sudo apt install -y ufw
> sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
> sudo ufw deny 3000/tcp
> sudo ufw enable
> ```

## 6. Configuration Apache

Dans le `VirtualHost` du site (`/etc/apache2/sites-available/…`) :

```apache
# ── API ───────────────────────────────────────────────────────────────────────
# AVANT l'Alias : sinon /edtts/api serait cherché dans le système de fichiers.
ProxyPreserveHost On
ProxyPass        /edtts/api/ http://127.0.0.1:3000/api/
ProxyPassReverse /edtts/api/ http://127.0.0.1:3000/api/

# ── Client statique ───────────────────────────────────────────────────────────
# Le contenu de `out/` correspond directement au préfixe /edtts (basePath du build).
Alias /edtts /var/www/edtts

<Directory /var/www/edtts>
    Require all granted
    Options -Indexes +FollowSymLinks
    # Chaque route exportée est un dossier contenant index.html (`trailingSlash: true`)
    DirectoryIndex index.html
    ErrorDocument 404 /edtts/404.html
</Directory>

# Confort : la racine du domaine renvoie vers l'application
RedirectMatch ^/$ /edtts/
```

```bash
sudo apache2ctl configtest
sudo systemctl reload apache2
```

Note sur les délais : les résolutions longues passent par l'API **asynchrone** (soumission du job,
puis interrogation périodique). Aucune requête HTTP n'est maintenue ouverte pendant le calcul, donc
le `ProxyTimeout` par défaut d'Apache n'a pas besoin d'être augmenté, même avec un `timeoutSeconds`
élevé.

## 7. Vérification de bout en bout

```bash
# Statique
curl -sI https://exemple.fr/edtts/ | head -1            # 200
curl -sI https://exemple.fr/edtts/planning/ | head -1   # 200

# API à travers Apache
curl -s https://exemple.fr/edtts/api/schedule/health    # {"status":"ok",...}
```

Puis dans le navigateur : ouvrir `https://exemple.fr/edtts/`, charger un projet et lancer une
planification avec chacun des deux moteurs (`core`, puis `cpsat` si l'étape 4 a été faite).

Journaux :

```bash
sudo journalctl -u edtts-api -f
sudo tail -f /var/log/apache2/error.log
```

## 8. Mise à jour

```bash
# Poste de développement
npm run typecheck && npm run build
rsync -av --delete packages/scheduler-api/dist/   serveur:/tmp/edtts-api/
rsync -av --delete packages/scheduler-client/out/ serveur:/tmp/edtts-www/

# Serveur
sudo rsync -a --delete /tmp/edtts-api/ /opt/edtts/api/
sudo rsync -a --delete /tmp/edtts-www/ /var/www/edtts/
sudo chown -R edtts:edtts /opt/edtts && sudo chown -R www-data:www-data /var/www/edtts
sudo systemctl restart edtts-api
```

Le client statique n'exige aucun redémarrage. Les assets de `_next/static/` ont des noms hachés,
donc leur rechargement est automatique ; seul `index.html` peut être servi depuis le cache du
navigateur.

**Les jobs en cours sont perdus au redémarrage de l'API** (stockage en mémoire) : redéployer de
préférence hors période d'utilisation.

## 9. Dépannage

| Symptôme | Cause probable | Correction |
|---|---|---|
| Le client s'affiche mais toute action échoue en 404 sur `/api/…` | Build fait sans `NEXT_PUBLIC_API_BASE` | Rebuilder avec `.env.production` présent (étape 2) |
| `Moteur CP-SAT indisponible (Python/ortools non provisionné)` | `CPSAT_PYTHON` absent, ou venv non créé | Étape 4, puis vérifier l'unité systemd |
| `impossible de localiser cpsat_runner.py` | `CPSAT_RUNNER` non défini | Ajouter la variable dans l'unité systemd (étape 5) |
| Tous les jobs échouent immédiatement | `scheduler.worker.cjs` absent du dossier de `server.cjs` | Recopier **les deux** fichiers de `dist/` |
| `externally-managed-environment` au `pip install` | Installation tentée hors venv | Utiliser le `pip` du venv (étape 4) |
| 503 sur `/edtts/api/…` | Service arrêté, ou `mod_proxy` non activé | `systemctl status edtts-api`, `a2enmod proxy proxy_http` |
| L'API devient molle pendant une résolution CP-SAT | Le solveur sature les cœurs pendant tout son `timeoutSeconds` | Voir `docs/Deploiement.md` §3d — plafonner `num_workers` plutôt qu'agrandir la machine |
