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

      case "stats": {     // tableau de bord en direct (visites : base Cloudflare D1 ; paniers et commandes : Stripe)
        const db = event.env && event.env.DB, now = Date.now();
        const tz = "Europe/Paris", dayStart = new Date(new Date().toLocaleString("en-US", { timeZone: tz })); dayStart.setHours(0, 0, 0, 0);
        const midnight = now - (new Date(new Date().toLocaleString("en-US", { timeZone: tz })).getTime() - dayStart.getTime());
        const out = { tracking: !!db };
        if (db) {
          const one = (sql, ...v) => db.prepare(sql).bind(...v).first();
          const all = (sql, ...v) => db.prepare(sql).bind(...v).all().then(r => r.results);
          out.online = (await one("SELECT COUNT(DISTINCT sid) c FROM events WHERE ts > ?", now - 5 * 60e3)).c;
          out.carts = (await one("SELECT COUNT(*) c FROM (SELECT sid, n FROM events e WHERE ts > ? AND ts = (SELECT MAX(ts) FROM events WHERE sid = e.sid AND ts > ?)) WHERE n > 0", now - 30 * 60e3, now - 30 * 60e3)).c;
          out.today = await one("SELECT COUNT(DISTINCT sid) visitors, SUM(type='view') views, COUNT(DISTINCT CASE WHEN type='cart' THEN sid END) carted, COUNT(DISTINCT CASE WHEN type='checkout' THEN sid END) checkouts FROM events WHERE ts >= ?", midnight);
          out.days = await all("SELECT strftime('%Y-%m-%d', ts/1000, 'unixepoch', '+1 hour') d, COUNT(DISTINCT sid) v FROM events WHERE ts >= ? GROUP BY d ORDER BY d", midnight - 6 * 864e5);
          out.sources = await all("SELECT ref, COUNT(DISTINCT sid) v FROM events WHERE ts >= ? AND type='view' GROUP BY ref ORDER BY v DESC LIMIT 6", now - 7 * 864e5);
        }
        const { stripe } = require("../../lib/shop.js");
        const open = await stripe(`checkout/sessions?limit=100&status=open&created[gte]=${Math.floor(now / 1000) - 3600}`);
        out.paying = open.data.filter(s => s.expires_at * 1000 > now).length;
        out.paying_amount = open.data.filter(s => s.expires_at * 1000 > now).reduce((a, s) => a + (s.amount_total || 0), 0);
        return json(200, out);
      }

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
