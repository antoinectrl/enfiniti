/* /api/mcp/<MCP_TOKEN> — connecteur Claude (protocole MCP, HTTP).
   Dans Claude : Paramètres > Connecteurs > Ajouter un connecteur personnalisé > colle l'adresse complète.
   Lecture seule : statistiques, commandes, stock. Le jeton secret dans l'adresse protège l'accès. */
const crypto = require("crypto");
const { json, remainingStock } = require("../../lib/shop.js");
const O = require("../../lib/orders.js");
const admin = require("./admin.js");

const TOOLS = [
  { name: "statistiques_boutique", description: "Statistiques de la boutique DRIPT : visiteurs en ce moment, paniers actifs, clients en train de payer, entonnoir du jour, visiteurs sur 7 jours et provenance, chiffre d'affaires et nombre de commandes.",
    inputSchema: { type: "object", properties: {} } },
  { name: "lister_commandes", description: "Liste les commandes payées (les plus récentes d'abord) avec client, articles, total, mode de livraison et statut d'expédition.",
    inputSchema: { type: "object", properties: {
      statut: { type: "string", enum: ["a_preparer", "etiquette", "expediee", "annulee", "toutes"], description: "Filtre par statut (par défaut : toutes)" },
      limite: { type: "integer", minimum: 1, maximum: 200, description: "Nombre maximum de commandes (par défaut 50)" } } } },
  { name: "detail_commande", description: "Détail complet d'une commande à partir de son numéro (ex. D3A9F2C) : adresse, point relais, articles, suivi, e-mails envoyés.",
    inputSchema: { type: "object", properties: { numero: { type: "string" } }, required: ["numero"] } },
  { name: "stock_restant", description: "Stock restant par produit, couleur et taille, en direct (ventes déduites).",
    inputSchema: { type: "object", properties: {} } }
];

const okToken = (got) => {
  const want = process.env.MCP_TOKEN || "";
  if (want.length < 20 || !got) return false;
  const a = crypto.createHash("sha256").update(got).digest(), b = crypto.createHash("sha256").update(want).digest();
  return crypto.timingSafeEqual(a, b);
};
const slim = o => ({ numero: o.number, date: new Date(o.created * 1000).toISOString(), client: o.name, email: o.email, statut: o.status,
  total_eur: o.total / 100, livraison: o.relay ? `Point relais : ${o.relay.name}, ${o.relay.address}` : `Domicile : ${o.address.postal_code} ${o.address.city}`,
  articles: o.items.map(i => `${i.qty}× ${i.name}${i.detail ? " (" + i.detail + ")" : ""}`), suivi: o.tracking || null, confirmation_envoyee: o.mail_confirm });

async function callTool(name, args, event) {
  if (name === "statistiques_boutique") {
    const r = await admin.handler({ ...event, headers: { authorization: "Bearer " + process.env.ADMIN_PASSWORD }, body: JSON.stringify({ action: "stats" }), queryStringParameters: {} });
    const stats = JSON.parse(r.body);
    const orders = (await O.listOrders()).filter(o => o.paid && !o.released);
    return { ...stats, commandes_total: orders.length, chiffre_affaires_eur: orders.reduce((a, o) => a + o.total, 0) / 100,
      pieces_vendues: orders.reduce((a, o) => a + o.pieces, 0), a_preparer: orders.filter(o => o.status === "a_preparer").length };
  }
  if (name === "lister_commandes") {
    let list = (await O.listOrders()).sort((a, b) => b.created - a.created);
    if (args.statut && args.statut !== "toutes") list = list.filter(o => o.status === args.statut);
    return list.slice(0, Math.min(200, args.limite || 50)).map(slim);
  }
  if (name === "detail_commande") {
    const o = (await O.listOrders()).find(x => x.number.toUpperCase() === String(args.numero || "").toUpperCase().trim());
    if (!o) return { erreur: "Commande introuvable" };
    return { ...slim(o), telephone: o.phone, adresse: o.address, point_relais: o.relay, lien_suivi: o.tracking_url || null, email_expedition_envoye: o.mail_ship };
  }
  if (name === "stock_restant") return await remainingStock({ fresh: true });
  throw new Error("Outil inconnu");
}

exports.handler = async (event) => {
  const token = (event.path || "").split("/").filter(Boolean)[2];
  if (!okToken(token)) return json(401, { error: "Accès refusé" });
  if (event.httpMethod !== "POST") return json(405, { error: "Utilise POST" }, { Allow: "POST" });
  let msg; try { msg = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON invalide" } }); }
  const reply = (result) => json(200, { jsonrpc: "2.0", id: msg.id, result });
  const fail = (code, message) => json(200, { jsonrpc: "2.0", id: msg.id ?? null, error: { code, message } });
  if (msg.id === undefined || msg.id === null) return { statusCode: 202, headers: {}, body: "" };   // notification
  switch (msg.method) {
    case "initialize":
      return reply({ protocolVersion: (msg.params && msg.params.protocolVersion) || "2025-06-18", capabilities: { tools: {} },
        serverInfo: { name: "dript-boutique", version: "1.0.0" },
        instructions: "Boutique DRIPT (Black Friday). Montants en euros. Les commandes viennent de Stripe, le stock est calculé en direct." });
    case "ping": return reply({});
    case "tools/list": return reply({ tools: TOOLS });
    case "tools/call":
      try {
        const data = await callTool(msg.params.name, msg.params.arguments || {}, event);
        return reply({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });
      } catch (e) { return reply({ content: [{ type: "text", text: "Erreur : " + e.message }], isError: true }); }
    default: return fail(-32601, "Méthode inconnue");
  }
};
