/* GET /api/stock — stock restant en direct, lu par le site toutes les 30 s. */
const { remainingStock, json, KEY } = require("../../lib/shop.js");

exports.handler = async () => {
  if (!KEY()) return json(503, { error: "Stripe pas encore configuré" });
  try {
    return json(200, { stock: await remainingStock() }, { "Cache-Control": "public, max-age=10" });
  } catch (e) {
    return json(502, { error: "Stock indisponible" });
  }
};
