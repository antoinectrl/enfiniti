/* GET /api/config — infos publiques réglées dans l'admin (Instagram, contact, mentions légales). */
const { json, IS_LIVE } = require("../../lib/shop.js");
exports.handler = async () => {
  const e = process.env;
  return json(200, {
    instagram: e.INSTAGRAM_URL || "", contact: e.CONTACT_EMAIL || e.MAIL_FROM || "",
    legal: { name: e.LEGAL_NAME || "", siret: e.LEGAL_SIRET || "", address: e.LEGAL_ADDRESS || "", mediator: e.LEGAL_MEDIATOR || "" },
    live: IS_LIVE()
  }, { "Cache-Control": "public, max-age=60" });
};
