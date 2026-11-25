# AI Command Center

Application desktop locale (Windows) pour piloter **Claude Code** et **OpenAI Codex** depuis une seule interface, avec **vos abonnements existants** (Claude Pro/Max, ChatGPT Plus/Pro…) : **aucune clé API, aucune facturation à l'usage**. Trois modes : **Chat** (conversation), **Work** (travaux avec documents et livrables) et **Code** (programmation sur un projet local, seul ou avec plusieurs agents).

> L'application ne remplace pas les CLI : elle lance les programmes officiels `claude` et `codex` installés sur votre ordinateur. Chat et Work sont des modes locaux qui utilisent ces moteurs ; ce ne sont pas les produits Chat/Work natifs de claude.ai ou ChatGPT.

## Sommaire

1. [Ce qu'il faut avant de commencer](#1-ce-quil-faut-avant-de-commencer)
2. [Installer l'application](#2-installer-lapplication)
3. [Installer et connecter les modèles](#3-installer-et-connecter-les-modèles)
4. [Premier lancement](#4-premier-lancement)
5. [Ajouter des serveurs MCP et des skills](#5-ajouter-des-serveurs-mcp-et-des-skills)
6. [Dépannage](#6-dépannage)
7. [Développement](#7-développement)

## 1. Ce qu'il faut avant de commencer

| Besoin | Détail |
|---|---|
| Système | **Windows 10/11 (x64)**. macOS et Linux ne sont ni construits ni testés. |
| Abonnement | Au moins un des deux : un abonnement **Claude** (Pro/Max) et/ou un abonnement **ChatGPT** (Plus/Pro) donnant accès à Codex. |
| Claude Code | Le CLI officiel `claude` (voir § 3). |
| Codex | Le CLI officiel `codex` (voir § 3). |
| Git | Recommandé pour le mode Code (suivi des changements, worktrees). |
| Node.js ≥ 22 | **Seulement** pour installer depuis le code source (§ 2, option B) ou développer. |

Vous pouvez n'utiliser qu'un seul des deux fournisseurs : l'autre apparaîtra simplement comme « absent » ou « à vérifier ».

## 2. Installer l'application

### Option A : l'installateur (le plus simple)

1. Récupérez `AI Command Center Setup 0.1.0.exe` (page *Releases* du dépôt si une version y est publiée, sinon construisez-le avec l'option B).
2. Double-cliquez. L'installation se fait **pour votre compte seulement** (aucun droit administrateur) et crée un raccourci sur le Bureau.
3. L'installateur **n'est pas signé** : Windows SmartScreen peut afficher « Windows a protégé votre PC ». Cliquez sur **Informations complémentaires**, puis **Exécuter quand même**. Ce n'est pas une faille : un certificat de signature de code est payant et n'a pas encore été acheté.
4. Désinstallation : *Paramètres Windows › Applications*.

### Option B : depuis le code source

```bash
git clone https://github.com/hamza-bouda/ai-command-center.git
cd ai-command-center
npm install
npm run start -w @acc/desktop      # construit et lance l'application
```

Pour fabriquer vous-même l'installateur :

```bash
npm run dist -w @acc/desktop       # résultat : apps/desktop/release/AI Command Center Setup 0.1.0.exe
```

## 3. Installer et connecter les modèles

L'application détecte les programmes `claude` et `codex` (dans le `PATH`, puis dans `~/.local/bin` pour Claude et `%LOCALAPPDATA%\OpenAI\Codex\bin` pour Codex). **Vous vous connectez directement dans le CLI officiel** : l'application ne vous demande jamais de mot de passe et ne lit jamais vos jetons.

### Claude Code

1. Installez le CLI officiel en suivant la documentation d'Anthropic : <https://docs.claude.com/en/docs/claude-code/overview> (par exemple `npm install -g @anthropic-ai/claude-code`).
2. Connectez-vous avec votre **abonnement Claude** :
   ```bash
   claude auth login          # ouvre le navigateur ; choisissez votre compte Claude (abonnement)
   claude auth status         # doit indiquer que vous êtes connecté
   ```
   Évitez `claude auth login --console` : il utilise la facturation API (l'application bloquera ce mode, voir plus bas).

### Codex (OpenAI)

1. Installez le CLI officiel d'OpenAI : <https://github.com/openai/codex> (suivez les instructions d'installation du dépôt, ou installez l'application Codex qui fournit le programme).
2. Connectez-vous avec votre **compte ChatGPT** :
   ```bash
   codex login                # ouvre le navigateur ; connectez-vous avec ChatGPT
   codex login status         # doit afficher « Logged in using ChatGPT »
   ```

### Vérifier dans l'application

Ouvrez **Suivi › Abonnements et quotas** : chaque fournisseur affiche sa version, son mode d'authentification (*Abonnement*), son plan et ses fenêtres de quota (5 h / 7 jours) réelles. Le bouton **Revérifier** relance la détection ; **Diagnostics** explique ce qui manque. La pastille en bas de la barre latérale (« Claude ● Codex ● ») est verte quand les deux sont connectés par abonnement.

Versions avec lesquelles l'application a été testée : Claude Code 2.1.x, Codex 0.167.x. Des versions plus récentes devraient fonctionner, mais une évolution des CLI peut casser un détail : dans ce cas, ouvrez une *issue*.

### Mode « abonnement exclusif » (activé par défaut)

Pour que rien ne soit facturé à l'usage, l'application **bloque toute exécution dont l'authentification n'est pas vérifiée comme « abonnement »** et retire de l'environnement les variables de clé API (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`…). Si une exécution est refusée avec ce message, reconnectez-vous par abonnement (commandes ci-dessus). Le réglage se trouve dans **Paramètres › Facturation**.

## 4. Premier lancement

1. **Accueil** : choisissez **Chat**, **Work** ou **Code**.
2. **Chat** : écrivez directement. Sous la zone de texte, la pastille « Claude Code · Modèle par défaut » ouvre le choix du **fournisseur, du modèle et du niveau d'effort** (les modèles et efforts proposés sont ceux que le CLI déclare réellement).
3. **Code** : ajoutez d'abord un projet (dossier local) dans *Outils Code › Projets*, puis ouvrez une session. « Multi-Agent Workspace » permet de lancer plusieurs agents en parallèle.
4. **Work** : créez un travail, ajoutez des documents sources, suivez le plan et les livrables.
5. **Suivi › Consommation** : tokens et **équivalent estimé au tarif API** (jamais un montant facturé en plus de votre abonnement).
6. **Paramètres › Sauvegarde** : sauvegarde et restauration de vos données (stockées uniquement sur votre ordinateur). **Paramètres › Application** : langue (français/anglais) et prénom pour la salutation.

Raccourcis : `Ctrl+1` Chat · `Ctrl+2` Work · `Ctrl+3` Code · `Ctrl+N` nouveau · `Ctrl+K` recherche.

## 5. Ajouter des serveurs MCP et des skills

Page **MCP et Skills › Mes extensions** : ajoutez un serveur MCP (local par commande, ou distant par URL) ou une skill (instructions réutilisables, ou import d'un dossier `SKILL.md`), testez la connexion, puis choisissez où l'utiliser (**Chat, Work, Code**). Dans une conversation, la pastille **Extensions** permet de les couper une par une. Un serveur MCP local exécute un programme sur votre ordinateur : n'ajoutez que des serveurs de confiance. Détails plus bas (§ « Extensions »).

## 6. Dépannage

| Symptôme | Cause probable et solution |
|---|---|
| Un fournisseur est « absent » | Le programme n'est pas trouvé. Vérifiez `claude --version` / `codex --version` dans un terminal, ajoutez le dossier au `PATH`, puis **Revérifier**. |
| « à vérifier » / exécution bloquée | Pas connecté par abonnement. Relancez `claude auth login` ou `codex login` puis **Revérifier**. |
| Message sur une clé API | Une variable d'environnement de clé API est définie. L'application l'ignore (mode exclusif), mais le CLI peut l'utiliser seul : supprimez-la de vos variables Windows. |
| « Limite atteinte » | Quota de votre abonnement épuisé (fenêtre 5 h ou 7 jours). L'application ne contourne pas les quotas : attendez la réinitialisation affichée dans **Quotas**, ou basculez sur l'autre fournisseur depuis la bannière. |
| Premier démarrage de Codex en erreur | Un verrou de base de données au premier lancement : réessayez, l'application refait une tentative automatique. |
| Windows bloque l'installateur | Voir § 2 (installateur non signé). |
| Interface lente sur « MCP des CLI » | Le relevé de l'état des serveurs peut prendre quelques secondes ; l'application reste utilisable pendant ce temps. |

## 7. Développement

```bash
npm install
npm run build -w @acc/desktop     # build main + renderer
npm run start -w @acc/desktop     # build + lance l'application
npm run dev                       # mode dev (Vite + Electron)
npm test                          # tests Vitest (packages/core)
npm run typecheck                 # tsc (core + desktop)
```

Prérequis : Node ≥ 22 (utilise `node:sqlite`), Git, `claude` et `codex` installés et connectés.

## Règles d'abonnement (appliquées dans le code)

- Seuls les binaires officiels `claude` et `codex` sont lancés ; aucun OAuth maison, aucun token lu dans leurs fichiers internes, aucun mot de passe demandé.
- **Mode abonnement exclusif (activé par défaut)** : l'exécution est bloquée si le mode d'authentification n'est pas vérifié comme « abonnement » (`claude auth status` → `claude.ai` ; `codex login status` → « ChatGPT »). Les variables `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `CODEX_API_KEY`, etc. sont signalées et **retirées de l'environnement des processus enfants**.
- Claude est lancé en `claude -p --output-format stream-json --verbose --include-partial-messages` (jamais `--bare`).
- Codex est piloté via le `codex app-server` officiel (JSON-RPC stdio : `thread/start`, `turn/start`, `turn/interrupt`, `thread/tokenUsage/updated`, `account/rateLimits/*`).
- Les USD affichés sont des **équivalents au tarif API public, non facturés** en plus de l'abonnement.

## Ce qui est implémenté et vérifié

| Domaine | État |
|---|---|
| Détection CLI, version, mode d'auth, plan | ✅ réel (Claude 2.1.330, Codex 0.167) |
| Exécution réelle Claude + Codex **en parallèle** | ✅ testée (E2E + dans l'app Electron) |
| Streaming, outils, fichiers modifiés, annulation | ✅ (annulation testée sur faux adaptateur ; non rejouée en réel) |
| Approbations Codex (`on-request`) | ⚠️ implémenté, **non testé en réel** |
| File persistante + concurrence globale/fournisseur/projet/agent + priorités | ✅ testé |
| Dépendances entre tâches, retry traçable, réconciliation au redémarrage | ✅ testé |
| Tracking tokens (`UsageNormalizer`, idempotence, cumulatif/final, reprise) | ✅ testé |
| Calcul USD versionné, coût rapporté séparé | ✅ testé (reproduit exactement le coût rapporté par Claude Code) |
| Quotas : Codex (5 h / 7 j) et Claude (`rate_limit_event`) | ✅ mesures réelles |
| Dashboard, Consommation (filtres, graphiques, export CSV/JSON), Quotas, Paramètres, Notifications | ✅ |
| Git worktrees (création, diff, fusion confirmée sans opération destructive) | ⚠️ implémenté, **non testé automatiquement** |
| Projets, agents (15 templates), tâches Kanban | ✅ |

## Limitations connues (honnêtes)

Tout ce qui figure dans les sections ci-dessous est implémenté et a été testé, mais l'application n'est pas « finie » pour autant. Ce qui manque ou reste limité :

**Distribution**
- Installateur **non signé** (certificat de signature de code requis) ; **Windows seulement**, macOS et Linux ne sont ni construits ni testés.
- Mise à jour automatique : la détection d'une nouvelle version est testée, pas le téléchargement ni l'installation, et aucun serveur de mises à jour n'est configuré.
- Une intégration continue (GitHub Actions) vérifie les types, les tests et les vulnérabilités à chaque envoi ; elle compile aussi macOS et Linux, **sans jamais les tester**. Licence MIT. Pas de signature de code (certificat payant).

**Fiabilité**
- Tests unitaires (vitest, 192) et une **suite de bout en bout sans IA** dans le dépôt (`npm run e2e` : l'application construite est lancée et pilotée, exécutée aussi par la CI sous Windows). Les essais réels avec Claude et Codex restent manuels. Pas de Playwright : pilotage direct par le port de débogage d'Electron.
- Interface vérifiée par audit automatique à 4 tailles de fenêtre ; pas de test sur de vrais petits écrans, d'autres facteurs d'échelle Windows, ni avec un lecteur d'écran.

**Fonctionnel**
- Automatisations : elles s'exécutent tant que l'application tourne. Le mode **arrière-plan** (Paramètres › Application) la garde active près de l'horloge et peut la lancer au démarrage de Windows (version installée) ; vérifié sur la version installée 0.2.0 : une automatisation planifiée (action « notifier ») s'est déclenchée fenêtre masquée et a créé sa notification ; l'affichage visuel de la bulle Windows n'a pas été constaté. Le démarrage avec Windows (clé de registre) s'active et se désactive correctement ; l'icône près de l'horloge a été vue à l'écran ; le thème est conservé après redémarrage ; la modification d'un message en mode Code a été testée avec un vrai appel Claude.
- En Chat, l'interdiction des outils est stricte côté Claude ; côté Codex elle repose sur une **surveillance** (l'outil interdit est interrompu et journalisé), pas sur un bac à sable.
- Serveurs MCP distants : l'application ne fait jamais l'OAuth elle-même. Elle affiche la commande officielle de Codex (`codex mcp login`, dont la prise en compte du `-c` a été vérifiée), **non essayée avec un vrai serveur OAuth** ; le test d'un serveur ne vérifie que la joignabilité.
- Dictée vocale : **absente**. La reconnaissance vocale intégrée à Electron échoue (erreur réseau, testée) ; utilisez `Windows+H` dans la zone de saisie. La lecture à voix haute utilise les voix de Windows.
- Génération d'images : Codex seulement (Claude Code n'a pas d'outil d'image). Une image consomme environ 35 000 tokens de votre quota ChatGPT (testé).
- Traduction anglaise : l'interface fixe est traduite, mais pas tous les messages dynamiques ni le contenu des conversations.
- Les quotas des fournisseurs ne peuvent pas être contournés (par conception) ; les Chat/Work **natifs** de claude.ai et ChatGPT ne sont pas accessibles (aucune API officielle).

Écarts d'architecture : monorepo réduit à `packages/core` (+ `apps/desktop`) ; SQL brut au lieu de Drizzle ; pas de Zod sur l'IPC (liste blanche de méthodes à la place) ; pas de shadcn/Monaco/TanStack Query.

Précisions de mesure :
- Claude : usage **final par modèle** (`result.modelUsage`), les sous-agents ne sont pas attribuables séparément (cumulés dans le parent).
- Codex : compteurs **cumulatifs** convertis en deltas ; sur thread repris, base = `total - last` (confiance « calculated »).
- Le tier « long contexte » (Haiku 5.5 > 100k, OpenAI > 272k) n'est pas évalué : la taille par requête est inconnue ; le tarif standard est utilisé et la note est affichée.
- Les identifiants de modèles Claude du catalogue sont dérivés des noms d'affichage de la page tarifaire (confirmés pour `claude-sonnet-5-5`) ; un modèle sans correspondance affiche « Prix non disponible ».
- Tarifs vérifiés le 2026-11-22 (platform.claude.com, developers.openai.com) ; la promotion `gpt-5.6-sol` se termine le 2026-11-30.
- Tests réalisés sur Windows uniquement ; macOS/Linux non vérifiés.
- Erreur transitoire Codex sous Windows (verrou SQLite de `~/.codex` si deux app-server démarrent/s'arrêtent simultanément) : une relance automatique est faite.

## Structure

```
packages/core/src   db, events, pricing, usage, providers/{claude,codex,common}, execution, git, analytics, service
apps/desktop/src    main (IPC liste blanche), preload (contextBridge), renderer (React + Tailwind + Recharts)
```
Sécurité Electron : `contextIsolation`, `sandbox`, pas de `nodeIntegration`, CSP stricte, navigation externe bloquée.

## Refonte UX/UI (première version, thème sombre)

Design system dans `apps/desktop/src/renderer/styles.css` (tokens CSS) + `tailwind.config.cjs` ; composants dans `ui.tsx`, `overlay.tsx` (toasts, `confirmDialog`), `Shell.tsx` (sidebar repliable, topbar, panneau d'activité, palette Ctrl/Cmd+K) ; textes dans `i18n.ts` (FR, prêt pour l'anglais). Pages chargées en lazy-load.

Vérifié : typecheck, build, 32 tests (logique UI incluse), parcours réel dans Electron (Claude + Codex en parallèle, reprise de session des deux fournisseurs), 0 erreur console, captures à 900×700, 1280×720 et 1440×900.

Limites de cette refonte : sous-tâches et multi-sélection non implémentées ; Workflows, Comparaison IA et MCP & Skills affichent « Bientôt disponible » ; Monaco/diff côte à côte non implémentés (diff unifié coloré) ; i18n : français uniquement ; pas de virtualisation des longues listes ; accessibilité travaillée (focus visible, focus-trap des dialogues, aria, reduced-motion) mais non auditée WCAG ni testée avec un lecteur d'écran ; glisser-déposer du Kanban non testé en geste réel (règles testées unitairement) ; 1920×1080 et écrans haute densité non vérifiés ; pas de tests Playwright automatisés.

## Terminal intégré

Page **Terminal** : vrai PTY (`@lydell/node-pty`, ConPTY sous Windows, binaires précompilés) + xterm.js (thème de l'app, scrollback 10 000 lignes, recherche Ctrl+F, copie, collage sécurisé, redimensionnement automatique, onglets qui survivent à la navigation). Trois types : **Claude Code** et **Codex** (CLI officiels non modifiés, interface interactive) et **Shell**, dans le dossier d'un projet.

- Même garde-fou que les exécutions : CLI absent / déconnecté → message clair ; mode abonnement exclusif → refus si l'authentification n'est pas vérifiée « abonnement » ; variables de clé API des deux fournisseurs retirées de l'environnement ; création journalisée (audit).
- Codex est lancé avec son option officielle `--no-daemon` quand le CLI installé la déclare (sinon l'app de bureau refuse de démarrer sans démon).
- Le terminal interactif n'expose aucune mesure structurée : sa **consommation n'est pas suivie** (indiqué dans l'interface). Pour des tokens mesurés, utiliser Sessions.
- Vérifié : 7 tests du gestionnaire (vrai shell PTY, sortie, redimensionnement, scrollback, garde-fou, environnement), puis dans Electron : shell, Claude Code et Codex interactifs, saisie clavier réelle, redimensionnement, fermeture/arrêt, 0 erreur console.
- Non vérifié : recherche Ctrl+F, copier/coller et confirmation de collage multi-lignes dans l'interface réelle ; macOS/Linux ; empaquetage (le module natif devra être `asarUnpack`).
- Limite : les terminaux ne survivent pas à la fermeture de l'application (pas de reprise de processus).

## Orchestrateur et handoffs

Page **Orchestrateur** : un objectif → un plan en DAG → des agents Claude et Codex qui collaborent par handoffs explicites.

- **Modes** : *manuel* (vous construisez le plan), *assisté* (un agent « Orchestrateur » en lecture seule propose le plan, vous le relisez/éditez et l'approuvez), *automatique* (lancement immédiat, mais approbation demandée avant chaque étape qui peut écrire).
- **Le moteur local reste responsable** : validation du plan (clés uniques, dépendances existantes, cycles, 12 tâches max, avertissement sur écritures parallèles dans un même dossier), ordre d'exécution, concurrence (file existante), autorisations (portes d'approbation + étapes de validation humaine), retries traçables, reprise après redémarrage. Rien n'est créé avant approbation du plan.
- **Handoffs** : à chaque dépendance, un `AgentHandoff` structuré est construit (objectif, résumé, décisions, fichiers modifiés, commits si worktree, résultats de tests, erreurs, questions ouvertes, prochaines étapes, consommation), persisté, affiché, et injecté (limité à ~6 000 caractères) dans le prompt de l'étape suivante. Les agents ne partagent jamais de session : une exécution distincte par étape. Décisions/questions/prochaines étapes viennent d'un bloc ```handoff que l'agent est invité à produire ; sinon le handoff est marqué « Résumé seul ».
- **Choix du fournisseur** : celui du plan, sinon l'autre s'il est indisponible (jamais en contournant le mode abonnement), avec trace dans le journal. Les tâches orchestrées ne peuvent pas être lancées depuis le Kanban.
- Rapport final (tableau durée/tokens/USD éq. par étape + résumés), journal d'événements, graphe React Flow en direct.
- Vérifié : 20 tests moteur (faux fournisseurs : parallélisme, handoffs, gates, échec/retry, annulation, auto, bascule fournisseur, plan invalide, réconciliation) puis **exécution réelle** : plan proposé par Claude, approuvé via l'interface, 3 agents Claude → Codex → Claude enchaînés (fichier correct sur disque, 2 handoffs structurés, rapport), 0 erreur console.
- Limites : la liste « fichiers modifiés » d'un handoff vient des événements structurés de modification de fichiers ; un agent Codex qui écrit via une commande shell ne les génère pas (visible dans le test réel : liste vide alors que le fichier existait) ; la consommation du planificateur est tracée dans Consommation (agent « Orchestrateur ») mais pas incluse dans le total de l'orchestration ; la fusion des worktrees reste manuelle ; pas de sous-orchestrations ni de nœuds conditionnels (Phase Workflows) ; un plan approuvé n'est plus modifiable.

## Trois expériences : Chat, Work, Code

La barre latérale expose **Chat**, **Work** et **Code** (+ une section commune : Vue d'ensemble, Consommation, Quotas, Notifications, Paramètres). L'accueil (`/`) permet de choisir immédiatement ; Ctrl+1/2/3 changent de mode, Ctrl+N crée un élément dans le mode courant.

| | Chat | Work | Code |
|---|---|---|---|
| Projet requis | non | non (espace dédié) | oui |
| Dossier d'exécution | dossier vide isolé | `works/<id>/` (sources + livrables) | le projet |
| Outils | **aucun** | dossier de travail | projet (écriture, commandes) |
| Politique | `ChatPolicy` | `WorkPolicy` | `CodePolicy` |

**ExperienceMode** (`chat | work | code`, + `direct | multi_agent` pour Code) et les politiques sont dans `packages/core/src/policies.ts` ; elles sont appliquées par les adaptateurs, pas seulement affichées :
- **Chat / Claude Code** : `--tools ""` + `--setting-sources project --strict-mcp-config --disable-slash-commands` (aucun outil intégré, MCP, skill ni hook utilisateur). Mesuré : 54 outils/50 skills/3 MCP chargés → 0, et **56 404 → ~3 000 tokens** par message. Sans ces options, `--tools ""` seul laissait les outils MCP disponibles.
- **Chat / Codex** : Codex ne permet pas de désactiver ses outils ; bac à sable lecture seule + dossier vide + **interruption immédiate et audit** (`policy.violation`) si un outil est utilisé. Description honnête dans l'interface (« au mieux », « non garanti »).
- Ni Chat ni Work ne sont le Chat/Work natifs de ChatGPT ou claude.ai (aucune intégration officielle) : l'interface le dit.

**Catalogue modèles/efforts dynamique** (`catalog.ts`) : Codex → `model/list` (efforts par modèle, ex. `ultra` absent de `gpt-6-luna`) ; Claude → alias et niveaux d'effort lus dans `claude --help`, plus modèles déjà observés (le CLI n'expose pas la liste du compte). `validate()` refuse tout modèle/effort non exposé ; l'effort **appliqué** (pas seulement demandé) est enregistré par message. `AIModelConfiguration` est le composant unique (Chat, Work, Code Chat, Paramètres > Modes IA, assistant d'agent).

**Conversations** : une liste indépendante par mode (favoris, archives, recherche, renommage, export, suppression confirmée sans perte de statistiques). Même fournisseur : session reprise, y compris changement de modèle/effort ; autre fournisseur : **nouvelle session avec contexte transmis explicitement**, tracée dans l'historique de configuration. « Continuer dans Code » crée une conversation Code avec un contexte explicite, sans déplacer la source.

**Work local** : objectif, sources copiées explicitement, conversation, étapes gérées par l'utilisateur (plan IA importé seulement sur demande), livrables = fichiers réellement présents dans `livrables/`, activité, consommation.

**Consommation par mode** : chaque exécution porte son mode ; `Σ par mode = total global` (testé). Seules les utilisations observées par l'app sont comptées.

Vérifié : 87 tests (24 pour les modes avec faux fournisseurs) ; en réel dans Electron et dans l'**installateur** : Chat sans projet (effort, changement de modèle avec reprise, changement de fournisseur → nouvelle session), Code Chat (fichier créé dans le projet), Work (source lue, livrable écrit), analytics par mode.

Limites : Régénérer = renvoi du dernier message comme nouveau tour (pas de régénération native) ; pas de pièces jointes en Chat (non prises en charge, donc non affichées) ; Claude : un effort non accepté par un modèle est refusé par le CLI (non vérifiable à l'avance) ; l'interruption d'outil en Chat/Codex est testée avec un faux fournisseur (Codex n'a pas tenté d'outil en réel) ; `AIModelConfiguration` n'est pas encore dans la création de tâche (pas de champ effort côté tâches) ; raccourcis clavier et clics favoris/archives non testés au geste réel.

## Packaging (Windows)

`npm run package -w @acc/desktop` (dossier) / `npm run dist -w @acc/desktop` (installateur NSIS, 93 Mo). Module PTY natif en `asarUnpack`. **Validé** : exécutable empaqueté et application **installée** (installation silencieuse `/S /D=…`) — UI, SQLite, détection des CLI, PTY réel, catalogues, Chat réel ; désinstallation propre. Non signé (SmartScreen avertira), icône Electron par défaut, pas de mise à jour automatique, macOS/Linux non construits (les paquets PTY natifs par plateforme doivent être installés sur chaque OS).

## Workflows, comparaison, mémoire, sauvegarde, limites

- **Workflows** : 5 modèles livrés (Feature Development, Bug Fix, Refactoring, Security Audit, Dual AI Review) + workflows personnalisés (éditeur de nœuds + graphe React Flow, duplication, statistiques tokens/USD/réussite par workflow). Nœuds : agent IA, validation humaine, **test** (exécute réellement une commande dans le projet, code 0 = succès, délai 10 min, confirmation explicite au lancement ; un plan proposé par l'IA exige toujours une approbation avant toute commande) et notification. `{{goal}}` = objectif.
- **Comparaison IA** : même instruction pour 2–4 configurations Claude/Codex, exécutions indépendantes et simultanées ; avec écriture : un worktree Git isolé par version (le dépôt principal n'est jamais touché, rien n'est supprimé automatiquement) ; lecture seule sinon. Durée, tokens in/out/cache, USD éq., fichiers modifiés, diff, résultat ; retenir une version / conserver les deux / synthèse en Chat sans outil. Les valeurs les plus basses sont signalées à titre d'information, pas comme verdict.
- **MCP et Skills** : lecture seule via `claude mcp list`, `codex mcp list --json` et les dossiers de skills ; valeurs d'environnement jamais exposées.
- **Mémoire de projet** : notes épinglées injectées (3 000 caractères max) dans les sessions Code et les agents — jamais en Chat/Work.
- **Sauvegarde / restauration** : `VACUUM INTO` (copie cohérente) ; la restauration est validée, appliquée au redémarrage, l'ancienne base est conservée en `.bak`.
- **Limites d'abonnement (jamais contournées)** : mesure des fenêtres (Claude via `rate_limit_event`, Codex via `account/rateLimits`), bannière à ≥ 90 % avec réinitialisation et bascule **proposée** vers l'autre fournisseur (action explicite) ; un échec « limite atteinte » explique la prochaine réinitialisation connue. Routeur : `router.advice`.
- **Budgets** : tokens/tâche, USD éq./tâche, tokens/projet, avec option d'interruption (les mesures arrivent après consommation).
- **Détection de fichiers modifiés** indépendante du fournisseur (comparaison du dossier avant/après) : corrige la limite « Codex écrit via shell » ; en Chat, toute écriture dans le dossier isolé est auditée.
- **Pièces jointes texte** (Chat, Code) : contenu injecté dans le message (5 fichiers, 200 Ko chacun) ; **fenêtrage** des longues conversations ; tokens du planificateur inclus dans le total d'une orchestration ; fournisseur/modèle choisissables à la création d'une tâche.
- Interface en anglais pour la navigation et les libellés communs (Paramètres > Application).

Vérifié : 107 tests ; en réel : MCP (8 serveurs), workflow avec vrai test, mémoire injectée (Claude et Codex), détection d'un fichier écrit par Codex, comparaison Claude/Codex + synthèse, pièce jointe, bannière de limite sur le vrai quota ; build empaqueté (PTY, catalogue, workflows).

Non fait / limites : signature de code de l'installateur (certificat requis), macOS/Linux ; les quotas des abonnements Claude et ChatGPT sont gérés mais ne peuvent pas être supprimés.

## Automation Center, Quality Center, images, anglais, installateur

- **Automatisations** : déclencheurs manuel, intervalle (≥ 5 min), quotidien, hebdomadaire, tâche terminée, workflow terminé, contrôle qualité en échec, nouveau commit Git, fournisseur redevenu disponible ; actions : workflow, contrôles qualité, revue IA, notification, tâche de suivi, rapport de consommation. Actions sensibles confirmées à la création, plafond de lancements/jour, une exécution à la fois par automatisation, rattrapage optionnel, historique et audit. **Ne s'exécutent que lorsque l'application est ouverte.**
- **Qualité** : commandes test/lint/typecheck/build détectées (package.json, tsconfig, pytest, cargo, go) ou personnalisées, exécutées réellement dans le projet ; décompte vitest/jest/cargo/pytest (jamais de chiffres inventés), historique, taux de réussite, régressions, revue IA du diff non commité (revue croisée possible).
- **Images** (Chat, Code) : Claude via l'entrée `stream-json` officielle, Codex via les items `image` du protocole ; PNG/JPEG/GIF/WebP, 5 Mo, 4 images ; vérifié en réel avec les deux fournisseurs.
- **Anglais** : dictionnaire de ≈ 1 260 libellés (extraction AST `tools/extract-strings.mjs` + traduction `tools/translate-strings.mjs`) appliqué à l'exécution (texte, placeholder, title, aria-label) ; Paramètres > Application. Les messages dynamiques (valeurs insérées) et les conversations ne sont pas traduits.
- **Installateur** (NSIS, icône générée par `tools/make-icon.mjs`) : mises à jour **à la demande** via un dossier publiant `latest.yml` (URL configurable ; vérifié contre un serveur local : version 0.2.0 détectée). Aucune vérification ni installation automatique. Non signé.

## Extensions : serveurs MCP et skills ajoutables (Chat, Work, Code)

Page **MCP et Skills › Mes extensions** : ajoutez à tout moment un serveur MCP (local par commande, ou distant par URL) ou une skill (instructions réutilisables, ou import d'un dossier `SKILL.md`).

- **Par mode** : chaque extension est activée pour Chat, Work et/ou Code (défaut MCP : Code seul). Dans une conversation, la pastille **Extensions** du composer permet de les couper une par une.
- **MCP** : « Tester la connexion » fait un vrai handshake MCP et liste les outils. Claude reçoit `--mcp-config` (fichier temporaire supprimé ensuite) + `--allowedTools mcp__<nom>` ; Codex reçoit `config.mcp_servers` (approbation automatique des outils de ces serveurs uniquement).
- **Skills** : injectées dans les instructions de la session (8 000 caractères max au total), pour Claude comme pour Codex.
- **Sécurité** : variables d'environnement et en-têtes stockés localement, jamais réaffichés ; ajout journalisé (`extension.added`). En Chat, activer un MCP autorise ses outils (et eux seuls) : l'interface et la politique du mode l'indiquent. Tout autre outil reste interrompu et audité.
- **Limites** : un serveur MCP local exécute un programme sur votre machine — n'ajoutez que des serveurs de confiance ; le test d'un serveur distant ne vérifie que sa joignabilité ; l'authentification OAuth d'un MCP distant n'est pas gérée.

## Design (refonte « application desktop »)

- Palette graphite plus calme, boutons principaux clairs, accent violet réservé aux états actifs.
- Barre latérale : sélecteur de mode animé (Chat / Work / Code), groupes repliables mémorisés (« Outils Code », « Suivi »), statut des abonnements compact. Réduite à 64 px, elle ne montre que les icônes (nom au survol).
- Accueil simple : salutation, trois cartes de mode avec halo qui suit le pointeur, reprise des conversations récentes.
- Conversations groupées par date, messages animés, composer avec halo de focus, suggestions interactives.
- La taille de la fenêtre s'adapte à l'écran (90 % de la zone utile) et est mémorisée.
- Contrôle de non-débordement : audit automatique de toutes les pages à 4 tailles de fenêtre (`node tools/audit-overflow.mjs`, application lancée avec `--remote-debugging-port=9333`).

## Réponses enrichies (QCM, graphiques, diagrammes, aperçus)

L'interface n'est pas un terminal : elle affiche des blocs interactifs que le modèle produit dans des blocs de code balisés. Une courte consigne (≈ 470 tokens par message avec Claude, ≈ 280 avec Codex, mesurés ; désactivable dans **Paramètres › Application › Réponses enrichies**) lui explique comment faire.

| Bloc | Rendu |
|---|---|
| ```` ```quiz ```` | QCM cliquable : correction immédiate, explications, score et récapitulatif calculés **localement** (aucun token supplémentaire) ; bouton pour discuter des résultats |
| ```` ```choices ```` | Question à choix cliquables (simple, multiple, « autre ») : le choix est renvoyé au modèle comme message |
| ```` ```chart ```` | Graphique en barres, courbes, aires ou secteurs, export CSV |
| ```` ```mermaid ```` | Diagramme (flux, séquence, etc.) |
| ```` ```artifact ```` | Page HTML/JS complète en **aperçu interactif isolé** (plein écran, copie, enregistrement) ; ```` ```svg ```` pour une image |
| `$$…$$` | Formules LaTeX (KaTeX) ; coloration syntaxique des blocs de code |

**Sécurité de l'aperçu HTML** : il s'exécute dans un iframe `sandbox` servi par un schéma dédié (`acc-artifact://`) avec une politique de sécurité sans réseau. Le code de l'aperçu ne peut ni accéder à l'application, ni à son stockage, ni à Internet (vérifié). Les états des QCM et des choix sont mémorisés localement par bloc.

Les JSON invalides sont affichés tels quels avec un message, sans faire échouer la réponse. En mode Code, l'outil interactif `AskUserQuestion` de Claude Code n'existe pas (exécution non interactive) : ces blocs en sont l'équivalent.

## Fonctions ajoutées après l'audit

| Fonction | Où | À savoir |
|---|---|---|
| **Génération d'images** | Fenêtre du modèle (Codex, Chat) › Génération d'images | Outil intégré de Codex, via votre **abonnement ChatGPT** (aucune clé API, jamais de repli sur un script qui en demande une). Image enregistrée dans le dossier de l'application et affichée dans la réponse ; désactivée, Codex répond qu'il ne peut pas. Testé en réel (plan Plus). |
| **Export HTML et PDF** | Boutons en haut d'une conversation | Page autonome (graphiques, formules, diagrammes, images et polices intégrés, sans script) ou PDF, rendus par l'application. Les aperçus HTML interactifs ne sont pas inclus. |
| **Mémoire** | Paramètres › Personnalisation | L'IA **propose** (bloc « Retenir ») ; rien n'est enregistré sans votre clic. Visible, supprimable, désactivable ; ≈ 450 tokens au plus par message. Sans lien avec les fichiers internes de Codex ou Claude. |
| **Connaissances** | Menu › Connaissances, fenêtre du modèle | Documents rangés et indexés localement (SQLite FTS5) ; seuls les **extraits pertinents** (≈ 2 000 tokens au plus) sont envoyés, par mots-clés. |
| **Aperçu des pièces jointes** | Clic sur la pièce jointe | Montre le texte exact que le modèle recevra, ou l'image. |
| **Lecture à voix haute** | Icône haut-parleur sous une réponse | Voix de Windows, aucun service en ligne. |
| **Sauvegarde** | Paramètres › Sauvegarde | Copie complète de la base, **sans** valeurs secrètes des serveurs MCP ; copie automatique hebdomadaire (5 conservées). |
| **Atelier graphique** | Workflows › Nouveau workflow | Canevas façon n8n : glisser des agents (15 rôles), validations, tests, notifications ; liens par poignées (boucles refusées) ; vérification en direct par le moteur ; positions enregistrées. L'**orchestrateur** est le nœud de départ : il lance les étapes dans l'ordre, en parallèle quand c'est possible, met en pause en cas d'échec et attend vos validations. « Proposer avec l'orchestrateur » demande un graphe à Claude ou Codex (lecture seule, un appel à votre abonnement) que vous corrigez ensuite. Disposition horizontale ou verticale, palette repliable, icône et teinte propres à chaque rôle. Testé en réel : glisser-déposer, enregistrement, proposition par Claude, et **lancement complet d'un workflow dessiné dans le canevas** (2 agents Claude, le second a bien reçu le résultat du premier). |
| **Cockpit des agents** | Orchestrateur › Mur d'agents, clic sur une étape | Chaque étape a son **terminal en direct** (commandes, fichiers modifiés, sortie, curseur actif), sa vue **interface** (conversation et blocs riches), son **contexte** (ce qu'elle a reçu et transmis) et son **résultat**. Le mur montre toutes les étapes d'un coup, avec un halo sur celles qui tournent. Actions : arrêter, relancer, ouvrir la session, ouvrir un terminal officiel dans le dossier du projet. **Ce n'est pas un terminal interactif** : les agents d'un workflow tournent en mode non interactif, on observe leur journal en direct. Testé pendant une vraie exécution. Le cockpit s'ouvre aussi depuis l'**atelier** (après « Lancer », le canevas suit l'exécution : état de chaque nœud, clic = cockpit) et depuis la page **Tâches** (terminal de chaque tentative). **Reprendre dans un terminal** rouvre la session de l'agent dans le vrai terminal officiel (Claude : `--resume`, Codex : `resume`) : testé en réel, Claude Code s'ouvre avec la conversation de l'étape. |
| **Atelier : confort** | Atelier graphique | Annuler/rétablir (Ctrl+Z / Ctrl+Y), copier/coller et dupliquer une étape (Ctrl+C / V / D), liens aussi créables par cases à cocher « Dépend de » (alternative au glisser-déposer, utilisable au clavier). |
| **Modèle depuis une exécution** | Orchestrateur › exécution terminée | « Enregistrer comme workflow » : le plan réussi devient un modèle réutilisable. |
| **Comparer deux exécutions** | Workflows › Détails › Exécutions | Cochez deux exécutions : état, durée, tokens et équivalent API étape par étape, avec l'écart. |
| **Performance par rôle** | Consommation | Réussite, durée, tokens et équivalent API moyens de chaque rôle d'agent. |
| **Reprise automatique** | Paramètres › Application | Option (désactivée par défaut) : les orchestrations interrompues par un redémarrage reprennent seules. |
| **Mises à jour** | Paramètres › Application | Vérification manuelle auprès des Releases GitHub du projet (`latest.yml` publié avec l'installateur) ; **jamais essayée de bout en bout** faute d'une Release plus récente que l'application installée. |
| **Test de notification** | Paramètres › Notifications | Bouton « Tester » : la bulle du bureau n'a jamais pu être constatée à l'écran par mes essais. |
| **Barre de titre intégrée** | Fenêtre principale | Aux couleurs du thème (Windows/Linux) ; l'en-tête sert de zone de déplacement. |

## Confort d'usage (huit fonctions)

| Fonction | Où | À savoir |
|---|---|---|
| **Lanceur global** | `Ctrl+Alt+Espace` (modifiable), icône près de l'horloge | Petite fenêtre : une question, Entrée, la conversation s'ouvre ici. Instance unique ; option « garder en arrière-plan » et « lancer au démarrage » (version installée). Si le raccourci est déjà pris, les Paramètres l'indiquent. |
| **Coller une image / capturer l'écran** | `Ctrl+V` dans la zone de saisie, bouton écran | Le texte collé reste du texte. Les images sont réduites à 1920 px (économie de tokens). |
| **Instructions et styles** | Paramètres › Personnalisation, sélecteur dans la fenêtre du modèle | « À propos de vous », manière de répondre, 5 styles fournis + les vôtres ; rien n'est ajouté tant que les champs sont vides. |
| **Thème clair** | Paramètres › Application › Apparence | Système, clair ou sombre ; taille de l'interface 90 à 125 %. Contrastes calculés (texte ≥ 4,5:1). |
| **Modifier un message et relancer** | Crayon sur vos messages (Chat et Code) | Crée une **nouvelle conversation** (l'original reste intact) avec l'historique précédent. Les pièces jointes ne sont pas reprises ; en Code, les fichiers déjà modifiés ne sont pas annulés. Non disponible dans Work. |
| **Bibliothèque** | Menu › Bibliothèque | QCM, graphiques, diagrammes, pages et images retrouvés dans toutes les conversations, avec recherche et filtres. |
| **Recherche web dans le Chat** | Fenêtre du modèle › Recherche web | **Opt-in par conversation** : le Chat n'est alors plus « sans outils » (badge visible) ; seuls les outils web sont autorisés. Les pages lues coûtent des tokens (mesuré : environ 45 000 avec Codex, 74 000 avec Claude sur une question). Sans activation, la recherche est explicitement désactivée pour Codex. |
| **Introduction** | Première ouverture (installation vierge), rouvrable dans Paramètres | Présente les modes, l'état des abonnements, des préférences. Ne lance aucune connexion et ne demande jamais d'identifiants. |

Quand le Chat bloque un outil non autorisé, le message de réponse nomme l'outil et explique comment faire (activer la recherche web, ou utiliser Code).
