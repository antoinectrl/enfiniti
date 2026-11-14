/* ============================================================
   CATALOGUE DRIPT — prix, stock, livraison.
   Ce fichier est lu par le site ET par le paiement Stripe,
   donc les prix affichés et les prix payés sont toujours les mêmes.
   Prix en centimes : 3500 = 35,00 €.
   compareAt = prix barré. Loi française : ce doit être le prix le plus bas
   que tu as pratiqué dans les 30 jours avant la promo. Si tu n'as jamais vendu
   à ce prix, laisse null (aucun prix barré affiché).
   stock = stock de DÉPART. Les ventes sont déduites automatiquement via Stripe.
   ============================================================ */
(function (root) {
  const CATALOG = {
    currency: "eur",
    shipping: { amount: 500, freeFrom: 2, label: "Livraison suivie" },   // 5 €, offerte dès 2 pièces (lots compris)
    dropDate: "2026-11-26T18:00:00+01:00",                   // ouverture : jeudi 26 novembre, 18 h (veille du Black Friday)
    dropEnd:  "2026-11-30T23:59:00+01:00",                   // fin : lundi 30 novembre (Cyber Monday), 23 h 59
    contact:  "contact@tondomaine.fr",                       // e-mail affiché dans les pages légales

    products: [
      {
        id: "hoodie", name: "Hoodie épais", price: 3500, compareAt: null,
        images: ["img/hoodie-front.jpg", "img/hoodie-back.jpg", "img/room-girl.jpg"],
        description: "Molleton épais, capuche doublée grise, coutures ondulées et étiquette rouge au dos. Coupe ample.",
        weight: 0.9,   // kg, pour les étiquettes
        stock: { noir: { XS: 25, S: 38, M: 24, L: 6, XL: 5 } }
      },
      {
        id: "zip", name: "Zip à capuche", price: 2500, compareAt: null,
        images: ["img/zip-duo.jpg", "img/jog-duo.jpg"],
        description: "Zip à capuche en molleton plus léger, logo brodé sur la poitrine. Coupe ample.",
        weight: 0.6,
        stock: { gris: { XS: 2, S: 4, M: 4, L: 0, XL: 3 }, noir: { XS: 0, S: 7, M: 0, L: 1, XL: 1 } }
      },
      {
        id: "jogging", name: "Jogging", price: 2500, compareAt: null,
        images: ["img/jog-duo.jpg", "img/zip-duo.jpg"],
        description: "Jogging large, poche arrière brodée, coutures courbes.",
        weight: 0.6,
        stock: { gris: { XS: 1, S: 0, M: 1, L: 0, XL: 1 } }
      }
    ],

    /* Cyber Monday automatique : le lundi 30/11, les hoodies XS et S passent à 29 €.
       Mets null pour désactiver. */
    cyberMonday: { from: "2026-11-30T00:00:00+01:00", product: "hoodie", sizes: ["XS", "S"], price: 2900 },

    /* Guide des tailles en cm (mets tes vraies mesures, ou laisse null pour le masquer). */
    sizeChart: null, // ex. { XS: [56, 66], S: [59, 68], M: [62, 70], L: [65, 72], XL: [68, 74] }  -> [largeur poitrine, longueur]

    /* Ensembles : chaque pièce garde sa propre taille. */
    bundles: [
      { id: "pack-2hoodies", name: "Lot de 2 hoodies épais", price: 5900, compareAt: null,
        image: "img/room-duo.jpg", parts: ["hoodie", "hoodie"],
        description: "Deux hoodies épais, une taille pour chacun. Un pour toi, un à offrir. Livraison offerte." },
      { id: "pack-hoodie-zip", name: "Hoodie épais + zip", price: 5500, compareAt: null,
        image: "img/hoodie-front.jpg", parts: ["hoodie", "zip"],
        description: "Le hoodie épais et le zip à capuche, chacun dans ta taille." },
      { id: "pack-hoodie-jogging", name: "Hoodie épais + jogging", price: 5500, compareAt: null,
        image: "img/jog-duo.jpg", parts: ["hoodie", "jogging"],
        description: "L'ensemble complet. Joggings en très petite quantité." }
    ]
  };
  /* Prix réel d'une pièce selon la taille et la date (utilisé par le site ET par le paiement). */
  CATALOG.priceFor = function (p, size, now) {
    const cm = CATALOG.cyberMonday;
    if (cm && p.id === cm.product && (!size || cm.sizes.includes(size)) && (now || Date.now()) >= new Date(cm.from).getTime()) return cm.price;
    return p.price;
  };
  CATALOG.cyberMondayOn = function (now) { return !!CATALOG.cyberMonday && (now || Date.now()) >= new Date(CATALOG.cyberMonday.from).getTime(); };
  if (typeof module !== "undefined" && module.exports) module.exports = CATALOG;
  else root.CATALOG = CATALOG;
})(this);
