# Admin et moteur d'Échos des siècles

L'admin est sur **https://echosdessiecles.fr/admin/** (téléphone et ordinateur, installable
sur l'écran d'accueil). Démo sans connexion : https://echosdessiecles.fr/admin/?demo

## Ce que ça fait

| Étape | Automatique | Ce que tu décides |
|---|---|---|
| Veille Interenchères (alertes e-mail lues toutes les 5 min) : art de la table + tableaux russes, live, chrono, catalogue, lots peut-être invendus | ✅ | Suivre / ignorer, prix de revente visé |
| Marteau max conseillé (règle × 3 au-dessus de 100 €, × 4 en dessous, frais acheteur compris) | ✅ | |
| Agenda des ventes + rappels Telegram 24 h et 2 h avant (+ export calendrier) | ✅ | |
| Après la vente : « as-tu gagné ? » sur Telegram | ✅ | Prix au marteau |
| Pièce créée en stock avec photos et description du lot, 3 prix proposés | ✅ | **Le prix** (un bouton ou ton chiffre) |
| Retrait Lyon / Annecy possible ? | | **Oui / non** |
| Publication site (immédiate) + eBay (API officielle) | ✅ | |
| Leboncoin : annonce prête à coller envoyée sur Telegram (voir plus bas) | à moitié | Coller, appuyer « C'est publié » |
| Vente (eBay automatiquement, site / Leboncoin en un bouton) : les autres annonces sont retirées | ✅ | |
| Livraison : Cocolis, Colissimo, Mondial Relay, retrait Lyon / Annecy, main propre | | **Le mode de livraison** |
| Rédaction des annonces par Claude (facultatif) | ✅ | Modifiable dans l'admin |

## Comment c'est construit

Tout est dans ce dépôt GitHub, rien à héberger ailleurs :

- `admin/` : l'admin (page statique sur GitHub Pages).
- `engine/` : le moteur (Node.js). Il tourne **toutes les 5 minutes sur GitHub Actions**
  (`.github/workflows/moteur.yml`), gratuit pour un dépôt public.
