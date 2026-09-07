$ErrorActionPreference = "Stop"

$workspace = if ($env:COZE_WORKSPACE_PATH) { $env:COZE_WORKSPACE_PATH } else { (Get-Location).Path }
Set-Location $workspace

Write-Host "Installing dependencies..."
& pnpm install --prefer-frozen-lockfile --prefer-offline --loglevel debug --reporter=append-only
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

if (Get-Command coze-dev -ErrorAction SilentlyContinue) {
  & coze-dev check-bins --help *> $null
  if ($LASTEXITCODE -eq 0) {
    & coze-dev check-bins --fix
    exit $LASTEXITCODE
  }
}
