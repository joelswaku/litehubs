# Centre de contrôle des projets

Le module **Projets** de LiteHubs rassemble le plan, le budget, les achats, les ressources, les tâches et l'historique d'un investissement sans recréer les données opérationnelles de Volaille, Porcs ou Agriculture. Le propriétaire en garde le pilotage complet ; les managers autorisés y exécutent uniquement le travail de leurs projets visibles.

Route : `/{organisation}/projects`.

## Accès et périmètre

- Le **propriétaire** garde le Centre de contrôle complet : création et annulation du projet, budget, phases, équipe, plan directeur, approbations, paiements et export Excel.
- Un **Project Manager** ne voit que les projets auxquels le propriétaire l'a affecté. Un **Provincial Manager** ne voit que les projets de ses provinces autorisées. Un **General Manager** suit les projets de l'organisation selon ses permissions existantes.
- Ces managers peuvent exécuter le travail : créer et mettre à jour des tâches, soumettre une demande d'achat ou une dépense, préparer une commande après approbation, et enregistrer une réception. Ils ne peuvent jamais créer un projet, modifier le budget ou les phases, approuver, payer, ni exporter le classeur Excel.
- Les superviseurs et employés n'ouvrent pas l'espace Projets. Ils continuent à voir leurs tâches ou leur travail quotidien dans les modules normaux.
- L'API impose toutes ces règles. Une URL saisie manuellement ne donne pas accès à un autre projet : l'enregistrement est masqué par une réponse `404` hors périmètre.
- Chaque lecture et écriture reste attachée à l'organisation, au projet et aux scopes province/site existants. Les liens opérationnels sont validés dans la même organisation avant leur création.

## Équipe projet et périodes d’affectation

Dans **Planification → Équipe**, le propriétaire affecte une personne avec un rôle normalisé : **Manager du projet**, **Manager provincial**, **Superviseur**, **Finance**, **Achats**, **Juridique**, **Administration**, **Ouvrier**, **Prestataire** ou **Autre**. Cela évite les variantes incohérentes telles que « manager », « Manager » ou « responsable projet ».

Chaque affectation contient une **date d’affectation** et, si nécessaire, une **date de fin d’affectation**. Ainsi, l’équipe peut évoluer selon les phases : la personne juridique intervient pendant l’achat du terrain, la finance pendant le paiement, puis le responsable de chantier et les ouvriers pendant la construction. Les anciennes affectations restent dans l’historique ; elles ne sont pas effacées.

Cocher **Manager du projet principal** a un effet réel côté serveur : LiteHubs attribue le rôle système `project_manager` au membre et lui donne accès uniquement à ce projet durant sa période active. Il doit exister au plus un manager principal pour une même période de projet ; lorsqu’un nouveau manager principal recouvre la même période, l’ancien est remplacé pour cette période. Une date de fin passée retire l’accès au Centre de contrôle, sans retirer les tâches opérationnelles déjà affectées au membre.

## Les huit onglets

1. **Vue d'ensemble** : objectif, plan directeur, dates, progression, budget prévu/dépensé/engagé/disponible, prochaines actions, retards, approbations et passage vers les modules métiers.
2. **Planification** : phases, jalons, responsables, coûts prévus, tâches et membres du projet.
3. **Tâches** : les vraies tâches existantes, avec filtres ouvertes/en cours/terminées/en retard et affectation à des membres.
4. **Finance** : lignes budgétaires, dépenses, approbations et formules de calcul.
5. **Achats** : demandes, bons de commande, réceptions et lignes associées.
6. **Ressources** : matériaux, stocks, actifs, machines, véhicules, maintenance, ainsi que les ressources opérationnelles réellement créées.
7. **Documents** : index des documents existants et preuves photo du projet.
8. **Activité** : chronologie dérivée des enregistrements réels du projet : création, phases, tâches, budgets, achats, réceptions, dépenses, actifs, documents et approbations.

## Traçabilité des actions

Toute création, modification, suppression ou décision effectuée depuis Projets ajoute une preuve immuable dans le journal d’audit de l’organisation. Les cartes de tâches, demandes d’achat, commandes, réceptions, dépenses et ressources affichent la dernière action avec :

- l’action réalisée ;
- le nom de la personne ;
- son rôle dans l’entreprise ;
- la date et l’heure.

Par exemple : `Créé · par Jean Mwamba · Project Manager · 29 août 2026, 11:30`.

## Formules financières

- **Prévu** = total des lignes budgétaires ; sinon budget estimé du projet.
- **Dépensé** = dépenses de projet approuvées ou payées.
- **Engagé** = montant restant des bons de commande envoyés/partiellement reçus.
- **Disponible** = prévu − dépensé − engagé.

Ainsi, une même dépense n'est jamais comptée deux fois.

## Flux d'investissement

