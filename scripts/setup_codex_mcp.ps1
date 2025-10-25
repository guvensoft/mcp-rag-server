param(
  [string]$Url = 'http://127.0.0.1:7450/mcp'
)

$ErrorActionPreference = 'Stop'

$configDir = Join-Path $env:APPDATA 'codex'
$configPath = Join-Path $configDir 'mcp.json'
New-Item -ItemType Directory -Force -Path $configDir | Out-Null

function New-ClientsObject {
  $obj = [ordered]@{}
  $obj.clients = [ordered]@{}
  return ($obj | ConvertTo-Json -Depth 10 | ConvertFrom-Json)
}

if (Test-Path $configPath) {
  try {
    $json = Get-Content -Raw -Path $configPath | ConvertFrom-Json
  } catch {
    Write-Warning "Existing mcp.json is not valid JSON; backing up and recreating."
    Copy-Item -Force $configPath "$configPath.bak"
    $json = New-ClientsObject
  }
} else {
  $json = New-ClientsObject
}

if (-not $json.PSObject.Properties.Name.Contains('clients')) {
  $json | Add-Member -MemberType NoteProperty -Name clients -Value (@{})
}

# Ensure clients is a hashtable for assignment
if ($json.clients -isnot [hashtable]) {
  $tmp = @{}
  if ($json.clients -and $json.clients.PSObject -and $json.clients.PSObject.Properties) {
    foreach ($prop in $json.clients.PSObject.Properties) { $tmp[$prop.Name] = $prop.Value }
  }
  $json.clients = $tmp
}

$json.clients['rag_mcp_http'] = @{ transport = @{ type = 'http'; url = $Url } }

$json | ConvertTo-Json -Depth 10 | Set-Content -Path $configPath -Encoding UTF8

Write-Host "Updated Codex MCP config:" -ForegroundColor Green
Write-Host "  $configPath" -ForegroundColor Green
Write-Host "  rag_mcp_http → $Url" -ForegroundColor Green
