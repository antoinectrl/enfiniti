/* Version « tout-en-un » pour Cloudflare : pages + photos + /api dans un seul fichier. */
import ASSETS from "./assets.gen.mjs";
import { onRequest } from "../functions/api/[[route]].js";

const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    let path = url.pathname;
    if (path.startsWith("/api/")) {
      const route = path.slice(5).split("/").filter(Boolean);
      return onRequest({ request, env, params: { route } });
    }
    if (path === "/admin.html") return Response.redirect(url.origin + "/admin", 301);
    if (path === "/" ) path = "/index.html";
    if (path === "/admin") path = "/admin.html";
    const a = ASSETS[path] || ASSETS["/index.html"];
    const headers = { "Content-Type": a.type, "Cache-Control": a.type.startsWith("image/") ? "public, max-age=604800" : "public, max-age=60" };
    if (path === "/admin.html") { headers["X-Robots-Tag"] = "noindex"; headers["Cache-Control"] = "no-store"; }
    return new Response(a.bin ? b64(a.data) : a.data, { status: ASSETS[path] ? 200 : 200, headers });
  }
};
