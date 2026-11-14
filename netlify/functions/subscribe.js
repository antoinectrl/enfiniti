/* POST /api/subscribe — inscription « M'avertir ».
   Chaque e-mail devient un client Stripe (Clients > métadonnée source = liste-black-friday). */
const { stripe, json, KEY } = require("../../lib/shop.js");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Méthode non autorisée" });
  if (!KEY()) return json(503, { error: "Inscription pas encore activée" });
  let email = "";
  try { email = String(JSON.parse(event.body || "{}").email || "").trim().toLowerCase(); } catch (e) {}
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 200) return json(400, { error: "Adresse e-mail invalide" });
  try {
    const found = await stripe(`customers?limit=1&email=${encodeURIComponent(email)}`);
    if (!found.data.length) await stripe("customers", { method: "POST", body: { email, metadata: { source: "liste-black-friday" } } });
    return json(200, { ok: true });
  } catch (e) {
    return json(502, { error: "Inscription impossible pour le moment" });
  }
};
