#!/bin/sh
# Construit dist-worker/_worker.js (déploiement direct sur Cloudflare Pages, sans GitHub).
set -e
cd "$(dirname "$0")/.."
python3 -I - <<'PY'
import base64, json, os
types={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".jpg":"image/jpeg",".png":"image/png"}
assets={}
for p in ["index.html","admin.html","catalog.js"]+["img/"+f for f in sorted(os.listdir("img"))]:
    ext=os.path.splitext(p)[1]; data=open(p,"rb").read()
    binf=not ext in (".html",".js")
    assets["/"+p]={"type":types[ext],"bin":binf,"data":base64.b64encode(data).decode() if binf else data.decode()}
open("tools/assets.gen.mjs","w").write("export default "+json.dumps(assets)+";\n")
PY
rm -rf dist-worker && mkdir dist-worker
npx -y esbuild@0.24.0 tools/worker-entry.mjs --bundle --format=esm --platform=neutral --main-fields=module,main \
  --alias:crypto=./tools/shim-crypto.mjs --external:node:* --outfile=dist-worker/_worker.js --log-level=warning
ls -la dist-worker
