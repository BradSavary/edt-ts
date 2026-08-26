# Installation en production — Debian 13 (trixie) + Apache

Procédure de déploiement de `edt-ts`, telle qu'elle a été réellement exécutée sur
`mmi-dev.unilim.fr` (Debian 13.6, Apache 2.4, Python 3.13, Node.js 20.19, glibc 2.41).

Pour le détail des artefacts, des variables d'environnement et des contraintes du moteur CP-SAT,
voir [`docs/Deploiement.md`](docs/Deploiement.md). Ce document-ci est la marche à suivre.

Les commandes sont écrites **pour un shell root**. Si tu passes par `sudo`, préfixe-les.

## Architecture retenue

Les sources sont clonées sur la machine cible et **buildées sur place** : une seule source de
vérité, mise à jour par `git pull`, et le commit déployé reste identifiable par un `git log`.

```
                 ┌───────────────────── Apache 2.4 (:443) ─────────────────────┐
 navigateur ───► │  /edtts/…      → statique  /srv/edt-ts/…/scheduler-client/out │
                 │  /edtts/api/…  → mandataire http://127.0.0.1:3000/api/        │
                 └────────────────────────────┬────────────────────────────────┘
                                              │
                           ┌──────────────────▼──────────────────┐
                           │ systemd : edtts-api.service         │
                           │ node /srv/edt-ts/…/dist/server.cjs  │
                           └──────────────────┬──────────────────┘
                                              │ subprocess (JSON sur stdin/stdout)
                           ┌──────────────────▼──────────────────┐
                           │ /opt/edtts/cpsat/.venv/bin/python   │
                           │ cpsat_runner.py  (OR-Tools, C++)    │
                           └─────────────────────────────────────┘
```

| Emplacement | Contenu | Propriétaire |
|---|---|---|
| `/srv/edt-ts` | clone du dépôt, sources et artefacts buildés | ton compte utilisateur |
| `/opt/edtts/cpsat/.venv` | environnement Python + OR-Tools | `edtts` |

Le venv est délibérément **hors du clone** : il ne doit pas être emporté par un `git clean`, et il
est le seul élément non reproductible par un build.

> **Ne clone pas dans `/home`.** L'unité systemd contient `ProtectHome=true` : le service verrait
> `/home` vide et ne pourrait pas lire `cpsat_runner.py`. Le symptôme est déroutant — le fichier
> existe, tu le lis parfaitement en ligne de commande, et le service jure ne pas le trouver.

---

## 0. Note préalable sur le `PATH`

Si tu obtiens root par `su` **sans tiret**, l'environnement de l'utilisateur d'origine est conservé
et `/usr/sbin` manque au `PATH`. `useradd`, `runuser`, `a2enmod` et `a2enconf` deviennent alors
« commande introuvable ». À refaire dans chaque nouveau shell :

```bash
export PATH=/usr/sbin:/sbin:$PATH
```

`su -` ou `sudo -i` évitent le problème d'emblée.

## 1. Prérequis

```bash
apt update
apt install -y nodejs npm apache2 python3 python3-venv git
node --version     # ≥ 20.9 exigé par Next 16 — Debian 13 fournit 20.19 ✓
python3 --version  # 3.13 ✓
dpkg --print-architecture   # amd64 ou arm64 : indispensable, voir §3
```

`npm` est packagé séparément de `nodejs` sur Debian : `node` peut répondre sans que `npm` existe.

Utilisateur de service — un compte sans shell, dédié à l'exécution du démon, pour qu'une faille
éventuelle de l'API n'accorde pas les droits de root :

```bash
id edtts >/dev/null 2>&1 || useradd --system --home /opt/edtts --shell /usr/sbin/nologin edtts
```

## 2. Clone des sources

Le dépôt est privé : il faut une **clé de déploiement** (lecture seule, limitée à ce dépôt —
préférable à un jeton personnel qui ouvrirait tout le compte). Sous **ton compte utilisateur** :

```bash
ssh-keygen -t ed25519 -C "edt-ts deploy $(hostname)" -f ~/.ssh/id_edtts -N ""
cat ~/.ssh/id_edtts.pub
```

