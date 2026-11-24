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
    relay: m.relay_id ? { id: m.relay_id, name: m.relay_name || "", address: m.relay_addr || "" } : null,
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

async function createLabel(order, methods = {}) {
  if (order.parcel_id) return { parcel_id: order.parcel_id, tracking: order.tracking, tracking_url: order.tracking_url };
  const st = splitStreet(order.address.line1);
  const parcel = {
    name: order.name, address: st.address, house_number: st.house_number, address_2: order.address.line2,
    city: order.address.city, postal_code: order.address.postal_code, country: order.address.country,
    telephone: order.phone, email: order.email, order_number: order.number, weight: weightOf(order),
    request_label: true,
    total_order_value: (order.total / 100).toFixed(2), total_order_value_currency: "EUR"
  };
  if (order.relay) parcel.to_service_point = Number(order.relay.id);
  const method = order.relay ? (methods.relay || process.env.SENDCLOUD_RELAY_METHOD_ID) : (methods.home || process.env.SENDCLOUD_SHIPPING_METHOD_ID);
  if (method) parcel.shipment = { id: Number(method) };
  else if (order.relay) throw new Error("Choisis le mode d'envoi « point relais » dans la liste en haut.");
  else parcel.apply_shipping_rules = true;
  const res = await sendcloud("parcels", { method: "POST", body: { parcel } });
  const p = res.parcel;
  const info = { parcel_id: String(p.id), tracking: p.tracking_number || "", tracking_url: p.tracking_url || "", carrier: (p.carrier && p.carrier.code) || "" };
  await setMeta(order.id, { ...info, status: "etiquette" });
  return info;
}

/* Points relais (API Sendcloud Service Points) */
const DAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
function shapePoint(p) {
  const hours = p.formatted_opening_times || {};
  return { id: String(p.id), name: p.name, street: [p.house_number, p.street].filter(Boolean).join(" "), postal_code: p.postal_code, city: p.city,
    carrier: p.carrier, distance: p.distance, lat: p.latitude, lng: p.longitude,
    hours: Object.keys(hours).sort().map(d => `${DAYS[+d]} ${(hours[d] || []).join(", ") || "fermé"}`) };
}
async function servicePoints({ address, country, carrier }) {
  const key = encodeURIComponent(process.env.SENDCLOUD_PUBLIC_KEY || "");
  const r = await sendcloud(`https://servicepoints.sendcloud.sc/api/v2/service-points/?access_token=${key}&country=${country}&address=${encodeURIComponent(address)}&carrier=${carrier}&radius=10000`);
  return (Array.isArray(r) ? r : []).map(shapePoint);
}
async function servicePoint(id) {
  const key = encodeURIComponent(process.env.SENDCLOUD_PUBLIC_KEY || "");
  return shapePoint(await sendcloud(`https://servicepoints.sendcloud.sc/api/v2/service-points/${encodeURIComponent(id)}/?access_token=${key}`));
}

async function labelsPdf(parcelIds) {
  if (parcelIds.length === 1) return sendcloud(`labels/label_printer/${parcelIds[0]}`, { raw: true });
  const res = await sendcloud("labels", { method: "POST", body: { label: { parcels: parcelIds.map(Number) } } });
  return sendcloud(res.label.label_printer, { raw: true });
}

/* ---------- e-mails (Brevo) ---------- */
const F = "font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif;";
function shell(title, body, number) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#efefed;${F}color:#111;-webkit-text-size-adjust:100%">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#efefed"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden">
<tr><td style="background:#111111;padding:22px 28px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
  <td style="${F}font-weight:900;font-size:24px;letter-spacing:-1px;color:#ffffff">DRIPT<span style="color:#e0372c">.</span></td>
  ${number ? `<td align="right" style="${F}font-size:12px;letter-spacing:1px;color:#bbbbbb;text-transform:uppercase">Commande ${esc(number)}</td>` : ""}
  </tr></table></td></tr>
