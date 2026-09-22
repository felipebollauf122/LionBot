$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$containerName = 'eaglebot-campaign-timing-test-' + [Guid]::NewGuid().ToString('N')
$containerId = docker run --rm --detach --network none --memory 256m --cpus 1 --name $containerName -e POSTGRES_PASSWORD=local-disposable-test postgres:16-alpine
if ($LASTEXITCODE -ne 0 -or $containerId -notmatch '^[a-f0-9]{64}$') { throw 'Failed to start disposable PostgreSQL' }
try {
  $ready = $false
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    docker exec $containerId pg_isready -U postgres 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw 'PostgreSQL did not become ready' }
  docker cp (Join-Path $projectRoot 'supabase/migrations/086_mtproto_campaign_configured_timing.sql') "${containerId}:/tmp/migration.sql"
  if ($LASTEXITCODE -ne 0) { throw 'Migration copy failed' }
  docker cp (Join-Path $projectRoot 'server/tests/sql/mtproto-campaign-timing.sql') "${containerId}:/tmp/checks.sql"
  if ($LASTEXITCODE -ne 0) { throw 'Checks copy failed' }
  docker exec $containerId psql -U postgres -v ON_ERROR_STOP=1 -f /tmp/checks.sql
  if ($LASTEXITCODE -ne 0) { throw 'Migration checks failed' }
} finally {
  docker stop $containerId | Out-Null
}
