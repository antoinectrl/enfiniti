/* /api/admin — interface de gestion des commandes (protégée par ADMIN_PASSWORD).
   Actions : list, label, labels-pdf, ship, resend, status, methods. */
const { json, IS_LIVE, stripe } = require("../../lib/shop.js");
const O = require("../../lib/orders.js");

exports.handler = async (event) => {
  if (!O.isAdmin(event)) return json(401, { error: "Mot de passe incorrect" });
  const q = event.queryStringParameters || {};
  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (e) {}
  const action = q.action || body.action;
  try {
    switch (action) {
      case "list":
        return json(200, { orders: await O.listOrders(), config: {
          sendcloud: !!(process.env.SENDCLOUD_PUBLIC_KEY && process.env.SENDCLOUD_SECRET_KEY),
          mail: O.mailReady(), google: !!process.env.GMAIL_SCRIPT_URL,
          live: IS_LIVE() } });

      case "stats": {     // tableau de bord en direct (visites : base Cloudflare D1 ; paniers et commandes : Stripe)
        const db = event.env && event.env.DB, now = Date.now();
        const tz = "Europe/Paris", dayStart = new Date(new Date().toLocaleString("en-US", { timeZone: tz })); dayStart.setHours(0, 0, 0, 0);
        const midnight = now - (new Date(new Date().toLocaleString("en-US", { timeZone: tz })).getTime() - dayStart.getTime());
        const out = { tracking: !!db };
        if (db) {
          const one = (sql, ...v) => db.prepare(sql).bind(...v).first();
          const all = (sql, ...v) => db.prepare(sql).bind(...v).all().then(r => r.results);
          out.online = (await one("SELECT COUNT(DISTINCT sid) c FROM events WHERE ts > ?", now - 5 * 60e3)).c;
          out.carts = (await one("SELECT COUNT(*) c FROM (SELECT sid, n FROM events e WHERE ts > ? AND ts = (SELECT MAX(ts) FROM events WHERE sid = e.sid AND ts > ?)) WHERE n > 0", now - 30 * 60e3, now - 30 * 60e3)).c;
          out.today = await one("SELECT COUNT(DISTINCT sid) visitors, SUM(type='view') views, COUNT(DISTINCT CASE WHEN type='cart' THEN sid END) carted, COUNT(DISTINCT CASE WHEN type='checkout' THEN sid END) checkouts FROM events WHERE ts >= ?", midnight);
          out.days = await all("SELECT strftime('%Y-%m-%d', ts/1000, 'unixepoch', '+1 hour') d, COUNT(DISTINCT sid) v FROM events WHERE ts >= ? GROUP BY d ORDER BY d", midnight - 6 * 864e5);
          out.sources = await all("SELECT ref, COUNT(DISTINCT sid) v FROM events WHERE ts >= ? AND type='view' GROUP BY ref ORDER BY v DESC LIMIT 6", now - 7 * 864e5);
        }
        const { stripe } = require("../../lib/shop.js");
        const open = await stripe(`checkout/sessions?limit=100&status=open&created[gte]=${Math.floor(now / 1000) - 3600}`);
        out.paying = open.data.filter(s => s.expires_at * 1000 > now).length;
        out.paying_amount = open.data.filter(s => s.expires_at * 1000 > now).reduce((a, s) => a + (s.amount_total || 0), 0);
        return json(200, out);
      }

      case "settings": {   // page Réglages : voir ce qui est branché / enregistrer une clé
        const KEYS = ["BREVO_API_KEY", "MAIL_FROM", "SENDCLOUD_PUBLIC_KEY", "SENDCLOUD_SECRET_KEY", "GMAIL_SCRIPT_URL",
          "INSTAGRAM_URL", "CONTACT_EMAIL", "LEGAL_NAME", "LEGAL_SIRET", "LEGAL_ADDRESS", "LEGAL_MEDIATOR", "STRIPE_LIVE_KEY",
          "PACKLINK_API_KEY", "SHIP_FROM_NAME", "SHIP_FROM_STREET", "SHIP_FROM_ZIP", "SHIP_FROM_CITY", "SHIP_FROM_PHONE"];
        const PUBLIC = ["MAIL_FROM", "INSTAGRAM_URL", "CONTACT_EMAIL", "LEGAL_NAME", "LEGAL_SIRET", "LEGAL_ADDRESS", "LEGAL_MEDIATOR", "SHIP_FROM_NAME", "SHIP_FROM_STREET", "SHIP_FROM_ZIP", "SHIP_FROM_CITY", "SHIP_FROM_PHONE"];
        const save = async (k, v) => {
          if (v) await db.prepare("INSERT INTO settings (k, v, updated) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated = excluded.updated").bind(k, v, Date.now()).run();
          else await db.prepare("DELETE FROM settings WHERE k = ?").bind(k).run();
          process.env[k] = v;
        };
        const db = event.env && event.env.DB;
        if (body.set) {
          if (!db) return json(500, { error: "Base de réglages indisponible" });
          const entries = Object.entries(body.set).filter(([k, v]) => KEYS.includes(k) && typeof v === "string").map(([k, v]) => [k, v.trim()]);
          for (const [k, v] of entries) {
            if (k === "STRIPE_LIVE_KEY" && v) {
              // Passage en paiement réel : on vérifie la clé et on crée le webhook live avant d'enregistrer.
              if (!/^(rk|sk)_live_/.test(v)) return json(400, { error: "Ce n'est pas une clé live (elle doit commencer par rk_live_ ou sk_live_)." });
              const call = async (path, form) => {
                const r = await fetch("https://api.stripe.com/v1/" + path, { method: form ? "POST" : "GET",
                  headers: { Authorization: "Bearer " + v, "Content-Type": "application/x-www-form-urlencoded", "Stripe-Version": "2026-10-28.endive" }, body: form });
                const d = await r.json(); if (!r.ok) throw new Error(d.error && d.error.message || "Stripe"); return d;
              };
              try { await call("checkout/sessions?limit=1"); } catch (e) { return json(400, { error: "Clé refusée par Stripe : " + e.message }); }
              const host = event.headers["x-forwarded-host"] || event.headers.host;
              const url = `https://${host}/api/webhook`;
              let wh;
              try {
                const existing = await call("webhook_endpoints?limit=100");
                for (const w of existing.data.filter(w => w.url === url))   // ancien webhook live vers la même adresse : remplacé
                  await fetch(`https://api.stripe.com/v1/webhook_endpoints/${w.id}`, { method: "DELETE", headers: { Authorization: "Bearer " + v } });
                const ev = ["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed", "charge.refunded"];
                wh = await call("webhook_endpoints", `url=${encodeURIComponent(url)}&api_version=2026-10-28.endive&description=${encodeURIComponent("Boutique DRIPT")}&` + ev.map(e => "enabled_events[]=" + e).join("&"));
              } catch (e) { return json(400, { error: "La clé doit aussi avoir la permission « Webhook Endpoints : Écriture ». Détail : " + e.message }); }
              await save("STRIPE_WEBHOOK_SECRET_LIVE", wh.secret);
            }
            await save(k, v);
          }
        }
        const checks = {};
        if (process.env.BREVO_API_KEY) {
          const r = await fetch("https://api.brevo.com/v3/account", { headers: { "api-key": process.env.BREVO_API_KEY, accept: "application/json" } });
          const d = await r.json().catch(() => ({}));
          checks.brevo = r.ok ? { ok: true, info: (d.companyName || d.email || "compte Brevo") + (d.plan && d.plan[0] ? " · " + (d.plan[0].credits ?? "") + " crédits" : "") } : { ok: false, info: "Clé Brevo refusée" };
        }
        if (process.env.SENDCLOUD_PUBLIC_KEY && process.env.SENDCLOUD_SECRET_KEY) {
          try { const u = await O.sendcloud("user"); checks.sendcloud = { ok: true, info: (u.user && (u.user.company_name || u.user.username)) || "compte Sendcloud" }; }
          catch (e) { checks.sendcloud = { ok: false, info: "Clés Sendcloud refusées" }; }
        }
        if (process.env.GMAIL_SCRIPT_URL) {
          try { checks.google = { ok: true, info: (await O.mailQuota()) + " envois possibles aujourd'hui" }; } catch (e) { checks.google = { ok: false, info: e.message }; }
        }
        if (process.env.PACKLINK_API_KEY) {
          try { const t = await require("../../lib/packlink.js").test(); checks.packlink = { ok: true, info: "Connecté · ex. " + t.exemple }; }
          catch (e) { checks.packlink = { ok: false, info: e.message.slice(0, 160) }; }
        }
        checks.stripe = { ok: true, live: IS_LIVE(), info: IS_LIVE() ? "Paiement réel actif" : "Mode test (aucun vrai paiement)" };
        const filled = Object.fromEntries(KEYS.map(k => [k, process.env[k] ? (PUBLIC.includes(k) ? process.env[k] : "•••• " + process.env[k].slice(-4)) : ""]));
        return json(200, { filled, checks });
      }

      case "migrate-list": {   // copie la liste d'inscrits du Stripe de test vers le Stripe réel (par paquets)
        const test = process.env.STRIPE_SECRET_KEY || process.env.stripe;
        if (!IS_LIVE() || !test || /_live_/.test(test)) return json(400, { error: "Rien à copier (le paiement réel n'est pas actif)." });
        const tcall = async (path, form) => {
          const r = await fetch("https://api.stripe.com/v1/" + path, { method: form ? "POST" : "GET", headers: { Authorization: "Bearer " + test, "Content-Type": "application/x-www-form-urlencoded" }, body: form });
          const d = await r.json(); if (!r.ok) throw new Error(d.error && d.error.message); return d;
        };
        const all = []; let page = null;
        for (let i = 0; i < 5; i++) {
          const r = await tcall(`customers/search?limit=100&query=${encodeURIComponent("metadata['source']:'liste-black-friday'")}` + (page ? `&page=${encodeURIComponent(page)}` : ""));
          all.push(...r.data); if (!r.has_more) break; page = r.next_page;
        }
        const todo = all.filter(c => c.email && !/@example\.com$/.test(c.email) && !(c.metadata && c.metadata.copie_live === "1"));
        let copied = 0;
        for (const c of todo.slice(0, 12)) {
          const ex = await stripe(`customers?limit=1&email=${encodeURIComponent(c.email)}`);
          if (!ex.data.length) await stripe("customers", { method: "POST", body: { email: c.email, metadata: { source: "liste-black-friday" } } });
          await tcall(`customers/${c.id}`, "metadata[copie_live]=1");
          copied++;
        }
        return json(200, { copied, remaining: Math.max(0, todo.length - copied) });
      }

      case "import-emails": {   // ajoute une liste d'e-mails comme inscrits sur le compte actuel (12 max par appel)
        const emails = (Array.isArray(body.emails) ? body.emails : []).slice(0, 12).map(e => String(e).trim().toLowerCase()).filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e));
        let added = 0;
        for (const email of emails) {
          const ex = await stripe(`customers?limit=1&email=${encodeURIComponent(email)}`);
          if (!ex.data.length) { await stripe("customers", { method: "POST", body: { email, metadata: { source: "liste-black-friday" } } }); added++; }
        }
        return json(200, { added, seen: emails.length });
      }

      case "packlink-drafts": {   // crée les envois Packlink en brouillon (panier non payé)
        const PL = require("../../lib/packlink.js");
        const ids = (body.ids || []).slice(0, 4), done = [], errors = [];
        for (const id of ids) {
          try {
            const o = await O.getOrder(id);
            if (!o.paid || o.released) throw new Error("commande non payée ou annulée");
            const m = (await stripe(`checkout/sessions/${encodeURIComponent(id)}`)).metadata || {};
            if (m.packlink_ref) { done.push({ id, number: o.number, reference: m.packlink_ref, already: true }); continue; }
            const r = await PL.draft(o);
            await O.setMeta(id, { packlink_ref: String(r.reference).slice(0, 100) });
            done.push({ id, number: o.number, ...r });
          } catch (e) { errors.push({ id, error: e.message }); }
        }
        return json(200, { done, errors });
      }

      case "mail-info": {  // nombre d'inscrits + envois Google restants aujourd'hui
        const subs = await O.subscribers();
        let quota = null; try { quota = await O.mailQuota(); } catch (e) {}
        return json(200, { subscribers: subs.length, ready: O.mailReady(), quota });
      }

      case "broadcast": {  // e-mail à toute la liste (par paquets de 20, reprend là où il s'est arrêté)
        return json(200, await O.broadcast(body));
      }

      case "methods": {   // modes d'envoi Sendcloud disponibles vers la France
        const r = await O.sendcloud("shipping_methods?to_country=FR");
        return json(200, { methods: (r.shipping_methods || []).map(m => ({ id: m.id, name: m.name, carrier: m.carrier, relay: m.service_point_input === "required", min: m.min_weight, max: m.max_weight })) });
      }

      case "label": {     // crée les étiquettes manquantes pour les commandes données
        const ids = (body.ids || []).slice(0, 25), done = [], errors = [];
        for (const id of ids) {
          try { const o = await O.getOrder(id); if (!o.paid || o.released) throw new Error("commande non payée ou annulée");
                done.push({ id, ...(await O.createLabel(o, { relay: body.methodRelay, home: body.methodHome })) }); }
          catch (e) { errors.push({ id, error: e.message }); }
        }
        return json(200, { done, errors });
      }

      case "labels-pdf": {  // PDF des étiquettes (une ou plusieurs)
        const ids = (body.parcels || []).slice(0, 50);
        if (!ids.length) return json(400, { error: "Aucune étiquette" });
        const pdf = await O.labelsPdf(ids);
        return { statusCode: 200, headers: { "Content-Type": "application/pdf" }, body: pdf.toString("base64"), isBase64Encoded: true };
      }

      case "ship": {      // marque expédiée + e-mail de suivi au client
        const done = [], errors = [];
        for (const id of (body.ids || []).slice(0, 25)) {
          try { const o = await O.getOrder(id); await O.sendShipped(o); done.push(id); }
          catch (e) { errors.push({ id, error: e.message }); }
        }
        return json(200, { done, errors });
      }

      case "resend": {    // renvoie l'e-mail de confirmation
        const o = await O.getOrder(body.id); await O.sendConfirmation(o);
        return json(200, { ok: true });
      }

      case "status": {    // changement manuel de statut
        if (!["a_preparer", "etiquette", "expediee"].includes(body.status)) return json(400, { error: "Statut invalide" });
        await O.setMeta(body.id, { status: body.status });
        return json(200, { ok: true });
      }
    }
    return json(400, { error: "Action inconnue" });
  } catch (e) {
    return json(502, { error: e.message });
  }
};
