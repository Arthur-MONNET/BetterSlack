// What the Mods panel says, in every language it says it in.
//
// Every mod in this repository is required to ship English and French, and a
// test fails one whose tables disagree -- while the panel around them was
// English only. A French user had French mods inside an English window, which
// is the kind of seam that makes a product feel assembled rather than built.
//
// Same rules as a mod's own dictionaries, through the same `api.i18n`
// machinery: English is required and is the fallback for an unknown language
// and for a missing key, and a key missing everywhere renders as the key rather
// than as a blank.

export const PANEL_STRINGS = {
  en: {
    title: 'BetterSlack',
    close: 'Close',
    themes: 'Themes',
    plugins: 'Plugins',
    css: 'Custom CSS',
    about: 'About',

    installed: 'Installed',
    browse: 'Browse',
    search: 'Search mods…',
    noMatch: 'Nothing matches that search.',
    allInstalled: 'Everything in the catalogue is already installed.',
    nothingInstalled: 'Nothing installed yet — the Browse shelf is where you start.',
    sortLabel: 'Sort',
    sortRecent: 'Recently installed',
    sortAz: 'Name A–Z',
    sortZa: 'Name Z–A',
    sortEnabled: 'Switched on first',
    byLine: 'v{version} · by {author}',
    filterAll: 'All',

    backToList: '‹ All mods',
    settingsTitle: 'Settings',
    install: 'Install',
    enable: 'Enable',
    disable: 'Disable',
    remove: 'Remove',
    notRunning: 'not running',
    settingsCount: 'Settings ({count})',
    settingsHide: 'Hide settings',
    textLines: '{count} line(s)',
    textExpand: 'Expand',
    textSave: 'Save',
    textRestore: 'Restore the original',

    uses: 'Uses {names}',
    needs: 'Needs {names}',
    enableIt: 'Enable it',
    enableThem: 'Enable them',
    enableAll: 'Enable all {count}',
    notInCatalogue: 'Not in the catalogue: {names}',
    cancel: 'Cancel',
    requiresTitle: '{name} needs {count} plugin(s)',
    requiresBody:
      'A theme is CSS. This one needs behaviour CSS cannot do, which lives in plugins — code that keeps running after the theme is switched off. Enabling them is your call.',

    safeTitle: 'Safe mode — nothing is loaded',
    safeAsked: 'Started with --safe. Your mods are untouched; start again without it to load them.',
    safeCrashed:
      '{reason}. Switch off whatever you suspect, then start BetterSlack again.',

    skippedTitle: '{count} mod folder(s) were skipped',
    skippedBody: 'These are in the mods folder but could not be read, so they are not listed above. The message says which file and why.',
    updateTitle: 'An update is available',
    /**
     * Both numbers, where the eye lands. Used whenever the published version is
     * known, which is nearly always; the body then says only what will happen.
     */
    updateTitleVersion: 'BetterSlack {current} → {latest}',
    updateGit: 'Updating fetches that version and rebuilds.',
    /** No version to name: a branch that moved without a release on it. */
    updateGitCount: '{count} change(s) since this copy{headline}. Updating fetches them and rebuilds.',
    updateHeadline: ' — latest: {subject}',
    updatePackage:
      'Updating downloads that version from GitHub and replaces this copy — your mods and settings are kept, they live outside it.',
    updateGo: 'Update and restart',
    updateWorking: 'Updating…',
    updateGitHub: 'Open GitHub',
    updatePulling: 'Pulling and rebuilding…',
    updateDownloading: 'Downloading and rebuilding…',
    updateDone: 'Updated. Slack is restarting…',
    updateFailed: 'Could not update: {reason}',

    /** The dot on a tab and on the launcher. Read out; never drawn as words. */
    updateAvailable: 'Update available',

    /**
     * The second line of a status tooltip. Slack words its own the same way,
     * and this is the app's dictionary rather than a mod's because the node it
     * goes on comes from api.slack.statusNode -- shared, so it cannot reach any
     * one mod's strings.
     */
    statusUntil: 'Until {when}',

    /** The start screen, under the mark. */
    splashLoading: 'Starting up…',
    splashStarting: 'Starting {name} — {done} of {total}',

    modUpdateTitle: '{name} {current} → {version}',
    modUpdateBody: 'Updating replaces this mod alone, and reapplies it if it is on.',
    modUpdateGo: 'Update',
    modUpdateWorking: 'Downloading…',
    modUpdateBlocked:
      '{name} {version} needs BetterSlack {needs}, and this is {running}. '
      + 'Update BetterSlack first — taking it now would leave a mod calling things this version does not have.',
    networkTo: 'Talks to {addresses}, through BetterSlack.',
    networkUnset: 'Talks to a server of your choosing, once you give its address.',
    networkCredential: 'Keeps a sign-in token in BetterSlack\u2019s own folder, readable only by you, and sends it to that address and nowhere else.',
    slackTooOld:
      'Written against Slack {wanted}, and this is {have}. It may not find what it expects.',

    cssHint:
      'Applied after every theme, so it always wins. Slack exposes its palette as CSS custom properties (--dt_color-*), which is a steadier target than its class names.',
    cssSave: 'Save and apply',
    cssApplied: 'Applied.',

    aboutBody:
      'BetterSlack injects into the Slack renderer over the Chrome DevTools Protocol, carried on a private pipe rather than a debugging port — nothing listens on the network. Nothing of Slack.app is changed beyond, with your permission, its icon while it starts, so Slack updates cannot break your install, but mods stay loaded only while the loader runs.',
    dockIconTitle: 'BetterSlack\u2019s icon in the Dock',
    dockIconBody:
      'BetterSlack can show its icon (or your theme\u2019s) on Slack in the Dock. To do that it puts the icon on Slack.app just before starting it, which macOS only allows with the App Management permission. Open System Settings and switch BetterSlack on there (if it is not listed, add it with +).',
    dockIconOpen: 'Open System Settings',
    dockIconLater: 'Later',
    dockIconAfter: 'Once BetterSlack is switched on in App Management, restart it so the Dock picks up the icon.',
    dockIconRestart: 'Restart',
    dockIconStill: 'macOS still refuses: switch BetterSlack on in System Settings \u203a Privacy & Security \u203a App Management.',
    dockIconPending: 'This theme changes the icon in the Dock. macOS shows a new icon only once the app starts again: restart BetterSlack now? It takes a few seconds.',
    dockIconRow: 'Icon in the Dock',
    dockIconOk: 'Slack wears BetterSlack\u2019s icon in the Dock.',
    dockIconRefused: 'Slack keeps its own icon: macOS needs the App Management permission for BetterSlack.',
    dockIconAllow: 'Allow\u2026',
    updatesTitle: 'Updates',
    updatesHint: 'BetterSlack and your mods are checked when Slack starts, then every hour.',
    updatesCheck: 'Check for updates',
    updatesChecking: 'Checking…',
    updatesFailed: 'Could not check: the update server did not answer.',
    updatesNone: 'Everything is up to date (checked at {time}).',
    updatesFound: '{count} update(s) available (checked at {time}): see the dot on the Themes, Plugins or About tab.',
    hotReload: 'Hot reload',
    hotReloadHint: 'Reapply a mod as soon as its file changes on disk.',
    version: 'Version',
    catalogue: 'Catalogue',
    yourMods: 'Your mods',
    transport: 'Transport',
    repository: 'Repository',
    contribute: 'Submit a mod',

    remoteHint: 'Install from a GitHub URL — a repository, or a folder inside one.',
    remotePlaceholder: 'github.com/someone/their-mods/tree/main/my-plugin',
    remoteFetch: 'Read it',
    remoteReading: 'Reading…',
    remoteInstalling: 'Installing…',
    remoteInstalled: '{name} installed. It is off until you switch it on.',
    remoteAccept: 'Install anyway',
    remoteFrom: 'From',
    remoteKind: 'Kind',
    remoteScripts: 'Code that will run',
    remoteNoScripts: 'none — this one is stylesheets only',
    remoteSize: 'Size',
    remoteBadge: 'unreviewed',
    remoteBadgeHint: 'From {source}. Nobody in this project has read it.',
    remoteWarningPlugin:
      'This is somebody else’s code, and nobody here has read it. A plugin runs unsandboxed in your signed-in Slack: it can read every message you can, and the session token. Install it only if you trust whoever wrote it.',
    remoteWarningTheme:
      'This is somebody else’s theme, and nobody here has read it. A theme is CSS, so it cannot read your messages — but it can hide or fake parts of the interface. Install it only if you trust whoever wrote it.',

    backupTitle: 'Backup',
    backupHint: 'Your settings and the mods you wrote or installed yourself. Catalogue mods come back with the project, so they are not in it.',
    backupExport: 'Save a backup',
    backupImport: 'Restore one',
    backupSaved: 'Saved to your downloads.',
    backupWorking: 'Restoring…',
    backupRestored: 'Restored {detail}.',

    diagTitle: 'What the mods cost',
    diagHint: 'Time spent starting, and how often Slack has undone each mod’s work.',
    diagTiming: '{ms} ms · {mounts} mounts',
    diagCopy: 'Copy a report',
    diagCopied: 'Copied',
    diagCopyFailed: 'Could not copy',

  },

  fr: {
    title: 'BetterSlack',
    close: 'Fermer',
    themes: 'Thèmes',
    plugins: 'Plugins',
    css: 'CSS personnalisé',
    about: 'À propos',

    installed: 'Installés',
    browse: 'Parcourir',
    search: 'Rechercher un mod…',
    noMatch: 'Aucun résultat pour cette recherche.',
    allInstalled: 'Tout le catalogue est déjà installé.',
    nothingInstalled: 'Rien d’installé pour l’instant — tout commence dans l’onglet Parcourir.',
    sortLabel: 'Trier',
    sortRecent: 'Installés récemment',
    sortAz: 'Nom A–Z',
    sortZa: 'Nom Z–A',
    sortEnabled: 'Activés d’abord',
    byLine: 'v{version} · par {author}',
    filterAll: 'Tous',

    backToList: '‹ Tous les mods',
    settingsTitle: 'Réglages',
    install: 'Installer',
    enable: 'Activer',
    disable: 'Désactiver',
    remove: 'Retirer',
    notRunning: 'n’a pas démarré',
    settingsCount: 'Réglages ({count})',
    settingsHide: 'Masquer les réglages',
    textLines: '{count} ligne(s)',
    textExpand: 'Agrandir',
    textSave: 'Enregistrer',
    textRestore: 'Rétablir le texte d’origine',

    uses: 'Utilise {names}',
    needs: 'Nécessite {names}',
    enableIt: 'Activer le plugin',
    enableThem: 'Activer les plugins',
    enableAll: 'Activer les {count} plugins',
    notInCatalogue: 'Absent du catalogue : {names}',
    cancel: 'Annuler',
    requiresTitle: '{name} nécessite {count} plugin(s)',
    requiresBody:
      'Un thème, c’est du CSS. Celui-ci a besoin d’un comportement que le CSS ne permet pas, et ce comportement relève des plugins — du code qui continue de s’exécuter une fois le thème désactivé. À vous de décider de les activer.',

    safeTitle: 'Mode sans échec — rien n’est chargé',
    safeAsked:
      'Démarré avec --safe. Vos mods sont intacts ; relancez sans l’option pour les charger.',
    safeCrashed: '{reason}. Désactivez ce que vous suspectez, puis relancez BetterSlack.',

    skippedTitle: '{count} dossier(s) de mod ignoré(s)',
    skippedBody: 'Ils sont dans le dossier mods mais n’ont pas pu être lus, donc ils ne sont pas listés ci-dessus. Le message indique quel fichier et pourquoi.',
    updateTitle: 'Une mise à jour est disponible',
    updateTitleVersion: 'BetterSlack {current} → {latest}',
    updateGit: 'Mettre à jour récupère cette version et reconstruit.',
    updateGitCount:
      '{count} changement(s) depuis votre copie{headline}. Mettre à jour les récupère et reconstruit.',
    updateHeadline: ' — dernier : {subject}',
    updatePackage:
      'Mettre à jour télécharge cette version depuis GitHub et remplace cette copie — vos mods et vos réglages sont conservés, ils sont stockés ailleurs.',
    updateGo: 'Mettre à jour et relancer',
    updateWorking: 'Mise à jour…',
    updateGitHub: 'Ouvrir GitHub',
    updatePulling: 'Récupération et reconstruction…',
    updateDownloading: 'Téléchargement et reconstruction…',
    updateDone: 'Mis à jour. Slack redémarre…',
    updateFailed: 'Mise à jour impossible : {reason}',

    updateAvailable: 'Mise à jour disponible',

    statusUntil: 'Jusqu’à {when}',

    splashLoading: 'Démarrage…',
    splashStarting: 'Démarrage de {name} — {done} sur {total}',

    modUpdateTitle: '{name} {current} → {version}',
    modUpdateBody: 'Mettre à jour ne remplace que ce mod, et le réapplique s’il est activé.',
    modUpdateGo: 'Mettre à jour',
    modUpdateWorking: 'Téléchargement…',
    modUpdateBlocked:
      '{name} {version} nécessite BetterSlack {needs}, et vous avez {running}. '
      + 'Mettez d\'abord BetterSlack à jour — sinon ce mod appellerait des choses que cette version n\'a pas.',
    networkTo: 'Communique avec {addresses}, via BetterSlack.',
    networkUnset: 'Communique avec un serveur de votre choix, une fois son adresse indiquée.',
    networkCredential: 'Garde un jeton de connexion dans le dossier propre à BetterSlack, lisible par vous seul, et ne l\u2019envoie qu\u2019à cette adresse.',
    slackTooOld:
      'Écrit pour Slack {wanted}, et vous avez {have}. Il peut ne pas trouver ce qu\'il attend.',

    cssHint:
      'Appliqué après tous les thèmes, il l’emporte donc toujours. Slack expose sa palette en propriétés CSS personnalisées (--dt_color-*), une cible plus stable que ses noms de classe.',
    cssSave: 'Enregistrer et appliquer',
    cssApplied: 'Appliqué.',

    aboutBody:
      'BetterSlack s’injecte dans le processus de rendu de Slack via le Chrome DevTools Protocol, acheminé par un pipe privé plutôt que par un port de débogage — rien n’écoute sur le réseau. Rien n’est changé dans Slack.app hormis, avec votre permission, son icône pendant son lancement : une mise à jour de Slack ne peut donc pas casser votre installation, mais les mods ne restent chargés que tant que le loader s’exécute.',
    dockIconTitle: 'L\u2019icône de BetterSlack dans le Dock',
    dockIconBody:
      'BetterSlack peut afficher son icône (ou celle de votre thème) sur Slack dans le Dock. Pour cela, il pose l\u2019icône sur Slack.app juste avant de le lancer, ce que macOS n\u2019autorise qu\u2019avec la permission Gestion des apps. Ouvrez les Réglages Système et activez BetterSlack (s\u2019il n\u2019est pas dans la liste, ajoutez-le avec +).',
    dockIconOpen: 'Ouvrir les Réglages Système',
    dockIconLater: 'Plus tard',
    dockIconAfter: 'Une fois BetterSlack activé dans Gestion des apps, relancez-le pour que le Dock prenne l\u2019icône.',
    dockIconRestart: 'Relancer',
    dockIconStill: 'macOS refuse toujours : activez BetterSlack dans Réglages Système \u203a Confidentialité et sécurité \u203a Gestion des apps.',
    dockIconPending: 'Ce thème change l\u2019icône dans le Dock. macOS n\u2019affiche une nouvelle icône qu\u2019au redémarrage de l\u2019app : relancer BetterSlack maintenant ? Cela prend quelques secondes.',
    dockIconRow: 'Icône dans le Dock',
    dockIconOk: 'Slack porte l\u2019icône de BetterSlack dans le Dock.',
    dockIconRefused: 'Slack garde son icône : macOS demande la permission Gestion des apps pour BetterSlack.',
    dockIconAllow: 'Autoriser\u2026',
    updatesTitle: 'Mises à jour',
    updatesHint: 'BetterSlack et vos mods sont vérifiés au démarrage de Slack, puis toutes les heures.',
    updatesCheck: 'Vérifier les mises à jour',
    updatesChecking: 'Vérification…',
    updatesFailed: 'Vérification impossible : le serveur de mises à jour n’a pas répondu.',
    updatesNone: 'Tout est à jour (vérifié à {time}).',
    updatesFound: '{count} mise(s) à jour disponible(s) (vérifié à {time}) : voir la pastille sur l’onglet Thèmes, Plugins ou À propos.',
    hotReload: 'Rechargement à chaud',
    hotReloadHint: 'Réappliquer un mod dès que son fichier change sur le disque.',
    version: 'Version',
    catalogue: 'Catalogue',
    yourMods: 'Vos mods',
    transport: 'Transport',
    repository: 'Dépôt',
    contribute: 'Proposer un mod',

    remoteHint: 'Installer depuis une URL GitHub — un dépôt, ou un dossier dedans.',
    remotePlaceholder: 'github.com/quelquun/ses-mods/tree/main/mon-plugin',
    remoteFetch: 'Examiner',
    remoteReading: 'Analyse…',
    remoteInstalling: 'Installation…',
    remoteInstalled: '{name} est installé, et restera désactivé tant que vous ne l’activerez pas.',
    remoteAccept: 'Installer quand même',
    remoteFrom: 'Provenance',
    remoteKind: 'Type',
    remoteScripts: 'Code qui s’exécutera',
    remoteNoScripts: 'aucun — uniquement des feuilles de style',
    remoteSize: 'Taille',
    remoteBadge: 'non relu',
    remoteBadgeHint: 'Depuis {source}. Personne dans ce projet ne l’a lu.',
    remoteWarningPlugin:
      'C’est le code de quelqu’un d’autre, que personne ici n’a relu. Un plugin s’exécute sans isolation dans votre session Slack : il peut lire tous les messages auxquels vous avez accès, ainsi que votre jeton de session. Ne l’installez que si vous faites confiance à son auteur.',
    remoteWarningTheme:
      'C’est le thème de quelqu’un d’autre, que personne ici n’a lu. Un thème est du CSS, il ne peut donc pas lire vos messages — mais il peut masquer ou falsifier des parties de l’interface. Ne l’installez que si vous faites confiance à son auteur.',

    backupTitle: 'Sauvegarde',
    backupHint: 'Vos réglages, et les mods que vous avez écrits ou installés vous-même. Ceux du catalogue reviennent avec le projet : ils ne figurent pas dans la sauvegarde.',
    backupExport: 'Enregistrer une sauvegarde',
    backupImport: 'Restaurer une sauvegarde',
    backupSaved: 'Enregistré dans vos téléchargements.',
    backupWorking: 'Restauration…',
    backupRestored: '{detail} — restauré.',

    diagTitle: 'Ce que coûtent les mods',
    diagHint: 'Temps passé au démarrage, et nombre de fois où Slack a défait le travail de chaque mod.',
    diagTiming: '{ms} ms · {mounts} remontages',
    diagCopy: 'Copier un rapport',
    diagCopied: 'Copié',
    diagCopyFailed: 'Copie impossible',

  },
};
