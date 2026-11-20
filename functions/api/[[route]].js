/* Cloudflare Pages : toutes les adresses /api/* passent ici et sont confiées
   aux mêmes fonctions que sur Netlify (netlify/functions/*.js), sans les réécrire. */
import checkout from "../../netlify/functions/checkout.js";
import stock from "../../netlify/functions/stock.js";
import subscribe from "../../netlify/functions/subscribe.js";
import webhook from "../../netlify/functions/webhook.js";
import admin from "../../netlify/functions/admin.js";
import order from "../../netlify/functions/order.js";
import track from "../../netlify/functions/track.js";
import relais from "../../netlify/functions/relais.js";
import mcp from "../../netlify/functions/mcp.js";
import config from "../../netlify/functions/config.js";

const HANDLERS = { checkout, stock, subscribe, webhook, admin, order, track, relais, mcp, config };

export async function onRequest(ctx) {
  const { request, env, params } = ctx;
  // Les variables Cloudflare (clés Stripe, Sendcloud, Brevo…) deviennent process.env pour le code existant.
  for (const [k, v] of Object.entries(env)) if (typeof v === "string") process.env[k] = v;

  // Clés collées dans l'admin (page Réglages) : utilisées si elles ne sont pas déjà dans Cloudflare.
  if (env.DB) {
    try {
      const rows = (await env.DB.prepare("SELECT k, v FROM settings").all()).results || [];
      for (const r of rows) if (!(typeof env[r.k] === "string" && env[r.k])) process.env[r.k] = r.v;
    } catch (e) {}
  }

  const name = Array.isArray(params.route) ? params.route[0] : params.route;
  const fn = HANDLERS[name];
  if (!fn) return new Response(JSON.stringify({ error: "Introuvable" }), { status: 404, headers: { "Content-Type": "application/json" } });

  const url = new URL(request.url);
  const headers = {};
  request.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
  headers.host = url.host;
  const body = ["GET", "HEAD"].includes(request.method) ? "" : await request.text();

  const res = await fn.handler({
    httpMethod: request.method, headers, body, isBase64Encoded: false, env, path: url.pathname,
    queryStringParameters: Object.fromEntries(url.searchParams)
  });
  if (res.statusCode === 204 || res.statusCode === 202) return new Response(null, { status: res.statusCode });
  const out = res.isBase64Encoded ? Uint8Array.from(atob(res.body), c => c.charCodeAt(0)) : res.body;
  return new Response(out, { status: res.statusCode, headers: res.headers || {} });
}