<tr><td style="padding:32px 28px 8px"><h1 style="margin:0;${F}font-size:26px;line-height:1.15;font-weight:800;letter-spacing:-.5px;color:#111">${title}</h1></td></tr>
<tr><td style="padding:12px 28px 28px;${F}font-size:15px;line-height:1.6;color:#444">${body}</td></tr>
<tr><td style="padding:20px 28px 26px;border-top:1px solid #eeeeee;${F}font-size:12.5px;line-height:1.6;color:#888">
  Une question sur ta commande ? Réponds simplement à cet e-mail, on te répond vite.<br>DRIPT · Paiement sécurisé par Stripe</td></tr>
</table></td></tr></table></body></html>`;
}
function recap(o) {
  const row = (l, r, extra = "") => `<tr><td style="padding:12px 0;border-bottom:1px solid #f0f0f0;${F}font-size:14px;color:#111;${extra}">${l}</td><td align="right" valign="top" style="padding:12px 0;border-bottom:1px solid #f0f0f0;${F}font-size:14px;color:#111;white-space:nowrap;${extra}">${r}</td></tr>`;
  const items = o.items.map(i => row(`<b style="font-weight:600">${esc(i.name)}</b>${i.qty > 1 ? ` <span style="color:#888">× ${i.qty}</span>` : ""}${i.detail ? `<br><span style="color:#888;font-size:13px">${esc(i.detail)}</span>` : ""}`, i.total ? eur(i.total) : "")).join("");
  const where = o.relay
    ? `<b style="color:#111">Retrait en point relais</b><br>${esc(o.relay.name)}<br>${esc(o.relay.address)}<br><span style="color:#888;font-size:13px">Tu recevras un SMS ou un e-mail du transporteur quand ton colis sera arrivé. Pense à ta pièce d'identité.</span>`
    : `<b style="color:#111">Livraison à domicile</b><br>${esc(o.name)}<br>${esc(o.address.line1)}${o.address.line2 ? "<br>" + esc(o.address.line2) : ""}<br>${esc(o.address.postal_code)} ${esc(o.address.city)}`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0 8px">${items}
${row('<span style="color:#666">Livraison</span>', `<span style="color:#666">${o.shipping ? eur(o.shipping) : "Offerte"}</span>`)}
${row("<b>Total</b>", `<b>${eur(o.total)}</b>`, "border-bottom:0;font-size:16px")}</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f6f4;border-radius:10px;margin-top:16px"><tr><td style="padding:16px 18px;${F}font-size:14px;line-height:1.6;color:#555">${where}</td></tr></table>`;
}
/* Envoi : compte Google (Apps Script, voir tools/google-mail.gs) en priorité, sinon Brevo. */
const mailReady = () => !!((process.env.GMAIL_SCRIPT_URL && process.env.GMAIL_SCRIPT_SECRET) || (process.env.BREVO_API_KEY && process.env.MAIL_FROM));
async function google(payload) {
  const r = await fetch(process.env.GMAIL_SCRIPT_URL, { method: "POST", redirect: "follow", headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ secret: process.env.GMAIL_SCRIPT_SECRET, ...payload }) });
  const d = await r.json().catch(() => ({ ok: false, error: "réponse Google illisible" }));
  if (!d.ok) { const e = new Error(d.error === "quota" ? "Limite d'envoi Google du jour atteinte (100 par jour avec un Gmail gratuit). Reprends demain." : "Google : " + d.error); e.quota = d.error === "quota"; throw e; }
  return d;
}
async function mailQuota() {
  if (process.env.GMAIL_SCRIPT_URL) return (await google({ action: "quota" })).remaining;
  return null;
}
async function sendMail(to, name, subject, html) {
  const replyTo = process.env.CONTACT_EMAIL || (CATALOG.contact.includes("tondomaine") ? undefined : CATALOG.contact);
  if (process.env.GMAIL_SCRIPT_URL && process.env.GMAIL_SCRIPT_SECRET) return google({ to, subject, html, name: "DRIPT", replyTo });
  const { BREVO_API_KEY: key, MAIL_FROM: from } = process.env;
  if (!key || !from) throw new Error("E-mails pas encore configurés : connecte ton compte Google (voir Réglages e-mail).");
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST", headers: { "api-key": key, "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify({ sender: { name: "DRIPT", email: from }, replyTo: { email: replyTo || from },
      to: [{ email: to, name: name || undefined }], subject, htmlContent: html })
  });
  if (!r.ok) throw new Error("Brevo : " + (await r.text()).slice(0, 200));
}