Colle la ligne complète (`ssh-ed25519 AAAA… commentaire`) dans **Settings → Deploy keys → Add
deploy key** du dépôt, sans cocher « Allow write access ». C'est bien le contenu du fichier `.pub`
qu'il faut, pas l'empreinte `SHA256:…` affichée par `ssh-keygen`.

En root, préparer le répertoire (`/srv` appartient à root, ton compte ne peut pas y écrire) :

```bash
mkdir -p /srv/edt-ts
chown <ton-user> /srv/edt-ts     # sans `:groupe` — un compte annuaire n'a pas forcément
                                 # de groupe éponyme
```

Puis, sous ton compte :

```bash
GIT_SSH_COMMAND="ssh -i ~/.ssh/id_edtts -o IdentitiesOnly=yes" \
  git clone git@github.com:edt-ts-maintainer/edt-ts.git /srv/edt-ts

cd /srv/edt-ts
git config core.sshCommand "ssh -i ~/.ssh/id_edtts -o IdentitiesOnly=yes"
```

La ligne `git config` rend les `git pull` suivants indolores : sans elle, le dépôt connaît son URL
mais pas la clé à présenter.

## 3. Moteur CP-SAT (facultatif)

> **À installer sur le serveur, jamais par copie.** `ortools` embarque une bibliothèque **native
> C++** (`.so` sous Linux, `.pyd` sous Windows) compilée par plateforme et par version de Python :
> copier un `.venv` depuis un poste de développement ne fonctionnera pas.

```bash
mkdir -p /opt/edtts/cpsat
python3 -m venv /opt/edtts/cpsat/.venv
/opt/edtts/cpsat/.venv/bin/pip install --upgrade pip
/opt/edtts/cpsat/.venv/bin/pip install ortools==9.15.6755
chown -R edtts:edtts /opt/edtts
```

Version épinglée à dessein : `requirements.txt` ne déclare que `ortools`, ce qui laisserait le
serveur installer une version différente de celle validée en développement.

Compatibilité Debian 13 : `ortools` 9.15 publie des wheels `manylinux_2_27` / `manylinux_2_28` pour
**x86_64 et aarch64**, en Python 3.9 à 3.14. Debian 13 fournit Python 3.13 et glibc 2.41 — la roue
précompilée s'installe directement, sans compilation. En revanche **aucune roue n'existe pour une
architecture 32 bits** (`armhf`, `i386`) : d'où le `dpkg --print-architecture` du §1.

Le venv pèse ~240 Mo, dont ~82 Mo pour `ortools` seul.

Le passage par un venv n'est pas une préférence de style : Debian 13 marque son Python système
« externally managed » (PEP 668) et refuse tout `pip install` global.

Vérification — la seconde commande teste sous l'identité réelle du service, ce que root ne
permettrait pas de valider (root traverse la plupart des restrictions de permissions) :

```bash
/opt/edtts/cpsat/.venv/bin/python -c "import ortools; print('ortools', ortools.__version__)"

echo '{"raw":{"week":1,"resources":[],"courses":[]},"config":{}}' \
  | runuser -u edtts -- /opt/edtts/cpsat/.venv/bin/python \
      /srv/edt-ts/packages/scheduler-cpsat/cpsat_runner.py
```

Attendu : `[{"solutions": [], "isComplete": true, "score": 0, "provenOptimal": true}]`.

## 4. Build

**Sous ton compte utilisateur**, jamais root — le dépôt t'appartient.

```bash
cd /srv/edt-ts
npm ci
npm run build
```

> ⚠️ **`npm ci`, jamais `npm install`.** `npm install` s'autorise à faire évoluer l'arbre et à
> réécrire `package.json` et le lockfile ; observé sur ce déploiement, il a transformé
> `"next": "16.2.0"` en `"next": "^16.3.3"` et construit avec une version non validée. `npm ci`
> installe strictement le lockfile, n'écrit jamais dans `package.json`, et échoue si les deux
> divergent.

Contrôles :

```bash
git status --short   # DOIT être vide : un arbre modifié signale un npm install intempestif
node -e "console.log('next', require('next/package.json').version)"   # 16.2.0
ls -l packages/scheduler-api/dist/ packages/scheduler-client/out/index.html
```

