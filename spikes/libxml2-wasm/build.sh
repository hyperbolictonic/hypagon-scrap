#!/usr/bin/env bash
# POSIX build: libxml2 2.11.9 (HTML enabled) -> WASM.
# Windows users: use build.ps1 instead; it is the path that was verified.
set -euo pipefail
cd "$(dirname "$0")"

EMSDK="${EMSDK:-$HOME/emsdk}"
if [ -f "$EMSDK/emsdk_env.sh" ]; then
  # shellcheck disable=SC1090
  source "$EMSDK/emsdk_env.sh" >/dev/null 2>&1 || true
fi
command -v emcc >/dev/null 2>&1 || { echo "ERROR: emcc not on PATH (source emsdk_env)"; exit 1; }

SRC=libxml2-2.11.9
OUT=build
mkdir -p "$OUT"

if [ ! -d "$SRC" ]; then
  echo "ERROR: $SRC not found — extract the tarball first"; exit 1
fi

# configure would generate these two headers.
node gen-headers.js

# Standalone drivers (nanoftp/runsuite/runxmlconf) each define main().
# nanohttp + xzlib need FTP/HTTP/lzma, which are disabled.
SRCS=$(cd "$SRC" && ls *.c \
  | grep -vE '^(nanohttp|nanoftp|DOCBparser|schematron|xzlib|runtest|runsuite|runxmlconf|xmllint|xmlcatalog|test.*|trio.*|xml2-config)\.c$' \
  | sed "s|^|$SRC/|")

EXPORTS='["_hx_parse","_hx_doc_free","_hx_type","_hx_name","_hx_text","_hx_child_count","_hx_child_at","_hx_attr_count","_hx_attr_name","_hx_attr_value","_hx_path","_hx_free_str","_hx_xpath","_hx_xpath_type","_hx_xpath_size","_hx_xpath_item","_hx_xpath_number","_hx_xpath_free","_malloc","_free"]'

echo "compiling $(echo "$SRCS" | wc -l) libxml2 translation units..."

emcc -O2 \
  -DLIBXML_STATIC \
  -I"$SRC/include" -I"$SRC" -Isrc \
  src/hx_wrapper.c $SRCS \
  -o "$OUT/hx.mjs" \
  -sMODULARIZE=1 \
  -sEXPORT_ES6=1 \
  -sENVIRONMENT=node \
  -sALLOW_MEMORY_GROWTH=1 \
  -sSTACK_SIZE=2097152 \
  -sEXPORT_NAME=createHxModule \
  -sEXPORTED_FUNCTIONS="$EXPORTS" \
  -sEXPORTED_RUNTIME_METHODS='["ccall","cwrap","UTF8ToString","stringToUTF8","lengthBytesUTF8"]'

echo "OK -> $OUT/hx.mjs"
