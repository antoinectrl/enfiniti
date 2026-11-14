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
