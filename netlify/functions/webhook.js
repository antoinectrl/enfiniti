/* POST /api/webhook — événements Stripe (obligatoire avant le lancement).
   Variable requise : STRIPE_WEBHOOK_SECRET (whsec_...), donnée par Stripe quand tu crées le webhook.

   - checkout.session.completed / async_payment_succeeded : commande confirmée (visible dans les logs Netlify).
   - checkout.session.async_payment_failed : paiement différé échoué → pièces remises en vente.
   - charge.refunded (remboursement total) : pièces remises en vente automatiquement. */
const crypto = require("crypto");
const { stripe, readUsage, json } = require("../../lib/shop.js");

function verify(raw, header, secret) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(",").map(p => p.split("=")).filter(p => p.length === 2).map(([k, v]) => [k, v]));
  const sigs = header.split(",").filter(p => p.startsWith("v1=")).map(p => p.slice(3));
  const t = parseInt(parts.t, 10);
  if (!t || !sigs.length || Math.abs(Date.now() / 1000 - t) > 300) return false;   // 5 min de tolérance
  const expected = crypto.createHmac("sha256", secret).update(`${t}.${raw}`, "utf8").digest("hex");
  return sigs.some(s => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}

async function release(sessionId, reason) {
  await stripe(`checkout/sessions/${sessionId}`, { method: "POST", body: { metadata: { released: "1", released_reason: reason } } });
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Méthode non autorisée" });
  const raw = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : (event.body || "");
  const sig = event.headers["stripe-signature"] || event.headers["Stripe-Signature"];
  if (!verify(raw, sig, process.env.STRIPE_WEBHOOK_SECRET)) return json(400, { error: "Signature invalide" });

  const evt = JSON.parse(raw);
  const obj = evt.data && evt.data.object;
  try {
    switch (evt.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        if (obj.payment_status !== "unpaid")
          console.log("COMMANDE", obj.id, (obj.amount_total / 100).toFixed(2) + " €", JSON.stringify(readUsage(obj.metadata)), obj.customer_details?.email || "");
        break;
      case "checkout.session.async_payment_failed":
        await release(obj.id, "paiement_echoue");
        console.log("PAIEMENT ÉCHOUÉ, stock remis", obj.id);
        break;
      case "charge.refunded":
        if (obj.refunded && obj.payment_intent) {           // remboursement total uniquement
          const list = await stripe(`checkout/sessions?limit=1&payment_intent=${obj.payment_intent}`);
          if (list.data[0]) { await release(list.data[0].id, "rembourse"); console.log("REMBOURSÉ, stock remis", list.data[0].id); }
        }
        break;
    }
  } catch (e) {
    console.error("Webhook", evt.type, e.message);
    return json(500, { error: "Traitement impossible, Stripe réessaiera" });   // Stripe renvoie l'événement plus tard
  }
  return json(200, { received: true });
};
