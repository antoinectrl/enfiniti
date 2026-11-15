/* POST /api/track — statistiques de visite (sans cookie, sans données personnelles).
   Types : view (page vue), ping (toujours sur le site), cart (ajout au panier), checkout (passage au paiement). */
const { json } = require("../../lib/shop.js");
const BOTS = /bot|crawl|spider|slurp|preview|facebookexternalhit|headless|lighthouse|monitor/i;

exports.handler = async (event) => {
  const db = event.env && event.env.DB;
  if (event.httpMethod !== "POST" || !db) return json(204, {});
  if (BOTS.test(event.headers["user-agent"] || "")) return json(204, {});
  let b = {};
  try { b = JSON.parse(event.body || "{}"); } catch (e) { return json(204, {}); }
  const type = ["view", "ping", "cart", "checkout"].includes(b.t) ? b.t : null;
  const sid = /^[a-z0-9]{8,32}$/.test(b.sid || "") ? b.sid : null;
  if (!type || !sid) return json(204, {});
  let ref = "";
  try { const h = new URL(b.r || "").hostname.replace(/^www\./, ""); ref = h && !/enfiniti|pages\.dev|netlify/.test(h) ? h : ""; } catch (e) {}
  await db.prepare("INSERT INTO events (ts, type, sid, path, ref, n) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(Date.now(), type, sid, String(b.p || "/").slice(0, 60), ref.slice(0, 60), Math.max(0, Math.min(99, parseInt(b.n, 10) || 0))).run();
  return json(204, {});
};