- `data/state.enc` : toutes les données (lots, stock, prix d'achat, marges, ventes, clients),
  **chiffrées** (AES-256) avec ta phrase secrète. Le dépôt est public, mais sans la phrase
  personne ne peut rien lire.
- `data/inbox/` : chaque action faite dans l'admin y est déposée (chiffrée) puis appliquée
  par le moteur, que l'admin relance aussitôt.

Les réponses Telegram sont traitées au cycle suivant : 5 à 10 minutes sur GitHub. Pour du
quasi instantané, le même moteur tourne en continu sur un petit serveur (`npm run serve`, voir
« Changer de serveur »).

## La console

L'admin (« Échos · Console ») se pilote au pouce sur téléphone (barre d'onglets + bouton ＋)
et au clavier sur ordinateur (barre latérale, **⌘K** ou **/** pour tout chercher) :

- **Vue d'ensemble** : chiffre d'affaires et marge sur 30 jours, courbe des ventes, entonnoir
  du marteau à la vente, ce qui attend ta décision, prochaines ventes, activité.
- **Enchères** : la veille en cartes (photo, compte à rebours, marteau max calculé dès que tu
  tapes ta revente), filtres live / chrono / catalogue, invendus, et l'agenda (export .ics).
- **Stock** : tableau en colonnes Prix à fixer › Prêtes › En ligne › Vendues, prix en un tap.
- **Ventes** : commandes, choix de la livraison, suivi.
- **Connexions** : la carte animée de tout ce qui est branché (Interenchères, Telegram, site,
  eBay, Leboncoin, Claude, Cocolis, Stripe à venir), un interrupteur par service, les étapes de
  mise en route, et le **coffre des secrets** pour les régler sans passer par GitHub.
- **Automatisations** : publier dès que le prix est fixé, retirer partout à la vente, rappels,
  question « gagné ? », règle de prix avec simulateur, recherches et filtres de la veille.
- **Activité** : journal du moteur, tâches en file, erreurs avec bouton « Relancer ».

## Mise en route (une fois)

Jamais de mot de passe ni de clé dans le chat. Tout se règle depuis l'admin, qui chiffre chaque
secret sur ton appareil avant de l'envoyer à GitHub (ou à la main : dépôt › Settings › Secrets
and variables › Actions).

1. **Jeton GitHub pour l'admin** : github.com › Settings › Developer settings › Fine-grained
   tokens › Generate. Dépôt : seulement `echos-des-siecles`. Permissions, en lecture et
   écriture : *Contents*, *Actions* et *Secrets*. Colle-le sur la page de connexion de l'admin.
2. **Phrase secrète** : invente une phrase d'au moins 12 caractères et entre-la à la connexion.
   Puis Connexions › Coffre des secrets › `ECHOS_DATA_KEY` › « Utiliser ma phrase secrète
   actuelle ». Garde-la bien : si tu la perds, les données sont illisibles.
3. **Bot Telegram** : dans Telegram, écris à `@BotFather` › `/newbot` › nom « Échos des siècles ».
   Il donne un jeton : colle-le dans `TELEGRAM_BOT_TOKEN`. Puis ouvre ton bot et envoie `/start` :
   il se lie à ton compte (et à lui seul).
4. *(facultatif)* **Rédaction IA** : clé sur console.anthropic.com : `ANTHROPIC_API_KEY`.
5. *(facultatif, plus tard)* **eBay** : compte développeur sur developer.ebay.com, appli en
   production, jeton utilisateur, et politiques vendeur (livraison, paiement, retour) dans ton
   compte eBay. Secrets : `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `EBAY_REFRESH_TOKEN`,
   `EBAY_FULFILLMENT_POLICY_ID`, `EBAY_PAYMENT_POLICY_ID`, `EBAY_RETURN_POLICY_ID` et la variable
   `EBAY_LOCATION_KEY` (lieu d'expédition créé dans eBay, à régler dans GitHub).

6. **Veille Interenchères par alertes e-mail** : Interenchères bloque les serveurs (anti-robot
   Cloudflare, vérifié le 2026-11-09 depuis GitHub et depuis le cloud), on ne le contourne pas.
   À la place, le moteur lit les alertes e-mail qu'Interenchères envoie lui-même :
   - créer une boîte dédiée (ex. `veille.echos@gmail.com`), activer la validation en 2 étapes,
     puis créer un **mot de passe d'application** (Compte Google › Sécurité) ;
   - sur interencheres.com (compte du client), lancer chaque recherche (Baccarat, Saint-Louis,
     école russe…) et l'enregistrer en **alerte**, envoyée à cette boîte ;
   - dans l'admin : `VEILLE_IMAP_USER` (l'adresse) et `VEILLE_IMAP_PASS` (le mot de passe
     d'application). `VEILLE_IMAP_HOST` seulement si ce n'est ni Gmail, Outlook, Orange, Free,
     Yahoo ni iCloud.
   Le moteur lit la boîte en lecture seule toutes les 5 minutes, garde les e-mails dont
   l'expéditeur contient « interencheres », en extrait chaque lot (lien, titre, photo,
   estimation, date, live ou chrono), calcule le marteau maximum et prévient sur Telegram.
   La veille ne place jamais d'enchère.

## Leboncoin

Leboncoin n'a pas d'API pour les particuliers et ses conditions interdisent les robots : un
compte peut être suspendu, et les serveurs cloud sont bloqués par leur anti-robot. Trois options :

Le mode se choisit dans Connexions › Leboncoin :

1. **Assisté** : le bot envoie titre, description, prix, catégorie et photos ; tu colles
   dans l'app (30 s) et tu appuies sur « C'est publié ». À la vente ailleurs, il te rappelle de
   supprimer l'annonce.
2. **Via Claude** : les annonces à publier et à supprimer se mettent en file dans l'admin ;
   Claude les traite depuis le Chrome d'un ordinateur allumé, avec la session Leboncoin du
   client. Ne marche donc pas ordinateur éteint, et Leboncoin n'aime pas l'automatisation.

Le mode **Assisté** est celui qui marche tout éteint : c'est le réglage par défaut.
3. **Compte Leboncoin Pro** : l'import d'annonces officiel (payant) permet une vraie diffusion
   automatique, sans risque.

## Ce qu'il faut payer

| Poste | Prix | Obligatoire ? |
|---|---|---|
| GitHub (site, admin, moteur toutes les 5 min) | 0 € (dépôt public) | oui |
| Domaine echosdessiecles.fr (IONOS) | déjà payé, renouvellement annuel | oui |
| Telegram | 0 € | oui |
| Veille Interenchères | 0 € | oui |
| API eBay | 0 € (frais de vente eBay habituels selon ton statut) | si eBay |
| Rédaction IA (Claude Haiku, paiement à l'usage) | quelques centimes par mois (< 0,001 € par annonce) | non |
| Petit serveur pour des réponses Telegram instantanées | ≈ 4 à 6 € / mois | non |
| Paiement par carte sur le site (Stripe, étape suivante) | 1,5 % + 0,25 € par vente, pas d'abonnement | quand on l'active |
| Leboncoin Pro (import d'annonces automatique) | sur devis Leboncoin | non |

Le fonctionnement **ne dépend d'aucun abonnement Claude** : un abonnement ne sert qu'à faire
évoluer le code avec Claude.

## Changer de serveur

Le moteur ne dépend que de variables d'environnement (les mêmes noms que les secrets). Sur
n'importe quelle machine avec Node 20+ :

```sh
git clone https://github.com/u8tscared/echos-des-siecles && cd echos-des-siecles/engine
npm ci
export ECHOS_DATA_KEY=… TELEGRAM_BOT_TOKEN=…   # etc.
GIT_SYNC=1 npm run serve                        # cycle toutes les 20 s, pousse les changements
```

Dans ce cas, désactive le workflow GitHub (Actions › Moteur › Disable) pour qu'ils ne tournent
pas en même temps.

## Développer

```sh
cd engine && npm ci && npm test   # parcours complet simulé, sans réseau
python3 -m http.server -d ..      # puis http://localhost:8000/admin/?demo
```
