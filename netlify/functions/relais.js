/* GET /api/relais?q=75011 — points relais proches (Sendcloud). GET /api/relais?probe=1 — le service est-il actif ? */
const { CATALOG, json } = require("../../lib/shop.js");
const { servicePoints } = require("../../lib/orders.js");

exports.handler = async (event) => {
  const q = (event.queryStringParameters || {});
  if (!process.env.SENDCLOUD_PUBLIC_KEY || !process.env.SENDCLOUD_SECRET_KEY) return json(503, { error: "Point relais indisponible" });
  if (q.probe) return json(200, { ok: true });
  const query = String(q.q || "").trim().slice(0, 60);
  if (query.length < 2) return json(400, { error: "Entre un code postal ou une ville" });
  try {
    const points = await servicePoints({ address: query, country: "FR", carrier: CATALOG.shipping.relayCarrier });
    return json(200, { points: points.slice(0, 12) }, { "Cache-Control": "public, max-age=300" });
  } catch (e) {
    return json(502, { error: "Recherche impossible pour le moment, réessaie." });
  }
};