Le build client lit `packages/scheduler-client/.env.production` (versionné), qui fixe
`NEXT_PUBLIC_API_BASE=/edtts`. La ligne `- Environments: .env.production` dans la sortie l'atteste.
Cette valeur est **inscrite en dur dans le bundle** et ne se change pas après coup : pour servir
l'application sous un autre préfixe, modifier ce fichier **et** `basePath` dans `next.config.ts`,
puis rebuilder.

Les avertissements `import.meta is not available with the "cjs" output format`, `rewrites/redirects
will not work with output: export` et `multiple lockfiles` sont attendus : ils décrivent des
chemins de code inactifs en production.

Accès du compte de service aux artefacts — à vérifier, un `umask` restrictif produirait un clone
en `700` :

```bash
runuser -u edtts    -- test -r /srv/edt-ts/packages/scheduler-api/dist/server.cjs && echo "edtts OK"
runuser -u www-data -- test -r /srv/edt-ts/packages/scheduler-client/out/index.html && echo "www-data OK"
```

En cas d'échec : `chmod o+x /srv /srv/edt-ts && chmod -R o+rX /srv/edt-ts`.

## 5. Service systemd

```bash
cat > /etc/systemd/system/edtts-api.service <<'EOF'
[Unit]
Description=edt-ts — API de planification
After=network.target

[Service]
Type=simple
User=edtts
Group=edtts
WorkingDirectory=/srv/edt-ts/packages/scheduler-api
ExecStart=/usr/bin/node /srv/edt-ts/packages/scheduler-api/dist/server.cjs
Restart=on-failure
RestartSec=5

Environment=NODE_ENV=production
Environment=PORT=3000
# HOST vaut 127.0.0.1 par défaut : l'API n'est joignable qu'à travers Apache. Ne pas l'ouvrir.
Environment=CORS_ORIGIN=https://mmi.unilim.fr

# Chemins ABSOLUS du moteur CP-SAT. Sans eux, la passerelle cherche `cpsat_runner.py`
# relativement au répertoire courant. À retirer si CP-SAT n'est pas provisionné (§3).
Environment=CPSAT_PYTHON=/opt/edtts/cpsat/.venv/bin/python
Environment=CPSAT_RUNNER=/srv/edt-ts/packages/scheduler-cpsat/cpsat_runner.py

# Durcissement. Pas de ReadWritePaths : l'API n'écrit rien sur disque (jobs en mémoire).
# Effet de bord bénin : Python ne peut pas déposer ses __pycache__, il s'en passe silencieusement.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true

[Install]
WantedBy=multi-user.target
EOF

systemd-analyze verify /etc/systemd/system/edtts-api.service && echo "syntaxe OK"
systemctl daemon-reload
systemctl enable --now edtts-api
systemctl status edtts-api --no-pager
```

`CORS_ORIGIN` doit correspondre au `ServerName` d'Apache, pas au nom d'hôte de la machine — les
deux diffèrent ici (`mmi.unilim.fr` contre `mmi-dev.unilim.fr`).

Deux lignes à retrouver dans le journal, qui valident chacune un point de production :

```
[JobQueue] Worker chargé depuis /srv/edt-ts/…/dist/scheduler.worker.cjs
🚀 scheduler-api démarré sur http://127.0.0.1:3000
```

La première prouve que le serveur localise seul son worker pré-compilé (sans quoi tous les jobs
échoueraient) ; la seconde, que le port 3000 n'est pas exposé au réseau.

Vérification, dont le second appel exerce toute la chaîne jusqu'au sous-processus Python :

```bash
curl -s http://127.0.0.1:3000/api/schedule/health

curl -s -X POST http://127.0.0.1:3000/api/schedule/v2 \
  -H 'Content-Type: application/json' -H 'X-Client-Id: test' \
  -d '{"week":1,"resources":[],"courses":[],"options":{"engine":"cpsat"}}'
```

## 6. Apache

> **Vérifie d'abord qu'aucune configuration `/edtts` n'existe déjà**, sans quoi tu ajouteras une
> directive qui ne servira jamais :
>
> ```bash
> grep -rn "edtts" /etc/apache2/
> ```
>
> Les directives placées **dans un `<VirtualHost>` l'emportent sur celles de portée serveur**
> chargées depuis `conf-enabled/`. Un `Alias /edtts` préexistant dans le fichier de site rendrait
> donc inopérant tout `Alias` ajouté par ailleurs — silencieusement : l'ancienne application
> continuerait d'être servie, et un simple test de code HTTP n'y verrait que du feu.

