/* Packlink PRO : crée les envois en brouillon (à payer ensuite dans le panier Packlink).
   Réglages : PACKLINK_API_KEY, et l'adresse d'expédition SHIP_FROM_* (nom, rue, code postal, ville, téléphone). */
const API = "https://api.packlink.com/v1/";
const PKG = { width: 25, height: 5, length: 30, weight: 0.25 };   // sachet d'envoi, 250 g

async function pl(path, { method = "GET", body } = {}) {
  const key = process.env.PACKLINK_API_KEY;
  if (!key) throw new Error("Clé Packlink manquante (Réglages).");
  const r = await fetch(API + path, { method, headers: { Authorization: key, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let d; try { d = JSON.parse(text); } catch (e) { d = text; }
  if (!r.ok) throw new Error(`Packlink ${r.status} : ${(typeof d === "string" ? d : JSON.stringify(d)).slice(0, 300)}`);
  return d;
}

function sender() {
  const e = process.env;
  const s = { name: e.SHIP_FROM_NAME, street1: e.SHIP_FROM_STREET, zip_code: e.SHIP_FROM_ZIP, city: e.SHIP_FROM_CITY, country: "FR",
    phone: e.SHIP_FROM_PHONE || "0788088387", email: e.MAIL_FROM || e.CONTACT_EMAIL || "" };
  if (!s.name || !s.street1 || !s.zip_code || !s.city) throw new Error("Adresse d'expédition incomplète (Réglages > Packlink).");
  const [first, ...rest] = s.name.trim().split(/\s+/);
  return { ...s, name: first, surname: rest.join(" ") || first };
}

function qs(from, to) {
  const p = new URLSearchParams({ "from[country]": from.country, "from[zip]": from.zip_code, "to[country]": to.country, "to[zip]": to.zip_code });
  for (const [k, v] of Object.entries(PKG)) p.set(`packages[0][${k}]`, String(v));
  return p.toString();
}

/* Services disponibles : on garde la livraison à l'adresse du client, le moins cher. */
async function cheapestService(from, to) {
  const list = await pl("services?" + qs(from, to));
  const arr = (Array.isArray(list) ? list : []).filter(s => !s.delivery_to_parcelshop);
  arr.sort((a, b) => (a.total_price ?? a.base_price ?? 1e9) - (b.total_price ?? b.base_price ?? 1e9));
  return arr[0];
}

async function test() {
  const from = sender();
  const s = await cheapestService(from, { country: "FR", zip_code: "75011" });
  return { ok: true, exemple: s ? `${s.carrier_name} ${s.name || s.service_name || ""} · ${s.total_price ?? s.base_price} €` : "aucun service trouvé" };
}

async function draft(order) {
  const from = sender();
  const a = order.address;
  const [first, ...rest] = (order.name || "Client").trim().split(/\s+/);
  const to = { name: first, surname: rest.join(" ") || first, street1: [a.line1, a.line2].filter(Boolean).join(", "), zip_code: a.postal_code,
    city: a.city, country: a.country || "FR", phone: order.phone || "0788088387", email: order.email };
  const svc = await cheapestService(from, to);
  if (!svc) throw new Error(`aucun transporteur trouvé vers ${to.zip_code} ${to.country}`);
  const value = Math.max(1, Math.round((order.total - order.shipping) / 100));
  const res = await pl("shipments", { method: "POST", body: {
    from, to, packages: [PKG], service_id: svc.id, content: "Vêtement", contentvalue: value,
    shipment_custom_reference: order.number, source: "PRO" } });
  return { reference: res.reference || res.shipment_reference || JSON.stringify(res).slice(0, 80),
    service: `${svc.carrier_name} ${svc.name || svc.service_name || ""}`.trim(), price: svc.total_price ?? svc.base_price };
}

module.exports = { test, draft };
