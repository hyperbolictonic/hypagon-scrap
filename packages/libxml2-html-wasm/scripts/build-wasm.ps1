# Build libxml2 2.11.9 (HTML + XPath) to WASM and emit ../build/hx.mjs + hx.wasm.
#
# The libxml2 source is fetched into .cache and never committed. Headers that
# configure would generate are produced by gen-headers.js.
param(
  [string]$Libxml2 = "",
  [string]$Emsdk = "$env:USERPROFILE\emsdk"
)

$ErrorActionPreference = "Stop"
$pkg = Split-Path -Parent $PSScriptRoot
Set-Location $pkg

$emcc = Join-Path $Emsdk "upstream\emscripten\emcc.exe"
if (-not (Test-Path $emcc)) { throw "emcc not found at $emcc - install and activate emsdk" }

$cache = Join-Path $pkg ".cache"
New-Item -ItemType Directory -Force -Path $cache | Out-Null

if (-not $Libxml2) {
  $Libxml2 = Join-Path $cache "libxml2-2.11.9"
}

if (-not (Test-Path $Libxml2)) {
  $tarball = Join-Path $cache "libxml2-2.11.9.tar.xz"
  if (-not (Test-Path $tarball)) {
    $spike = Join-Path $pkg "..\..\spikes\libxml2-wasm\libxml2-2.11.9.tar.xz"
    if (Test-Path $spike) {
      Copy-Item $spike $tarball
    } else {
      Write-Host "downloading libxml2 2.11.9..."
      Invoke-WebRequest "https://download.gnome.org/sources/libxml2/2.11/libxml2-2.11.9.tar.xz" -OutFile $tarball
    }
  }
  tar -xf $tarball -C $cache
}

node scripts/gen-headers.js $Libxml2

# Standalone drivers each define main(); nanohttp/xzlib need disabled features.
$exclude = '^(nanohttp|nanoftp|DOCBparser|schematron|xzlib|runtest|runsuite|runxmlconf|xmllint|xmlcatalog|test.*|trio.*|xml2-config)\.c$'
$files = Get-ChildItem $Libxml2 -Filter *.c |
  Where-Object { $_.Name -notmatch $exclude } |
  ForEach-Object { $_.FullName }

$exports = '["_hx_parse","_hx_drop_comments","_hx_doc_free","_hx_root","_hx_type","_hx_name","_hx_parent","_hx_text","_hx_own_text","_hx_child_count","_hx_child_at","_hx_attr_count","_hx_attr_name","_hx_attr_value","_hx_path","_hx_free_str","_hx_xpath","_hx_xpath_at","_hx_xpath_type","_hx_xpath_size","_hx_xpath_item","_hx_xpath_number","_hx_xpath_free","_malloc","_free"]'

New-Item -ItemType Directory -Force -Path build | Out-Null

$emccArgs = @(
  "-O2", "-DLIBXML_STATIC",
  "-I$Libxml2\include", "-I$Libxml2", "-Isrc",
  "src\wrapper.c"
) + $files + @(
  "-o", "build\hx.mjs",
  "-sMODULARIZE=1", "-sEXPORT_ES6=1", "-sENVIRONMENT=node",
  "-sALLOW_MEMORY_GROWTH=1", "-sSTACK_SIZE=2097152",
  "-sEXPORT_NAME=createHxModule",
  "-sEXPORTED_FUNCTIONS=$exports",
  '-sEXPORTED_RUNTIME_METHODS=["ccall","cwrap","UTF8ToString","lengthBytesUTF8"]'
)

Write-Host "compiling $($files.Count) libxml2 translation units..."
& $emcc @emccArgs
if ($LASTEXITCODE -ne 0) { throw "emcc failed with exit $LASTEXITCODE" }

Get-ChildItem build | Select-Object Name, @{ n = "KB"; e = { [math]::Round($_.Length / 1KB, 1) } } | Format-Table -AutoSize