/* ---------- e-mail à toute la liste « M'avertir » ---------- */
const TYPO = /@(gmail\.con|glail\.com|gmial\.com|gamil\.com|hotmaio\.com|hotmil\.com|gmail\.co|hotmail\.co)$/i;
async function subscribers() {
  const out = []; let page = null;
  for (let i = 0; i < 30; i++) {
    const r = await stripe(`customers/search?limit=100&query=${encodeURIComponent("metadata['source']:'liste-black-friday'")}` + (page ? `&page=${encodeURIComponent(page)}` : ""));
    out.push(...r.data);
    if (!r.has_more) break; page = r.next_page;
  }
  return out.filter(c => c.email && !/@example\.(com|org)$/.test(c.email));
}
function campaignHtml(subject, message, cta) {
  const site = process.env.SITE_URL || "https://enfiniti.pages.dev";
  const body = esc(message).split(/\n{2,}/).map(p => `<p style="margin:0 0 14px">${p.replace(/\n/g, "<br>")}</p>`).join("");
  const btn = cta ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 4px"><tr><td style="background:#111;border-radius:999px"><a href="${site}" style="display:inline-block;padding:15px 28px;${F}font-size:14px;font-weight:600;color:#ffffff;text-decoration:none">${esc(cta)}</a></td></tr></table>` : "";
  return shell(esc(subject), body + btn);
}
async function broadcast({ subject, message, cta, campaign, test, testTo, max = 20 }) {
  if (!subject || !message) throw new Error("Ajoute un objet et un message.");
  const html = campaignHtml(subject, message, cta);
  if (test) { await sendMail(testTo, "", "[TEST] " + subject, html); return { sent: 1, test: true }; }
  const key = "camp_" + String(campaign).replace(/[^a-z0-9]/gi, "").slice(0, 30);
  const all = await subscribers();
  const todo = all.filter(c => !TYPO.test(c.email) && !(c.metadata && c.metadata[key]));
  let sent = 0, stop = null;
  for (const c of todo.slice(0, max)) {
    try { await sendMail(c.email, c.name, subject, html); await stripe(`customers/${c.id}`, { method: "POST", body: { metadata: { [key]: "1" } } }); sent++; }
    catch (e) { stop = e.message; if (e.quota) break; }
  }
  return { sent, remaining: todo.length - sent, total: all.length, skipped_typos: all.filter(c => TYPO.test(c.email)).length, stop };
}
async function sendConfirmation(o) {
  const first = (o.name || "").split(" ")[0];
  await sendMail(o.email, o.name, `Commande ${o.number} confirmée`, shell(`Merci${first ? " " + esc(first) : ""}, ta commande est confirmée.`,
    `<p style="margin:0">On a bien reçu ta commande. On la prépare et elle part sous <b style="color:#111">48 h ouvrées</b>. Tu recevras un deuxième e-mail avec le lien de suivi dès qu'elle est expédiée.</p>${recap(o)}`, o.number));
  await setMeta(o.id, { mail_confirm: "1" });
}
async function sendShipped(o) {
  const link = o.tracking_url ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 4px"><tr><td style="background:#111;border-radius:999px"><a href="${esc(o.tracking_url)}" style="display:inline-block;padding:15px 28px;${F}font-size:14px;font-weight:600;color:#ffffff;text-decoration:none">Suivre mon colis</a></td></tr></table>` : "";
  await sendMail(o.email, o.name, `Ta commande ${o.number} est en route`, shell("Ton colis est en route.",
    `<p style="margin:0">Bonne nouvelle : ta commande vient de partir${o.tracking ? ` (suivi <b style="color:#111">${esc(o.tracking)}</b>)` : ""}. Compte 2 à 5 jours ouvrés.</p>${link}${recap(o)}`, o.number));
  await setMeta(o.id, { mail_ship: "1", status: "expediee" });
}

module.exports = { mailReady, mailQuota, subscribers, broadcast, servicePoints, servicePoint, isAdmin, listOrders, getOrder, setMeta, createLabel, labelsPdf, sendcloud, sendConfirmation, sendShipped, toOrder };
