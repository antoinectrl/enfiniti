# Boutique DRIPT : mise en ligne

## Ce que contient le dossier

| Fichier | Rôle |
|---|---|
| `index.html` | Le site : page d'accueil verrouillée, boutique, panier, pages légales |
| `catalog.js` | **Prix, stock de départ, livraison (5 €), dates, e-mail de contact, guide des tailles.** Le seul fichier à modifier. |
| `netlify/functions/` | Paiement Stripe, stock en direct, webhook Stripe, inscriptions e-mail |
| `lib/shop.js` | Logique commune (calcul du stock) |
| `netlify.toml` | Réglages Netlify |
| `img/` | Photos |

En haut de `index.html` : `INSTAGRAM` (ton lien) et `PASSWORD` (aperçu avant l'ouverture, `dript` par défaut).

## Le stock est automatique

Stock affiché = stock de départ (`catalog.js`) − commandes payées dans Stripe − paniers en train de payer (bloqués 31 min, puis remis en vente s'ils sont abandonnés).
Le site se met à jour toutes les 30 secondes, et le serveur refuse tout paiement qui dépasse le stock. **Tu ne touches à rien pendant le drop.**
Remboursement total ou paiement échoué : la pièce est remise en vente toute seule (grâce au webhook). Remboursement partiel : rien ne change dans le stock.

## Les dates

- La page « Black Friday » s'affiche jusqu'au **jeudi 26 novembre à 18 h**. À 18 h, la boutique s'ouvre seule (même pour quelqu'un qui a la page ouverte).
- Fermeture le **lundi 30 novembre à 23 h 59** : la page d'accueil affiche « Terminé » et le paiement est bloqué.
- Pour changer : `dropDate` et `dropEnd` dans `catalog.js`.

## Mise en ligne (≈ 25 min, une seule fois)

**Pourquoi Netlify et pas Vercel :** le plan gratuit de Vercel interdit l'usage commercial. Celui de Netlify l'autorise.

1. **Stripe** : crée et active ton compte sur stripe.com (identité, IBAN, adresse du site). Dans *Paramètres > Moyens de paiement*, laisse Cartes, Apple Pay et Google Pay activés (le site les affiche automatiquement). Dans *Paramètres > E-mails clients*, active **Paiements réussis** et **Remboursements** pour que tes clients reçoivent leur reçu.
2. **Clé restreinte** (plus sûre qu'une clé secrète) : *Développeurs > Clés API > Créer une clé restreinte*, nommée « Boutique DRIPT ». Donne-lui seulement :
   - **Checkout Sessions : Écriture**
   - **Customers : Écriture**
   - laisse tout le reste sur **Aucun**. Copie la clé `rk_live_...`.
3. **GitHub** : crée un dépôt et mets-y tout le contenu du zip (*Add file > Upload files*).
4. **Netlify** : *Add new site > Import an existing project > GitHub*, choisis le dépôt, puis *Deploy*.
5. **Webhook** (obligatoire) : dans Stripe, *Développeurs > Webhooks > Ajouter une destination* :
   - URL : `https://TON-DOMAINE/api/webhook`
   - événements : `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `charge.refunded`
   - copie le **secret de signature** (`whsec_...`).
6. Dans Netlify, *Site configuration > Environment variables*, ajoute :
   - `STRIPE_SECRET_KEY` = ta clé restreinte `rk_live_...`
   - `STRIPE_WEBHOOK_SECRET` = `whsec_...`

   Puis *Deploys > Trigger deploy*.

C'est tout : pas de produits à créer dans Stripe, les prix viennent de `catalog.js`.

**Ce que fait le webhook :** si un paiement différé échoue ou si tu rembourses entièrement une commande, les pièces sont **remises en vente automatiquement**. Les commandes confirmées apparaissent aussi dans *Netlify > Logs > Functions > webhook*.

**Tester avant le 26/11 :** dans Stripe, crée un **sandbox** (menu du compte > *Sandboxes*). C'est un Stripe de test séparé de ton vrai compte. Fais-y une clé restreinte et un webhook identiques. Mets ces valeurs dans Netlify avec `ALLOW_EARLY_CHECKOUT` = `1`, puis paie avec la carte `4242 4242 4242 4242`. Rembourse la commande et vérifie que la pièce revient en stock. Ensuite, remets les valeurs live et **supprime** `ALLOW_EARLY_CHECKOUT`.

## Le nom de domaine

Acheter un domaine **seul ne suffit pas** : il faut aussi l'hébergement (Netlify, gratuit) et relier les deux.
Le plus simple : achète-le **directement dans Netlify** (*Domain management > Add a domain > Buy*). La connexion et le HTTPS sont alors automatiques.
Si tu l'achètes ailleurs (OVH, Namecheap…), ajoute-le dans *Domain management* puis suis les 2 réglages DNS que Netlify t'indique.
Ensuite, mets cette adresse dans ton compte Stripe (*Paramètres > Infos entreprise*) et l'e-mail de contact dans `catalog.js` (`contact`).

## Avant le 26/11

- Complète les zones surlignées en jaune dans *Mentions légales* et *Conditions de vente* (bas de page) : nom, SIRET, adresse, médiateur.
- Prix barrés : seulement si tu as vraiment vendu à ce prix dans les 30 jours précédents (`compareAt` dans `catalog.js`), sinon laisse `null`.
- Guide des tailles : mets tes mesures dans `sizeChart` (`catalog.js`).
- Photo du zip noir à ajouter.
- Les commandes et adresses arrivent dans Stripe > *Paiements*. Les inscrits « M'avertir » sont dans Stripe > *Clients* (export CSV).

## Gestion des commandes : /admin

Adresse : `https://ton-site/admin`, avec le mot de passe défini dans la variable Netlify `ADMIN_PASSWORD`.

- **Tableau de bord** : chiffre d'affaires, commandes, pièces vendues, commandes à préparer, et stock restant taille par taille.
- **Commandes** : onglets À préparer / Étiquette créée / Expédiées, recherche, détail (adresse, téléphone, suivi), export CSV pour Excel.
- **En lot** : coche des commandes, puis *Créer les étiquettes*, *Imprimer les étiquettes* (un seul PDF), *Liste de préparation* (total des pièces à sortir) et *Marquer expédiées + e-mail*.

### Sendcloud (étiquettes)
1. Crée un compte sur sendcloud.com, active tes transporteurs (Colissimo, Mondial Relay…) et renseigne ton adresse d'expédition.
2. *Paramètres > Intégrations > Sendcloud API > Connecter* : récupère la **clé publique** et la **clé secrète**.
3. Dans Netlify, ajoute `SENDCLOUD_PUBLIC_KEY` et `SENDCLOUD_SECRET_KEY`.
4. Dans /admin, choisis le **mode d'envoi** dans la liste. Prends un mode **à domicile** : la boutique ne demande pas de point relais au client.

Le poids de chaque pièce est dans `catalog.js` (`weight`, en kg).

### E-mails automatiques (Brevo, gratuit jusqu'à 300 e-mails par jour)
1. Crée un compte sur brevo.com, puis *Expéditeurs, domaines et IP dédiées* : ajoute et valide l'adresse d'envoi (par exemple commandes@tondomaine.fr ; idéalement, authentifie ton domaine).
2. *SMTP & API > Clés API* : crée une clé.
3. Dans Netlify, ajoute `BREVO_API_KEY` et `MAIL_FROM` (l'adresse validée).

Ensuite, chaque client reçoit automatiquement :
- **la confirmation de commande** juste après le paiement (envoyée par le webhook Stripe, une seule fois) ;
- **l'e-mail « ton colis est en route »** avec le lien de suivi quand tu cliques sur *Marquer expédiées*.

Si un e-mail n'est pas parti, la commande l'indique en rouge dans /admin, avec un bouton pour le renvoyer.

Après chaque ajout ou changement de variable dans Netlify, il faut redéployer le site.

## Hébergement actuel : Cloudflare Pages (gratuit, sans badge)

Adresse : https://enfiniti.pages.dev (admin : https://enfiniti.pages.dev/admin)

- `tools/build-worker.sh` fabrique `dist-worker/_worker.js` : un seul fichier qui contient les pages, les photos et toutes les fonctions `/api`.
- Ce fichier est envoyé directement à Cloudflare (projet Pages `enfiniti`).
- Variables : Cloudflare → Workers & Pages → enfiniti → Paramètres → Variables et secrets.
  - `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `ADMIN_PASSWORD`, `ALLOW_EARLY_CHECKOUT` (à supprimer avant le lancement)
  - plus tard : `SENDCLOUD_PUBLIC_KEY`, `SENDCLOUD_SECRET_KEY`, `BREVO_API_KEY`, `MAIL_FROM`
- Après un changement de variable, il faut redéployer.
- Nom de domaine : Cloudflare → Domain Registration (prix coûtant), puis enfiniti → Domaines personnalisés.

## Point relais
- Le client choisit dans le panier : **point relais Mondial Relay** (5 €, offert dès 2 pièces) ou **domicile** (7 €). Les prix se règlent dans `catalog.js` (`shipping`).
- Le point relais apparaît tout seul dès que les clés Sendcloud sont enregistrées dans Cloudflare. Avant ça, la boutique propose « Livraison suivie » à 5 €.
- Dans /admin, choisis une fois **Envoi point relais** (ex. Mondial Relay Point Relais) et **Envoi domicile** : les étiquettes partent vers le bon relais automatiquement.

## Connecteur Claude
Adresse secrète : `https://enfiniti.pages.dev/api/mcp/<MCP_TOKEN>` (variable `MCP_TOKEN` dans Cloudflare).
Dans Claude : Paramètres → Connecteurs → Ajouter un connecteur personnalisé → colle l'adresse.
Claude peut alors lire les statistiques, les commandes, le détail d'une commande et le stock (lecture seule). Ne partage pas cette adresse : elle donne accès aux commandes.
