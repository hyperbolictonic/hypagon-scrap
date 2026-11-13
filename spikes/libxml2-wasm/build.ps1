# Reproducible build: libxml2 2.11.9 (HTML enabled) -> WASM.
#
# This is the script that actually produced the S1b result. Requires an
# activated emsdk (see README.md). Run from this directory:
#   pwsh -File build.ps1
param(
  [string]$Emsdk = "$env:USERPROFILE\emsdk"
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$emcc = Join-Path $Emsdk "upstream\emscripten\emcc.exe"
if (-not (Test-Path $emcc)) { throw "emcc not found at $emcc - install/activate emsdk first" }

$src = "libxml2-2.11.9"
if (-not (Test-Path $src)) { throw "$src missing - extract libxml2-2.11.9.tar.xz here" }

# Generate the two headers configure would have produced.
node gen-headers.js

# Standalone drivers (nanoftp/runsuite/runxmlconf) each define main().
# nanohttp + xzlib need FTP/HTTP/lzma, which are disabled.
$exclude = '^(nanohttp|nanoftp|DOCBparser|schematron|xzlib|runtest|runsuite|runxmlconf|xmllint|xmlcatalog|test.*|trio.*|xml2-config)\.c$'
$files = Get-ChildItem $src -Filter *.c |
  Where-Object { $_.Name -notmatch $exclude } |
  ForEach-Object { $_.FullName }

$exports = '["_hx_parse","_hx_doc_free","_hx_type","_hx_name","_hx_text","_hx_child_count","_hx_child_at","_hx_attr_count","_hx_attr_name","_hx_attr_value","_hx_path","_hx_free_str","_hx_xpath","_hx_xpath_type","_hx_xpath_size","_hx_xpath_item","_hx_xpath_number","_hx_xpath_free","_malloc","_free"]'

New-Item -ItemType Directory -Force -Path build | Out-Null

$emccArgs = @(
  "-O2", "-DLIBXML_STATIC", "-I$src\include", "-I$src", "-Isrc", "src\hx_wrapper.c"
) + $files + @(
  "-o", "build\hx.mjs",
  "-sMODULARIZE=1", "-sEXPORT_ES6=1", "-sENVIRONMENT=node",
  "-sALLOW_MEMORY_GROWTH=1", "-sSTACK_SIZE=2097152",
  "-sEXPORT_NAME=createHxModule",
  "-sEXPORTED_FUNCTIONS=$exports",
  '-sEXPORTED_RUNTIME_METHODS=["ccall","cwrap","UTF8ToString","stringToUTF8","lengthBytesUTF8"]'
)

Write-Host "compiling $($files.Count) translation units..."
& $emcc @emccArgs
if ($LASTEXITCODE -ne 0) { throw "emcc failed with exit $LASTEXITCODE" }

Get-ChildItem build | Select-Object Name, @{ n = "KB"; e = { [math]::Round($_.Length / 1KB, 1) } } | Format-Table -AutoSize
