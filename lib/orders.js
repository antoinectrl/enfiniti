/* Commandes (lues dans Stripe), étiquettes Sendcloud et e-mails Brevo.
   Variables Netlify :
   - ADMIN_PASSWORD                         mot de passe de l'interface /admin
   - SENDCLOUD_PUBLIC_KEY, SENDCLOUD_SECRET_KEY   Sendcloud > Paramètres > Intégrations > API
   - BREVO_API_KEY, MAIL_FROM               Brevo > SMTP & API, et l'adresse d'expédition validée dans Brevo */
const crypto = require("crypto");
const { CATALOG, stripe, readUsage } = require("./shop.js");

const byId = Object.fromEntries(CATALOG.products.map(p => [p.id, p]));
const eur = c => (c / 100).toLocaleString("fr-FR", { minimumFractionDigits: c % 100 ? 2 : 0 }) + " €";
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------- auth admin ---------- */
function isAdmin(event) {
  const pass = process.env.ADMIN_PASSWORD || "";
  const got = (event.headers.authorization || event.headers.Authorization || "").replace(/^Bearer\s+/i, "");
  if (pass.length < 8 || !got) return false;
  const a = crypto.createHash("sha256").update(got).digest(), b = crypto.createHash("sha256").update(pass).digest();
  return crypto.timingSafeEqual(a, b);
}

/* ---------- commandes ---------- */
function toOrder(s) {
  const ship = (s.collected_information && s.collected_information.shipping_details) || s.shipping_details || {};
  const a = ship.address || {};
  const cd = s.customer_details || {};
  const m = s.metadata || {};
  const items = ((s.line_items && s.line_items.data) || []).map(li => ({
    name: li.description || (li.price && li.price.product && li.price.product.name) || "Article",
    detail: (li.price && li.price.product && li.price.product.description) || "",
    qty: li.quantity, total: li.amount_total
  }));
  if (m.items) {   // résumé écrit au moment du paiement : contient tailles et couleurs
    const parts = m.items.split(" | ").map(t => { const x = t.match(/^(\d+)× (.+?) \((.*)\)$/); return x ? { qty: +x[1], name: x[2], detail: x[3] } : { qty: 1, name: t, detail: "" }; });
    if (!items.length) items.push(...parts.map(p => ({ ...p, total: 0 })));
    else items.forEach((it, i) => { if (parts[i]) it.detail = it.detail || parts[i].detail; });
  }
  const pieces = Object.values(readUsage(m)).reduce((x, n) => x + n, 0);
  return {
    id: s.id, number: "D" + s.id.slice(-6).toUpperCase(), created: s.created,
    paid: s.payment_status === "paid" || s.payment_status === "no_payment_required",
    released: m.released === "1",
    status: m.released === "1" ? "annulee" : (m.status || "a_preparer"),
    total: s.amount_total, shipping: (s.shipping_cost && s.shipping_cost.amount_total) || 0,
    email: cd.email || "", phone: cd.phone || "", name: ship.name || cd.name || "",
    address: { line1: a.line1 || "", line2: a.line2 || "", postal_code: a.postal_code || "", city: a.city || "", country: a.country || "FR" },
    items, pieces, usage: readUsage(m),
    parcel_id: m.parcel_id || "", tracking: m.tracking || "", tracking_url: m.tracking_url || "", carrier: m.carrier || "",
    mail_confirm: m.mail_confirm === "1", mail_ship: m.mail_ship === "1"
  };
}

async function getOrder(id) {
  const s = await stripe(`checkout/sessions/${encodeURIComponent(id)}?expand[]=line_items&expand[]=line_items.data.price.product`);
  return toOrder(s);
}