```text
Projet → phases + budget + tâches
       → demande d'achat → approbation → bon de commande → réception
       ├─ consommable → inventaire / matériau / mouvement de stock
       ├─ durable     → actif → utilisation → maintenance
       └─ opérationnel → lot Volaille / fiche Porcs / ferme, champ ou parcelle Agriculture
```

Le projet garde le pourquoi et le coût de l'investissement. Les modules spécialisés gardent la production quotidienne.

## Ressources opérationnelles sans duplication

La table `management_project_operational_links` relie un projet à un enregistrement réel :

- lot Volaille ;
- animal, groupe ou enclos Porcs ;
- ferme, champ ou parcelle Agriculture.

Le lien ne copie aucune donnée. L'API vérifie le type autorisé et confirme que la ressource cible appartient à la même organisation. L'onglet **Ressources** affiche ensuite le nom et le statut réel de la ressource.

## API et contrôles propriétaire

Les routes ajoutées au contrôle de projet sont :

- `GET /organizations/:orgSlug/owner-management/projects/:projectId/activity`
- `GET /organizations/:orgSlug/owner-management/projects/:projectId/export.xlsx`
- `GET|POST|PATCH|DELETE /organizations/:orgSlug/owner-management/operational-links`

L'export Excel reste exclusivement réservé au propriétaire. Les routes de synthèse et d'activité sont disponibles au manager uniquement dans un projet visible dans son périmètre. L'export contient les feuilles : Vue du projet, Budget, Dépenses, Achats, Tâches, Ressources, Équipements, Index des documents et Activité.

## Correction de zone connectée

Le message « Une zone connectée n'a pas pu être chargée » venait de requêtes `projectId` appliquées à des tables enfants qui ne possèdent pas cette colonne, par exemple les lignes de commande, mouvements de matériaux et pièces de maintenance. La page charge désormais les ressources parentes avec `projectId`, puis filtre les enregistrements enfants via leurs relations existantes. Les erreurs réelles restent visibles avec le nom de la ressource concernée et une action Réessayer.

## Documents

L'index utilise les enregistrements `management_document_links` existants. Les images de terrain, construction, livraison et équipement sont déjà envoyées via le stockage image existant.

La couche de stockage actuelle n'accepte que les images. L'envoi de contrats, titres fonciers, PDF, Word ou Excel nécessite une autorisation explicite avant d'envoyer ces documents sensibles vers un stockage externe et une extension dédiée du stockage. Il n'est donc pas simulé ni envoyé silencieusement.

## Documents confidentiels

Chaque document de projet conserve un seul enregistrement dans `management_document_links`, mais peut maintenant porter une règle d’accès :

- **Toute l’entreprise** ;
- **Équipe du projet** ;
- **Propriétaire uniquement** ;
- **Propriétaire + partenaire** — une personne possédant le rôle `partner` ;
- **Rôles sélectionnés** ;
- **Personnes sélectionnées**.

Le propriétaire ouvre **Documents**, utilise l’icône de modification du document, puis choisit la visibilité, les rôles ou les personnes concernées. Il peut aussi interdire le téléchargement, interdire les modifications et verrouiller le document. Les fichiers restreints portent un cadenas dans l’index.

Les contrôles sont appliqués côté API, y compris pour les routes LiteHubs d’aperçu et de téléchargement. Les listes de documents, les documents liés à une tâche et les réponses de création ne renvoient plus l’URL de stockage brute : l’utilisateur passe par `/organizations/:orgSlug/files/:fileId/preview` ou `/download`, qui vérifie son organisation, son rôle, son affectation et les autorisations du document.

Les documents déjà envoyés vers un stockage public avant cette mise à jour peuvent conserver une ancienne URL du fournisseur si elle a déjà été copiée. Pour une confidentialité fournisseur complète, ils doivent être remplacés par des fichiers stockés avec une livraison privée/authentifiée ; ce changement ne copie ni ne réenvoie automatiquement aucun document existant.

## Vérification manuelle

1. Connectez-vous avec le propriétaire et ouvrez `/{orgSlug}/projects`.
2. Créez un projet, une phase, une ligne de budget et une tâche.
3. Créez une demande, un bon de commande et une réception depuis Achats.
4. Dans Ressources, créez/lien un matériau, un actif ou un lot déjà créé dans Volaille, Porcs ou Agriculture.
5. Vérifiez les montants dans Finance et la chronologie dans Activité.
6. Cliquez **Exporter Excel** et ouvrez le fichier téléchargé.
7. Connectez-vous comme Project Manager : `/projects` affiche uniquement le projet affecté. Ajoutez une tâche, une demande d'achat ou une dépense soumise ; vérifiez que créer un projet, changer le budget, approuver, payer et exporter restent indisponibles.

## Planification complète et automatisations

