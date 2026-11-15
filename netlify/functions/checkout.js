/* POST /api/checkout — crée la page de paiement Stripe à partir du panier.
   Les prix viennent de catalog.js (jamais du navigateur) et le stock est vérifié en direct. */
const { CATALOG, SIZES, byId, bundleById, stripe, packUsage, remainingStock, json, KEY } = require("../../lib/shop.js");
const { servicePoint } = require("../../lib/orders.js");

const valid = (pid, pick) => byId[pid] && pick && byId[pid].stock[pick.color] && SIZES.includes(pick.size) ? byId[pid] : null;

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Méthode non autorisée" });
  if (!KEY()) return json(503, { error: "Le paiement n'est pas encore activé" });
  if (Date.now() < new Date(CATALOG.dropDate).getTime() && !process.env.ALLOW_EARLY_CHECKOUT)
    return json(403, { error: "La boutique ouvre le jeudi 26 novembre à 18 h" });
  if (CATALOG.dropEnd && Date.now() > new Date(CATALOG.dropEnd).getTime())
    return json(403, { error: "Le Black Friday est terminé" });

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Requête invalide" }); }
  const items = Array.isArray(body.items) ? body.items.slice(0, 20) : [];
  if (!items.length) return json(400, { error: "Panier vide" });

  const used = {}, lineItems = [];
  for (const it of items) {
    const qty = Math.max(1, Math.min(10, parseInt(it.qty, 10) || 1));
    const add = (pid, pick) => { const k = `${pid}.${pick.color}.${pick.size}`; used[k] = (used[k] || 0) + qty; };
    if (it.type === "product") {
      const p = valid(it.id, it);
      if (!p) return json(400, { error: "Article invalide" });
      add(p.id, it);
      lineItems.push({ quantity: qty, price_data: { currency: CATALOG.currency, unit_amount: CATALOG.priceFor(p, it.size),
        product_data: { name: p.name, description: `${it.color} · taille ${it.size}` } } });
    } else if (it.type === "bundle") {
      const b = bundleById[it.id];
      if (!b || !Array.isArray(it.picks) || it.picks.length !== b.parts.length) return json(400, { error: "Ensemble invalide" });
      const desc = [];
      for (let i = 0; i < b.parts.length; i++) {
        const p = valid(b.parts[i], it.picks[i]);
        if (!p) return json(400, { error: "Ensemble invalide" });
        add(p.id, it.picks[i]);
        desc.push(`${p.name} ${it.picks[i].color} ${it.picks[i].size}`);
      }
      lineItems.push({ quantity: qty, price_data: { currency: CATALOG.currency, unit_amount: b.price,
        product_data: { name: b.name, description: desc.join(" + ") } } });
    } else return json(400, { error: "Article invalide" });
  }

  try {
    const left = await remainingStock({ fresh: true });
    for (const [k, n] of Object.entries(used)) {
      const [id, color, size] = k.split(".");
      if ((left[id][color][size] || 0) < n)
        return json(409, { error: `Victime de son succès : ${byId[id].name} ${color} en ${size} n'est plus disponible en cette quantité.`, stock: left });
    }

    const pieces = Object.values(used).reduce((a, n) => a + n, 0);
    // Livraison : point relais (vérifié auprès de Sendcloud) ou domicile
    const ship = body.shipping || {};
    let relay = null;
    if (ship.mode === "relais") {
      try { relay = await servicePoint(String(ship.point_id || "")); } catch (e) { return json(400, { error: "Ce point relais n'est plus disponible, choisis-en un autre." }); }
    }
    const home = !relay && CATALOG.shipping.home && ship.mode === "domicile";
    const free = !home && CATALOG.shipping.freeFrom && pieces >= CATALOG.shipping.freeFrom;
    const shipAmount = free ? 0 : home ? CATALOG.shipping.home.amount : CATALOG.shipping.amount;
    const shipLabel = relay ? `Point relais · ${relay.name}`.slice(0, 100) : home ? CATALOG.shipping.home.label : "Livraison suivie";
    const host = event.headers["x-forwarded-host"] || event.headers.host;
    const origin = process.env.URL || `https://${host}`;
    const session = await stripe("checkout/sessions", { method: "POST", body: {
      mode: "payment",
      integration_identifier: "dript-black-friday-fapwmwsx",   // repère ce parcours dans le Dashboard Stripe
      locale: "fr",
      success_url: `${origin}/?commande=merci&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/#panier`,
      expires_at: Math.floor(Date.now() / 1000) + 31 * 60,       // panier réservé 31 min
      shipping_address_collection: { allowed_countries: relay ? { 0: "FR" } : { 0: "FR", 1: "BE", 2: "LU", 3: "CH", 4: "MC" } },
      custom_text: relay ? { shipping_address: { message: `Ton colis sera livré au point relais ${relay.name}, ${relay.street}, ${relay.postal_code} ${relay.city}. Indique ici ton adresse personnelle.`.slice(0, 1200) } } : undefined,
      phone_number_collection: { enabled: "true" },
      shipping_options: { 0: { shipping_rate_data: {
        type: "fixed_amount", display_name: shipLabel + (free ? " (offerte)" : ""),
        fixed_amount: { amount: shipAmount, currency: CATALOG.currency },
        delivery_estimate: { minimum: { unit: "business_day", value: 2 }, maximum: { unit: "business_day", value: 5 } }
      } } },
      line_items: Object.fromEntries(lineItems.map((l, i) => [i, l])),
      metadata: { ...packUsage(used), ...(relay ? { relay_id: relay.id, relay_name: relay.name.slice(0, 120), relay_addr: `${relay.street}, ${relay.postal_code} ${relay.city}`.slice(0, 200) } : {}), ship_mode: relay ? "relais" : home ? "domicile" : "standard", items: lineItems.map(l => `${l.quantity}× ${l.price_data.product_data.name} (${l.price_data.product_data.description})`).join(" | ").slice(0, 490) },
      payment_intent_data: { metadata: packUsage(used) }
    } });
    return json(200, { url: session.url });
  } catch (e) {
    return json(502, { error: "Le paiement est momentanément indisponible, réessaie dans un instant." });
  }
};