async function listOrders() {
  const since = Math.floor(new Date(CATALOG.dropDate).getTime() / 1000) - 30 * 86400;
  const out = []; let after = null;
  for (let page = 0; page < 20; page++) {
    const q = `checkout/sessions?limit=100&status=complete&created[gte]=${since}&expand[]=data.line_items` + (after ? `&starting_after=${after}` : "");
    const res = await stripe(q);
    for (const s of res.data) out.push(toOrder(s));
    if (!res.has_more || !res.data.length) break;
    after = res.data[res.data.length - 1].id;
  }
  return out;
}

async function setMeta(id, meta) {
  await stripe(`checkout/sessions/${encodeURIComponent(id)}`, { method: "POST", body: { metadata: meta } });
}

/* ---------- Sendcloud ---------- */
const SC = "https://panel.sendcloud.sc/api/v2/";
function scAuth() {
  const { SENDCLOUD_PUBLIC_KEY: pub, SENDCLOUD_SECRET_KEY: sec } = process.env;
  if (!pub || !sec) throw new Error("Sendcloud n'est pas encore connecté (clés manquantes dans Netlify).");
  return "Basic " + Buffer.from(`${pub}:${sec}`).toString("base64");
}
async function sendcloud(path, { method = "GET", body, raw = false } = {}) {
  const r = await fetch(path.startsWith("http") ? path : SC + path, {
    method, headers: { Authorization: scAuth(), "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined
  });
  if (raw) { if (!r.ok) throw new Error("Sendcloud : étiquette introuvable"); return Buffer.from(await r.arrayBuffer()); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("Sendcloud : " + (data.error?.message || JSON.stringify(data.error || data).slice(0, 200)));
  return data;
}

function weightOf(order) {
  let kg = 0;
  for (const [k, n] of Object.entries(order.usage)) kg += ((byId[k.split(".")[0]] || {}).weight || 0.8) * n;
  return Math.max(0.1, kg + 0.05).toFixed(3);   // + emballage
}

function splitStreet(line) {
  const m = String(line).trim().match(/^(\d+\s*(?:bis|ter|[a-z])?)[,\s]+(.+)$/i);
  return m ? { house_number: m[1].replace(/\s+/g, ""), address: m[2] } : { house_number: "", address: line };
}

async function createLabel(order, shippingMethodId) {
  if (order.parcel_id) return { parcel_id: order.parcel_id, tracking: order.tracking, tracking_url: order.tracking_url };
  const st = splitStreet(order.address.line1);
  const parcel = {
    name: order.name, address: st.address, house_number: st.house_number, address_2: order.address.line2,
    city: order.address.city, postal_code: order.address.postal_code, country: order.address.country,
    telephone: order.phone, email: order.email, order_number: order.number, weight: weightOf(order),
    request_label: true,
    total_order_value: (order.total / 100).toFixed(2), total_order_value_currency: "EUR"
  };
  const method = shippingMethodId || process.env.SENDCLOUD_SHIPPING_METHOD_ID;
  if (method) parcel.shipment = { id: Number(method) }; else parcel.apply_shipping_rules = true;
  const res = await sendcloud("parcels", { method: "POST", body: { parcel } });
  const p = res.parcel;
  const info = { parcel_id: String(p.id), tracking: p.tracking_number || "", tracking_url: p.tracking_url || "", carrier: (p.carrier && p.carrier.code) || "" };
  await setMeta(order.id, { ...info, status: "etiquette" });
  return info;
}

async function labelsPdf(parcelIds) {
  if (parcelIds.length === 1) return sendcloud(`labels/label_printer/${parcelIds[0]}`, { raw: true });
  const res = await sendcloud("labels", { method: "POST", body: { label: { parcels: parcelIds.map(Number) } } });
  return sendcloud(res.label.label_printer, { raw: true });
}

/* ---------- e-mails (Brevo) ---------- */
function shell(title, body) {
  return `<!doctype html><html lang="fr"><body style="margin:0;background:#f2f2f0;font-family:Helvetica,Arial,sans-serif;color:#111">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff">
<tr><td style="padding:28px 32px 8px;font-weight:900;font-size:26px;letter-spacing:-1px">DRIPT<span style="color:#d4271d">.</span></td></tr>
<tr><td style="padding:8px 32px 0"><h1 style="margin:0 0 12px;font-size:22px">${title}</h1></td></tr>
<tr><td style="padding:0 32px 32px;font-size:15px;line-height:1.55;color:#333">${body}</td></tr>
<tr><td style="padding:20px 32px;border-top:1px solid #eee;font-size:12px;color:#888">Une question ? Réponds simplement à cet e-mail.</td></tr>
</table></td></tr></table></body></html>`;
}
function recap(o) {
  const rows = o.items.map(i => `<tr><td style="padding:10px 0;border-bottom:1px solid #eee">${esc(i.name)}${i.detail ? `<br><span style="color:#888;font-size:13px">${esc(i.detail)}</span>` : ""}${i.qty > 1 ? ` × ${i.qty}` : ""}</td><td align="right" style="padding:10px 0;border-bottom:1px solid #eee;white-space:nowrap">${eur(i.total)}</td></tr>`).join("");
  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;font-size:14px">${rows}
<tr><td style="padding:10px 0;color:#666">Livraison</td><td align="right" style="color:#666">${o.shipping ? eur(o.shipping) : "Offerte"}</td></tr>
<tr><td style="padding:6px 0;font-weight:bold">Total</td><td align="right" style="font-weight:bold">${eur(o.total)}</td></tr></table>
<p style="margin:0;color:#666;font-size:14px"><b style="color:#111">Livraison à</b><br>${esc(o.name)}<br>${esc(o.address.line1)}${o.address.line2 ? "<br>" + esc(o.address.line2) : ""}<br>${esc(o.address.postal_code)} ${esc(o.address.city)}</p>`;
}
async function sendMail(to, name, subject, html) {
  const { BREVO_API_KEY: key, MAIL_FROM: from } = process.env;
  if (!key || !from) throw new Error("E-mails pas encore configurés (BREVO_API_KEY / MAIL_FROM manquants).");
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST", headers: { "api-key": key, "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify({ sender: { name: "DRIPT", email: from }, replyTo: { email: CATALOG.contact.includes("tondomaine") ? from : CATALOG.contact },
      to: [{ email: to, name: name || undefined }], subject, htmlContent: html })
  });
  if (!r.ok) throw new Error("Brevo : " + (await r.text()).slice(0, 200));
}
async function sendConfirmation(o) {
  const first = (o.name || "").split(" ")[0];
  await sendMail(o.email, o.name, `Commande ${o.number} confirmée`, shell(`Merci ${esc(first)}, ta commande est confirmée.`,
    `<p style="margin:0">On a bien reçu ta commande <b>${o.number}</b>. Elle part sous 48 h ouvrées, et tu recevras un e-mail avec le suivi dès qu'elle est expédiée.</p>${recap(o)}`));
  await setMeta(o.id, { mail_confirm: "1" });
}
async function sendShipped(o) {
  const link = o.tracking_url ? `<p style="margin:24px 0"><a href="${esc(o.tracking_url)}" style="background:#111;color:#fff;text-decoration:none;padding:14px 22px;display:inline-block;font-size:13px;letter-spacing:1px;text-transform:uppercase">Suivre mon colis</a></p>` : "";
  await sendMail(o.email, o.name, `Ta commande ${o.number} est en route`, shell("Ton colis est en route.",
    `<p style="margin:0">Ta commande <b>${o.number}</b> vient d'être expédiée${o.tracking ? `, numéro de suivi <b>${esc(o.tracking)}</b>` : ""}. Compte 2 à 5 jours ouvrés.</p>${link}${recap(o)}`));
  await setMeta(o.id, { mail_ship: "1", status: "expediee" });
}

module.exports = { isAdmin, listOrders, getOrder, setMeta, createLabel, labelsPdf, sendcloud, sendConfirmation, sendShipped, toOrder };
