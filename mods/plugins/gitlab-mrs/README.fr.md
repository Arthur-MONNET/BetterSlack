# GitLab

Vos merge requests GitLab ouvertes, par projet, avec les étapes et les jobs de chaque pipeline, dans une vue du rail de Slack et en résumé de pipeline dans sa barre du haut.

- **Une vue dans le rail** liste toutes les merge requests ouvertes que vous avez écrites, dans tous les groupes et projets que votre compte voit, regroupées par **projet** — celui dont une merge request a bougé le plus récemment en premier, et de même à l’intérieur de chaque projet. Chaque ligne donne son titre, son numéro, ses branches, sa dernière modification, et sa pipeline sous forme de rangée d’**étapes** (✓ réussie, ✕ échouée, ◜ en cours, ○ en attente, ▶ manuelle, ⊘ annulée, » ignorée) avec son avancement.
- **Les projets se replient.** Cliquez sur le bandeau d’un projet (ou sur son chevron) pour le replier, et de nouveau pour l’ouvrir, ou utilisez **Tout replier** ; le choix est gardé, et un projet replié dit toujours combien de ses pipelines ont échoué et combien sont en cours. Une merge request tient sur une ligne quand la vue est large, deux quand elle est moyenne, et s’empile quand elle est étroite.
- **Un clic sur une étape** ouvre ses jobs, chacun avec son état et sa durée, chacun un lien vers sa page GitLab. Les titres, numéros, projets et pipelines renvoient aussi vers GitLab.
- **La barre du haut**, tout à gauche, garde sous les yeux la pipeline en cours — ou, s’il n’y en a pas, la dernière terminée — pendant que vous êtes dans un canal : *⑂ Vision !1658 feature/nav-cleanup build 2/4 ✓ ◜ ○*. L’icône est une merge request teintée selon l’état de sa pipeline (vert, rouge, bleu, gris). Quand la place diminue, elle abandonne d’abord la branche de la merge request, puis le nom de l’étape, la rangée d’étapes, le projet et la merge request, et garde l’icône en dernier. Quand quelque chose a échoué, ce qui a échoué est gardé plus longtemps que le projet.
- **Un clic sur la barre** (un chevron dit qu’elle s’ouvre) liste la pipeline la plus récente de chacune des trois branches travaillées en dernier — une par branche, donc une branche poussée trois fois n’est qu’une entrée —, chacune avec le titre et la branche de sa merge request, son état, ses étapes — un clic sur l’une ouvre ses jobs — et des boutons qui ouvrent la merge request et la pipeline sur GitLab. **Voir plus** ouvre la vue du rail.
- **Elle bouge toute seule.** Une pipeline en cours est consultée toutes les 30 secondes (10 avec la vue ouverte), la liste entière toutes les quelques minutes, et rien du tout tant que la fenêtre de Slack est masquée. **Actualiser** relit tout.

## Mise en route

1. Créez un **jeton d’accès personnel** dans GitLab, sous *Préférences*, *Jetons d’accès*, avec le seul périmètre **`read_api`**. Rien ici n’écrit dans GitLab.
2. Installez et activez GitLab depuis la boutique.
3. Cliquez sur l’onglet GitLab du rail (ou sur **GitLab · Se connecter** dans la barre du haut), vérifiez l’adresse, collez le jeton, puis **Se connecter**.

Votre nom d’utilisateur vient de GitLab — rien à son sujet n’est à configurer.

## Ce qui est compté

`7/12` est le nombre de jobs terminés sur ceux qui s’exécuteront d’eux-mêmes. **Terminé** veut dire réussi, échoué (y compris un échec que la pipeline autorise) ou annulé. Les jobs **manuels** et **ignorés** ne sont dans aucun des deux nombres — un déploiement manuel empêcherait sinon une pipeline d’afficher 12/12, et le compter comme fait serait faux — et le nombre de jobs manuels est dit à côté. La rangée d’étapes est l’information ; le ratio n’est qu’un résumé.

Une étape est aussi mauvaise que son pire job : un échec se voit tout de suite, même si le reste de l’étape tourne encore. Un job échoué que la pipeline autorise à échouer s’affiche en avertissement, pas en échec. Un job en attente d’une personne est gris et ne colore pas son étape : une étape de jobs réussis et d’un déploiement manuel s’affiche comme réussie, et n’est grise que s’il n’y a rien d’autre dedans.

## Où est le jeton, et ce qui est envoyé

Le jeton n’est **pas gardé par ce plugin**. Il est confié une fois au loader de BetterSlack (`api.net.setCredential`), qui le garde dans `~/.betterslack/credentials/gitlab-mrs.json`, lisible par vous seul, et l’ajoute en en-tête `PRIVATE-TOKEN` aux requêtes vers l’adresse des réglages de ce plugin — et vers aucune autre. La page peut le donner et l’effacer, jamais le relire. Il n’est pas dans `settings.json`, donc pas dans une sauvegarde. C’est un fichier simple, **non chiffré** : protégez-le comme le jeton qu’il contient. Se déconnecter, un jeton que GitLab refuse, ou retirer le plugin le supprime.

Ce qui part vers GitLab est un chemin et un identifiant : votre utilisateur, vos merge requests ouvertes, leurs projets, leurs pipelines et leurs jobs, en lecture seule. **Rien de Slack n’est jamais envoyé** — ni message, ni canal, ni espace de travail, ni jeton Slack — et le plugin ne lit pas les messages de Slack.

Les dernières réponses sont gardées dans `~/.betterslack/data/gitlab-mrs/` (titres, branches, pipelines, jobs — pas de jeton), vieilles d’un jour au plus et bornées en taille, pour qu’un redémarrage dessine aussitôt avant d’actualiser. Se déconnecter les supprime.

## Réglages

- **Adresse de GitLab** — celle de votre connexion. La changer vous déconnecte : un jeton appartient à l’adresse pour laquelle il a été donné.
- **Pipeline dans la barre du haut** — activé par défaut.
- **Badge sur l’icône du rail** — pipelines en échec (par défaut), merge requests ouvertes, ou rien.
