/* /api/admin — interface de gestion des commandes (protégée par ADMIN_PASSWORD).
   Actions : list, label, labels-pdf, ship, resend, status, methods. */
const { json } = require("../../lib/shop.js");
const O = require("../../lib/orders.js");

exports.handler = async (event) => {
  if (!O.isAdmin(event)) return json(401, { error: "Mot de passe incorrect" });
  const q = event.queryStringParameters || {};
  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (e) {}
  const action = q.action || body.action;
  try {
    switch (action) {
      case "list":
        return json(200, { orders: await O.listOrders(), config: {
          sendcloud: !!(process.env.SENDCLOUD_PUBLIC_KEY && process.env.SENDCLOUD_SECRET_KEY),
          mail: !!(process.env.BREVO_API_KEY && process.env.MAIL_FROM),
          live: /_live_/.test(process.env.STRIPE_SECRET_KEY || process.env.stripe || "") } });

      case "methods": {   // modes d'envoi Sendcloud disponibles vers la France
        const r = await O.sendcloud("shipping_methods?to_country=FR");
        return json(200, { methods: (r.shipping_methods || []).map(m => ({ id: m.id, name: m.name, carrier: m.carrier, min: m.min_weight, max: m.max_weight })) });
      }

      case "label": {     // crée les étiquettes manquantes pour les commandes données
        const ids = (body.ids || []).slice(0, 25), done = [], errors = [];
        for (const id of ids) {
          try { const o = await O.getOrder(id); if (!o.paid || o.released) throw new Error("commande non payée ou annulée");
                done.push({ id, ...(await O.createLabel(o, body.method)) }); }
          catch (e) { errors.push({ id, error: e.message }); }
        }
        return json(200, { done, errors });
      }

      case "labels-pdf": {  // PDF des étiquettes (une ou plusieurs)
        const ids = (body.parcels || []).slice(0, 50);
        if (!ids.length) return json(400, { error: "Aucune étiquette" });
        const pdf = await O.labelsPdf(ids);
        return { statusCode: 200, headers: { "Content-Type": "application/pdf" }, body: pdf.toString("base64"), isBase64Encoded: true };
      }

      case "ship": {      // marque expédiée + e-mail de suivi au client
        const done = [], errors = [];
        for (const id of (body.ids || []).slice(0, 25)) {
          try { const o = await O.getOrder(id); await O.sendShipped(o); done.push(id); }
          catch (e) { errors.push({ id, error: e.message }); }
        }
        return json(200, { done, errors });
      }

      case "resend": {    // renvoie l'e-mail de confirmation
        const o = await O.getOrder(body.id); await O.sendConfirmation(o);
        return json(200, { ok: true });
      }

      case "status": {    // changement manuel de statut
        if (!["a_preparer", "etiquette", "expediee"].includes(body.status)) return json(400, { error: "Statut invalide" });
        await O.setMeta(body.id, { status: body.status });
        return json(200, { ok: true });
      }
    }
    return json(400, { error: "Action inconnue" });
  } catch (e) {
    return json(502, { error: e.message });
  }
};
