/* GET /api/order?session_id=cs_... — récapitulatif affiché sur la page « Merci » après le paiement.
   Ne renvoie que le prénom, les articles et le total (l'identifiant de session est impossible à deviner). */
const { json } = require("../../lib/shop.js");
const { getOrder } = require("../../lib/orders.js");

exports.handler = async (event) => {
  const id = (event.queryStringParameters || {}).session_id || "";
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(id)) return json(400, { error: "Commande introuvable" });
  try {
    const o = await getOrder(id);
    if (!o.paid && !o.items.length) return json(404, { error: "Commande introuvable" });
    return json(200, { number: o.number, first_name: (o.name || "").split(" ")[0], email: o.email.replace(/^(.).*(@.*)$/, "$1•••$2"),
      relay: o.relay, items: o.items.map(i => ({ name: i.name, detail: i.detail, qty: i.qty, total: i.total })), shipping: o.shipping, total: o.total, paid: o.paid });
  } catch (e) {
    return json(404, { error: "Commande introuvable" });
  }
};
