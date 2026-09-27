#!/bin/sh
# Build BOSS for the browser into web/dist: Free Pascal trunk (wasm32-wasip1
# cross compiler in ~/Games/fpc-wasm, built from ~/Games/fpc-src), then
# wasm-opt --asyncify so readkey can wait for the page. Deploy: web/deploy.sh.
set -e
cd "$(dirname "$0")/.."
F=$HOME/Games/fpc-wasm/lib/fpc/3.3.1
LLVM=${LLVM:-/opt/homebrew/Cellar/emscripten/6.0.10/libexec/llvm/bin}
OUT=web/dist
rm -rf "$OUT" web/build && mkdir -p "$OUT/dat" web/build
"$F/ppcrosswasm32" -Twasip1 -O2 -Sgic -Fu"$F/units/wasm32-wasip1/rtl" -Fu"$F/units/wasm32-wasip1/rtl-objpas" \
	-Fuport -FUweb/build -FEweb/build -XP"$LLVM/" boss.pas | grep -v "Warning\|Note\|Hint" || true
BMO=--enable-bulk-memory-opt; wasm-opt --help | grep -q bulk-memory-opt || BMO=   # older binaryen (apt)
wasm-opt -O2 --enable-reference-types --enable-bulk-memory $BMO --enable-sign-ext --enable-nontrapping-float-to-int --enable-mutable-globals --enable-multivalue --asyncify --pass-arg=asyncify-imports@boss.be_getkey,boss.be_sleep \
	web/build/boss.wasm -o "$OUT/boss.wasm"
cp dat/* "$OUT/dat/"
/bin/ls dat > "$OUT/dat/files.txt"
cp web/index.html web/boss.js "$OUT/"
# text fonts: the index page's fonts/ (served at ../fonts/ next to the games)
(cd ~/Games/roguelikes-index/fonts && ls *.woff | sed 's/\.woff$//') | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read().split()))' > "$OUT/fonts.json"
cp -r web/vendor "$OUT/vendor"
python3 web/make-help.py > "$OUT/help.html"
rm -rf web/build
ls -la "$OUT"
