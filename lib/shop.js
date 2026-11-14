/* Logique commune aux fonctions serveur (Netlify).
   Le stock est 100 % automatique : stock de départ (catalog.js)
   − pièces vendues (paiements Stripe terminés)
   − pièces réservées (paniers en cours de paiement, bloqués 30 min). */
const CATALOG = require("../catalog.js");

const SIZES = ["XS", "S", "M", "L", "XL"];
const byId = Object.fromEntries(CATALOG.products.map(p => [p.id, p]));
const bundleById = Object.fromEntries(CATALOG.bundles.map(b => [b.id, b]));
const KEY = () => process.env.STRIPE_SECRET_KEY || process.env.stripe;   // « stripe » = nom utilisé dans Netlify
const API_VERSION = "2026-10-28.endive";   // version d'API fixée : le comportement ne change pas sans toi

function encode(obj, prefix, out = []) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v === undefined || v === null) continue;
    if (typeof v === "object") encode(v, key, out);
    else out.push(encodeURIComponent(key) + "=" + encodeURIComponent(v));
  }
  return out.join("&");
}

async function stripe(path, { method = "GET", body } = {}) {
  const r = await fetch("https://api.stripe.com/v1/" + path, {
    method,
    headers: { Authorization: `Bearer ${KEY()}`, "Content-Type": "application/x-www-form-urlencoded", "Stripe-Version": API_VERSION },
    body: body ? encode(body) : undefined
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error?.message || "Erreur Stripe");
  return data;
}

/* "hoodie.noir.M*2;zip.gris.S*1" <-> { "hoodie.noir.M": 2, ... } */
function packUsage(used) {
  const s = Object.entries(used).map(([k, n]) => `${k}*${n}`).join(";");
  const meta = {};
  for (let i = 0; i * 480 < s.length; i++) meta["stock" + i] = s.slice(i * 480, (i + 1) * 480);
  return meta;
}
function readUsage(metadata = {}) {
  const s = Object.keys(metadata).filter(k => /^stock\d+$/.test(k)).sort().map(k => metadata[k]).join("");
  const out = {};
  for (const part of s.split(";")) {
    const m = part.match(/^([a-z0-9-]+\.[a-z]+\.[A-Z]+)\*(\d+)$/);
    if (m) out[m[1]] = (out[m[1]] || 0) + +m[2];
  }
  return out;
}

let cache = { at: 0, data: null };
async function remainingStock({ fresh = false } = {}) {
  if (!fresh && cache.data && Date.now() - cache.at < 15000) return cache.data;
  const taken = {};
  const since = Math.floor(new Date(CATALOG.dropDate).getTime() / 1000) - 30 * 86400;
  const now = Math.floor(Date.now() / 1000);
  let after = null;
  for (let page = 0; page < 30; page++) {
    const q = `checkout/sessions?limit=100&created[gte]=${since}` + (after ? `&starting_after=${after}` : "");
    const res = await stripe(q);
    for (const s of res.data) {
      if (s.metadata && s.metadata.released === "1") continue;          // paiement échoué ou remboursé : pièces remises en vente
      const counts = s.status === "complete" || (s.status === "open" && s.expires_at > now);
      if (!counts) continue;
      for (const [k, n] of Object.entries(readUsage(s.metadata))) taken[k] = (taken[k] || 0) + n;
    }
    if (!res.has_more || !res.data.length) break;
    after = res.data[res.data.length - 1].id;
  }
  const stock = {};
  for (const p of CATALOG.products) {
    stock[p.id] = {};
    for (const [color, sizes] of Object.entries(p.stock)) {
      stock[p.id][color] = {};
      for (const sz of SIZES) stock[p.id][color][sz] = Math.max(0, (sizes[sz] || 0) - (taken[`${p.id}.${color}.${sz}`] || 0));
    }
  }
  cache = { at: Date.now(), data: stock };
  return stock;
}

function json(statusCode, data, extra = {}) {
  return { statusCode, headers: { "Content-Type": "application/json", ...extra }, body: JSON.stringify(data) };
}

module.exports = { CATALOG, SIZES, byId, bundleById, stripe, packUsage, readUsage, remainingStock, json, KEY };