**Si une configuration `/edtts` existe déjà dans le fichier de site**, c'est là qu'il faut la
modifier plutôt qu'ajouter un fichier concurrent. Sauvegarde d'abord — ce fichier porte aussi ta
configuration TLS :

```bash
cp /etc/apache2/sites-available/default-ssl.conf \
   /etc/apache2/sites-available/default-ssl.conf.bak-$(date +%F)
```

Puis remplace l'`Alias` et son `<Directory>` par :

```apache
        # edt-ts — application de planification (build dans /srv/edt-ts)
        ProxyPreserveHost On
        ProxyPass        /edtts/api/ http://127.0.0.1:3000/api/
        ProxyPassReverse /edtts/api/ http://127.0.0.1:3000/api/

        Alias /edtts /srv/edt-ts/packages/scheduler-client/out

        <Directory /srv/edt-ts/packages/scheduler-client/out>
            # ⚠️ REPRENDRE ICI, À L'IDENTIQUE, les restrictions d'accès du bloc remplacé.
            # Exemple réel de cette installation :
            <RequireAny>
                Require ip 164.81.0.0/16
                Require ip 10.0.0.0/8
            </RequireAny>
            AllowOverride None
            Options -Indexes +FollowSymLinks
            DirectoryIndex index.html
            ErrorDocument 404 /edtts/404.html
        </Directory>
```

> ⚠️ **Ne jamais écrire `Require all granted` par réflexe.** Si le bloc remplacé portait une
> restriction d'accès, la perdre publie l'application plus largement qu'avant — sans que rien ne
> cesse de fonctionner, donc sans que personne ne le remarque. Relis le bloc d'origine avant de
> l'écraser.

`AllowOverride None` remplace un éventuel `AllowOverride ALL` : le mandataire étant désormais
déclaré par `ProxyPass`, aucun `.htaccess` n'est nécessaire.

**Si aucune configuration `/edtts` n'existe**, le même bloc peut aller dans un fichier séparé,
plus facile à annuler :

```bash
cat > /etc/apache2/conf-available/edtts.conf <<'EOF'
… (le même contenu, sans l'indentation du VirtualHost) …
EOF
a2enconf edtts
```

Dans tous les cas :

```bash
a2enmod proxy proxy_http
diff /etc/apache2/sites-available/default-ssl.conf.bak-$(date +%F) \
     /etc/apache2/sites-available/default-ssl.conf
apache2ctl configtest && systemctl reload apache2
```

Relis le `diff` avant de recharger : c'est le seul moment où une erreur se corrige sans
conséquence. Rien n'y doit toucher à la configuration TLS.

Note : les résolutions longues passent par l'API **asynchrone** (soumission d'un job, puis
interrogation périodique). Aucune requête n'est maintenue ouverte pendant le calcul, donc le
`ProxyTimeout` par défaut n'a pas besoin d'être augmenté, même avec un `timeoutSeconds` élevé.

Si `apache2ctl` échoue sans message clair, c'est qu'il lui manque les variables de Debian :

```bash
source /etc/apache2/envvars
```

## 7. Vérification finale

> Un code `200` sur `/edtts/` et un `health` sur `/edtts/api/` **ne prouvent rien sur la version
> servie** : ils passent tout aussi bien avec un déploiement antérieur laissé en place. Le seul
> contrôle qui tranche compare le fichier servi à celui sur disque.

```bash
curl -s https://mmi.unilim.fr/edtts/ | md5sum
md5sum /srv/edt-ts/packages/scheduler-client/out/index.html
```

Les deux empreintes doivent être **identiques**. Si une ancienne installation subsiste, sa propre
empreinte lève l'ambiguïté sur ce qui est réellement servi :

```bash
md5sum /var/www/edtts/index.html 2>/dev/null
```

> Ne compare pas des noms de fichiers hachés obtenus par `ls | head` d'un côté et par extraction
> depuis le HTML de l'autre : le premier liste le répertoire par ordre alphabétique, le second les
> chunks référencés par la page. Ces deux ensembles diffèrent **même quand le déploiement est
> correct**, et la comparaison ne peut produire qu'une fausse alerte.

