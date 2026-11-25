/* GET /api/desinscription?c=<client>&t=<jeton> — lien « Se désinscrire » des e-mails à la liste. */
const { unsubscribe } = require("../../lib/orders.js");
const page = (msg) => ({ statusCode: 200, headers: { "Content-Type": "text/html; charset=utf-8" },
  body: `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DRIPT</title></head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#111;color:#fff;font-family:-apple-system,Helvetica,Arial,sans-serif;text-align:center;padding:24px">
<div><div style="font-weight:900;font-size:32px;letter-spacing:-1px">DRIPT<span style="color:#e0372c">.</span></div><p style="font-size:17px;margin-top:18px">${msg}</p>
<a href="/" style="color:#bbb;font-size:14px">Retour à la boutique</a></div></body></html>` });
exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  try { await unsubscribe(q.c, q.t); return page("C'est fait, tu ne recevras plus nos e-mails."); }
  catch (e) { return page("Ce lien n'est plus valide. Réponds simplement à notre e-mail pour te désinscrire."); }
};
