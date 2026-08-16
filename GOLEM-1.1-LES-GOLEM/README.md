# ◈ GOLEM 1.1 — Les Golem Edition

Version mono-serveur du GOLEM Control System.

Serveur autorisé : `1205745884046958622`  
Application Discord : `1536780542589141003`

GOLEM refuse les autres serveurs Discord et la commande `/golem` est enregistrée uniquement sur **Les Golem**.

## Commandes

- `/golem panel` : lien privé du Control Panel, valable 2 heures.
- `/golem status` : état rapide du bot, de la pause et du verrou de sécurité.
- `/golem pause` : bloque les publications et sanctions automatiques, tout en continuant le suivi.
- `/golem resume` : reprend les automatismes.

## Règles GOLEM

### Clan

Le rôle **Clan** dépend uniquement des **inscriptions aux activités Planning** marquées `Compte pour Clan`.

Statuts qui donnent un crédit :
- `Inscrit`
- `Banc`

Statuts qui ne donnent pas de crédit :
- `Peut-être`
- `Absent`

Un changement Chasseur/Titan/Arcaniste ne remet pas le timer à zéro s'il s'agit simplement d'une modification d'une inscription déjà valide.

Quand un membre passe de `Absent/Peut-être` à `Inscrit/Banc`, un nouveau crédit Planning est créé.

### Gardien

Le contrôle du vocal concerne **uniquement** un membre qui :
- possède le rôle `Gardien` ;
- ne possède pas le rôle `Clan`.

Une session vocale rafraîchit le timer quand elle atteint la durée minimale configurée, **5 minutes par défaut**.

Les messages Discord ne comptent pas.

### Délais

Par défaut :
- Clan : 14 jours sans inscription Planning valide ;
- Gardien : 7 jours sans vocal valide ;
- Préavis staff : 24 heures ;
- Vocal minimum : 5 minutes ;
- Grâce après absence : 7 jours.

Mettre `0` sur le délai Clan ou Gardien désactive la règle correspondante.
Mettre le préavis à `0` désactive les sanctions automatiques : GOLEM ne sanctionne jamais sans préavis staff.

## Préavis staff

Avant un retrait de Clan ou une exclusion Gardien, GOLEM publie dans le salon configuré :

- **APPLIQUER MAINTENANT**
- **PROLONGER**
- **ATTENDRE LE DÉLAI**

Au moment de l'exécution GOLEM revérifie :
- rôle actuel ;
- activité Planning ;
- vocal valide ;
- absence ;
- rôles Admin/Modo protégés ;
- pause globale ;
- verrou de sécurité après redémarrage ;
- présence réelle du membre sur Discord.

Si le salon de préavis est absent ou inaccessible, l'action automatique est bloquée.

## Sécurité après redémarrage

Toutes les données sensibles sont dans PostgreSQL.

GOLEM stocke un heartbeat. Si le bot revient après une coupure de plus de 10 minutes, il active un **verrou de sécurité** pour la durée du préavis configuré et repousse les actions déjà en attente.

Cela évite qu'un redémarrage ou une longue veille d'hébergement provoque un kick brutal.

Attention : si l'hébergement est éteint pendant qu'un joueur fait tout son vocal, Discord ne permet pas au bot de reconstruire cette session après coup. Le verrou de sécurité évite alors une sanction immédiate, mais un hébergement réellement 24/7 reste préférable pour une mesure vocale parfaite.

## Planning

Une activité possède deux dates indépendantes :
- date/heure de l'activité ;
- date/heure de sa publication Discord.

Le Control Panel permet de modifier :
- nom ;
- Raid / Donjon / Autre ;
- tag ;
- date activité ;
- date publication ;
- salon ;
- places ;
- couleur ;
- logo URL ;
- image URL ;
- description ;
- compte ou non pour Clan.

On peut aussi publier immédiatement.

Les boutons Discord proposent :
- Chasseur ;
- Titan ;
- Arcaniste ;
- Peut-être ;
- Absent.

Le staff peut ensuite modifier :
- classe ;
- statut ;
- équipe ;
- banc ;
- présence ;
- note privée spécifique à l'activité.

Chaque modification est historisée avec l'ancienne et la nouvelle valeur.

## GOLEM-WEEK

La rubrique Planning accepte encore un code `GOLEM-WEEK:<base64url(JSON)>` pour précharger plusieurs activités.

Après import, chaque activité peut être modifiée individuellement.

## Dashboard

Le Dashboard affiche :
- calendrier mensuel ;
- activités Planning en vert ;
- vocals validés en violet ;
- absences en orange ;
- dernière inscription Planning de chaque joueur ;
- dernier vocal valide ;
- actions en attente ;
- état Pause / Actif.

L'activité Planning est toujours présentée avant le vocal.

## Absences

Le staff peut enregistrer :
- membre ;
- date de début ;
- date de retour ;
- motif.

Une absence active bloque les sanctions automatiques. Après le retour, la protection continue pendant la durée de grâce configurée.

## Gestion des rôles

Depuis la fiche d'un membre, le staff peut ajouter ou retirer tout rôle que le rôle Discord de GOLEM est autorisé à gérer.

Chaque changement est historisé.

GOLEM tente également d'enregistrer les modifications de rôles faites directement dans Discord grâce à l'Audit Log.

## Récompense hebdomadaire

Optionnelle.

GOLEM compte les activités Planning des 7 derniers jours dont la présence a été validée `Présent`. Le ou les premiers reçoivent le rôle configuré.

Victoire consécutive :
- semaine 1 : `🏆 GOLEM Hebdo`
- semaine 2 : `🏆 GOLEM Hebdo +1`
- semaine 3 : `🏆 GOLEM Hebdo +2`

Les ex æquo sont tous gagnants.

## Historique

La base conserve notamment :
- création/modification/suppression d'activité ;
- publication ;
- inscription joueur ;
- changement de classe ;
- banc / absent / inscrit ;
- équipe ;
- présence ;
- notes privées ;
- rôles ;
- absences ;
- préavis ;
- prolongations ;
- sanctions ;
- pause / reprise ;
- récompenses ;
- coupures détectées.

## Déploiement GitHub

Le dossier est volontairement prêt pour un glisser-déposer GitHub.

**Ne mets jamais ton token Discord dans GitHub.**

Le fichier `.env.example` ne contient aucun secret.

## Variables d'environnement de l'hébergeur

Obligatoires :

```text
DISCORD_TOKEN=ton_token_secret
DATABASE_URL=postgresql://...
```

Déjà codés avec leurs valeurs Les Golem si tu ne fournis rien :

```text
CLIENT_ID=1536780542589141003
GUILD_ID=1205745884046958622
```

Optionnelles :

```text
DATABASE_SSL=true
PUBLIC_URL=
PORT=3000
NODE_ENV=production
```

Sur Koyeb, `KOYEB_PUBLIC_DOMAIN` est utilisé automatiquement pour fabriquer les liens `/golem panel`.

## Discord Developer Portal

Activer au minimum :
- **Server Members Intent**.

GOLEM n'a plus besoin du Message Content Intent pour ses règles d'activité.

Le rôle du bot doit être placé au-dessus des rôles `Clan`, `Gardien` et des rôles de récompense qu'il doit manipuler.

Permissions recommandées :
- Manage Roles ;
- Kick Members ;
- View Channels ;
- Send Messages ;
- Embed Links ;
- Read Message History ;
- Use Application Commands ;
- View Audit Log.

## Démarrage local

```powershell
npm.cmd install
node index.js
```

Pour vérifier la syntaxe :

```powershell
npm.cmd run check
```