Puis dans un navigateur : ouvrir `https://mmi.unilim.fr/edtts/`, charger un projet et lancer une
planification réelle avec chacun des deux moteurs (`core`, puis `cpsat`). Les appels `curl`
n'exercent que des jeux de données vides — ils ne prouvent pas que le calcul aboutit.

Enfin, valider le redémarrage de la machine, seul moyen de s'assurer que le service revient seul :

```bash
reboot
# au retour
systemctl status edtts-api --no-pager
```

Journaux :

```bash
journalctl -u edtts-api -f
tail -f /var/log/apache2/error.log
```

## 8. Mise à jour

```bash
# Sous ton compte
cd /srv/edt-ts
git status --short   # doit être vide, sinon `git pull` refusera
git pull
npm ci
npm run build

# En root
systemctl restart edtts-api
```

Apache n'a pas besoin d'être rechargé : il sert les fichiers de `out/` directement. Les assets de
`_next/static/` portent des noms hachés, leur rechargement est donc automatique ; seul `index.html`
peut rester en cache navigateur.

**Les jobs en cours sont perdus au redémarrage de l'API** (stockage en mémoire) : redéployer de
préférence hors période d'utilisation.

## 9. À propos de `npm audit`

`npm ci` signale une douzaine de vulnérabilités sur cette machine. C'est le prix, assumé, du choix
de builder sur place : l'arbre de développement complet y est présent.

Ce qui compte est le graphe de **production** :

```bash
npm audit --omit=dev
```

Au moment de la rédaction, il ne reste que `sharp` (CVE libvips), **non exploitable ici** :
`next/image` n'est utilisé nulle part, les seuls assets sont des SVG, l'export statique ne produit
que des fichiers, et `sharp` n'apparaît pas dans le bundle API. Le corriger imposerait
`next@16.3.3`, hors version épinglée.

> **Ne lance jamais `npm audit fix --force`.** Il monte des versions majeures, réécrit
> `package.json` et casse la reproductibilité — c'est très probablement lui qui a introduit
> `next@^16.3.3` lors de la première installation.

## 10. Dépannage

| Symptôme | Cause | Correction |
|---|---|---|
| `useradd` / `runuser` / `a2enmod` : commande introuvable | `su` sans tiret, `/usr/sbin` hors du `PATH` | `export PATH=/usr/sbin:/sbin:$PATH` (§0) |
| `git status` non vide après un build | `npm install` a réécrit `package.json` / le lockfile | `git checkout -- <fichiers>` puis `npm ci` |
| Le client s'affiche mais tout échoue en 404 sur `/api/…` | build sans `NEXT_PUBLIC_API_BASE` | vérifier `.env.production`, rebuilder |
| `Moteur CP-SAT indisponible (Python/ortools non provisionné)` | `CPSAT_PYTHON` absent ou venv non créé | §3, puis contrôler l'unité systemd |
| `impossible de localiser cpsat_runner.py` | `CPSAT_RUNNER` non défini | ajouter la variable (§5) |
| Le service ne lit pas les sources alors que root les lit | clone dans `/home` + `ProtectHome=true`, ou `umask` restrictif | cloner dans `/srv` ; `chmod -R o+rX` |
| Tous les jobs échouent immédiatement | `scheduler.worker.cjs` absent d'à côté de `server.cjs` | rebuilder (`npm run build`) |
| `externally-managed-environment` au `pip install` | installation hors venv | utiliser le `pip` du venv (§3) |
| `No matching distribution found for ortools` | architecture 32 bits, ou Python hors 3.9–3.14 | vérifier `dpkg --print-architecture` |
| 503 sur `/edtts/api/…` | service arrêté, ou modules proxy inactifs | `systemctl status edtts-api` ; `a2enmod proxy proxy_http` |
| `apache2ctl` muet ou en erreur | variables Debian absentes de l'environnement | `source /etc/apache2/envvars` |
| L'API devient molle pendant une résolution CP-SAT | le solveur sature les cœurs pendant tout son `timeoutSeconds` | voir `docs/Deploiement.md` §3d — plafonner `num_workers` |
