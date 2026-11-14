#!/bin/sh
# Prépare le dossier public/ (seulement ce que les visiteurs doivent voir).
set -e
rm -rf public && mkdir -p public
cp index.html admin.html catalog.js public/
cp -r img public/img
printf '/admin.html  /admin  301\n' > public/_redirects
printf '/admin\n  X-Robots-Tag: noindex\n  Cache-Control: no-store\n' > public/_headers
