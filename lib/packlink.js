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

/* Choix du service : le moins cher en point relais (locker en priorité à prix égal), sinon à domicile. */
const isLocker = (x) => /locker|consigne|casier|inpost|pickup station|automate/i.test(JSON.stringify(x || {}));
const price = (s) => s.total_price ?? s.base_price ?? 1e9;
async function services(from, to) {
  const list = await pl("services?" + qs(from, to));
  return (Array.isArray(list) ? list : []).sort((a, b) => price(a) - price(b) || (isLocker(b) - isLocker(a)));
}
/* Points relais / lockers proches du code postal du client (la liste Packlink est triée par proximité). */
async function nearestPoint(service, to) {
  const pts = await pl(`dropoffs/${service.id}/${to.country}/${encodeURIComponent(to.zip_code)}`).catch(() => []);
  const arr = Array.isArray(pts) ? pts : [];
  const lockers = arr.slice(0, 5).filter(isLocker);        // un locker parmi les 5 plus proches, sinon le plus proche
  return lockers[0] || arr[0] || null;
}
async function choose(from, to) {
  const all = await services(from, to);
  for (const s of all.filter(s => s.delivery_to_parcelshop).slice(0, 4)) {
    const pt = await nearestPoint(s, to);
    if (pt) return { svc: s, point: pt };
  }
  const home = all.find(s => !s.delivery_to_parcelshop);
  return home ? { svc: home, point: null } : null;
}

async function test() {
  const from = sender();
  const c = await choose(from, { country: "FR", zip_code: "75011" });
  return { ok: true, exemple: c ? `${c.svc.carrier_name} ${c.svc.name || c.svc.service_name || ""} · ${price(c.svc)} €${c.point ? " (point relais)" : ""}` : "aucun service trouvé" };
}

async function draft(order) {
  const from = sender();
  const a = order.address;
  const [first, ...rest] = (order.name || "Client").trim().split(/\s+/);
  const to = { name: first, surname: rest.join(" ") || first, street1: [a.line1, a.line2].filter(Boolean).join(", "), zip_code: a.postal_code,
    city: a.city, country: a.country || "FR", phone: order.phone || "0788088387", email: order.email };
  const c = await choose(from, to);
  if (!c) throw new Error(`aucun transporteur trouvé vers ${to.zip_code} ${to.country}`);
  const svc = c.svc, point = c.point;
  const value = Math.max(1, Math.round((order.total - order.shipping) / 100));
  const res = await pl("shipments", { method: "POST", body: {
    from, to, packages: [PKG], service_id: svc.id, content: "Vêtement", contentvalue: value,
    shipment_custom_reference: order.number, source: "PRO",
    ...(point ? { dropoff_point_id: String(point.id) } : {}) } });
  return { reference: res.reference || res.shipment_reference || JSON.stringify(res).slice(0, 80),
    service: `${svc.carrier_name} ${svc.name || svc.service_name || ""}`.trim(), price: price(svc),
    point: point ? `${point.commerce_name || point.name || ""}, ${point.address || ""} ${point.zip || ""} ${point.city || ""}`.trim() : "à domicile" };
}

module.exports = { test, draft };
