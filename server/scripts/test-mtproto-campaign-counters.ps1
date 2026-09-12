$ErrorActionPreference = 'Stop'
# Valida a migration 083 (contadores derivados + alvos pulados) num PostgreSQL 16
# descartavel, no mesmo molde de test-bot-healing-migration.ps1: conteiner sem
# rede nem volumes de host, removido ao terminar. Nao toca no Supabase real.
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$migrations = Join-Path $projectRoot 'supabase/migrations'
$checks = Join-Path $projectRoot 'server/tests/sql/mtproto-campaign-counters.sql'
$containerName = 'eaglebot-mtproto-counters-test-' + [Guid]::NewGuid().ToString('N')
$containerId = docker run --rm --detach --network none --name $containerName -e POSTGRES_PASSWORD=local-disposable-test -e POSTGRES_DB=counters_test postgres:16-alpine
if ($LASTEXITCODE -ne 0 -or $containerId -notmatch '^[a-f0-9]{64}$') { throw 'Failed to start disposable PostgreSQL container' }
try {
  $ready = $false
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    docker exec $containerId pg_isready -U postgres -d counters_test 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw 'PostgreSQL did not become ready' }
  docker cp $migrations "${containerId}:/tmp/migrations"
  if ($LASTEXITCODE -ne 0) { throw 'Migrations copy failed' }
  docker cp $checks "${containerId}:/tmp/checks.sql"
  if ($LASTEXITCODE -ne 0) { throw 'SQL checks copy failed' }
  docker exec $containerId psql -U postgres -d counters_test -v ON_ERROR_STOP=1 -f /tmp/checks.sql
  if ($LASTEXITCODE -ne 0) { throw 'Migration checks failed' }
} finally {
  # Only the validated ID created by this script; no host mounts or shared database.
  docker stop $containerId | Out-Null
}
