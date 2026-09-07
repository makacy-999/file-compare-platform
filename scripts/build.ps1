$ErrorActionPreference = "Stop"

$workspace = if ($env:COZE_WORKSPACE_PATH) { $env:COZE_WORKSPACE_PATH } else { (Get-Location).Path }
Set-Location $workspace

Write-Host "Installing dependencies..."
& pnpm install --prefer-frozen-lockfile --prefer-offline --loglevel debug --reporter=append-only
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Building the Next.js project..."
& pnpm next build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Bundling server with tsup..."
& pnpm tsup src/server.ts --format cjs --platform node --target node20 --outDir dist --no-splitting --no-minify
exit $LASTEXITCODE