Les projets peuvent désormais rester en **Brouillon**, passer à **Planification**, **En attente d’approbation**, **Approuvé**, **En cours**, **En pause**, puis être **Terminé** ou **Annulé**. Le propriétaire peut conserver séparément :

- la date de fin initiale ;
- la date révisée ;
- la date de fin réelle ;
- la source de financement, le résultat attendu et l’obligation d’approbation.

Chaque phase garde les dates prévues et réelles. Une phase ou tâche peut dépendre d’une autre. LiteHubs refuse son démarrage ou sa clôture tant que le prérequis n’est pas terminé, et refuse toute dépendance circulaire.

Les coûts réels et engagés de chaque phase sont calculés depuis les dépenses approuvées/payées et les lignes restantes des bons de commande : ils ne sont pas ressaisis dans la phase. Les coûts affichés dans Planification restent donc cohérents avec Finance.

Un matériau peut maintenant être relié à l’article inventaire, au magasin et au fournisseur privilégié. Lors d’une sortie, le manager enregistre la tâche, le magasin, la personne qui sort le matériel et la personne responsable de son utilisation. Les réceptions gardent toujours la séparation commandé / reçu / endommagé / rejeté ; elles alimentent le stock ou créent l’actif durable conformément au flux existant.

Les photos de preuve sont catégorisées : terrain, construction, livraison, réception, inspection, dommage, avant/pendant/après travaux ou autre. Dans l’index Documents, sélectionner un document existant ouvre son lien de téléchargement ou de prévisualisation.

### Vérification de ce complément

1. Dans **Planification**, créez deux phases puis ajoutez une dépendance de la seconde sur la première.
2. Essayez de mettre la seconde phase en cours : LiteHubs doit expliquer le prérequis bloquant.
3. Terminez la première phase ; la seconde peut ensuite démarrer. Essayez aussi de créer une dépendance inverse : elle doit être refusée.
4. Créez une dépense approuvée ou un bon de commande lié à une phase : les colonnes Dépensé et Engagé de cette phase se mettent à jour depuis les données réelles.
5. Ajoutez un matériau et une sortie en choisissant la tâche, le magasin et les responsables.
6. Dans **Documents**, ajoutez une photo et choisissez sa catégorie ; sélectionnez un document déjà indexé pour l’ouvrir.

## Coûts et avancement des tâches

Le **coût estimé** reste une prévision saisie au moment de la planification. Le **coût réel** d’une tâche ne se saisit plus : LiteHubs l’additionne automatiquement à partir des dépenses liées à la tâche et approuvées ou payées, ainsi que des achats réellement réceptionnés. Si une dépense approuvée est déjà rattachée au même bon de commande, le montant de la réception n’est pas compté une seconde fois.

Les demandes d’achat, bons de commande et dépenses peuvent être reliés à une tâche. Un bon de commande reprend automatiquement la tâche de sa demande lorsque celle-ci existe. Le montant **engagé** représente la partie restante des bons de commande envoyés ou partiellement reçus.

L’avancement d’une tâche suit sa situation :

- **Non commencée** : 0 % automatiquement ;
- **En cours** : le responsable saisit l’avancement réel entre 0 % et 100 % ;
- **Terminée** : 100 % automatiquement.

Le statut reste la source de vérité : il n’est donc pas possible de marquer une tâche terminée à 42 % ni non commencée à 42 %.

## Travaux et jalons

Chaque enregistrement de planification possède maintenant un type :

- **Travail** : action exécutable, affectable à un employé, visible dans l’onglet **Travaux du projet** et dans **Travail quotidien** de la personne affectée ; il peut recevoir des dépenses, achats, actifs et sorties de matériel.
- **Jalon** : point de contrôle du projet, par exemple « Titre foncier vérifié ». Il reste dans **Planification**, ne devient pas du travail quotidien et ne peut pas recevoir de coût ni de ressource directement.

Les dépendances acceptent les deux types. Ainsi, plusieurs travaux peuvent précéder le jalon « Terrain officiellement acquis ». Les indicateurs de tâches ouvertes, de retard et les alertes ne comptent que les travaux. Le progrès d’une phase utilise d’abord la moyenne des travaux ; s’il n’y en a aucun, il utilise ses jalons.

Les intitulés comme « Achat du terrain » et « Vérifier le titre foncier » sont des données créées par l’utilisateur, non du texte fixe de LiteHubs. Ils se corrigent en ouvrant la phase ou le travail concerné puis **Modifier**, sans modification automatique de vos données historiques.

Les codes de travail et de jalon sont facultatifs. Lorsqu’un code est renseigné, il est unique dans le projet ; plusieurs éléments sans code sont autorisés.
L’actif peut aussi être rattaché au travail qui a motivé son acquisition ; cette relation est vérifiée dans le même projet et refuse les jalons.
