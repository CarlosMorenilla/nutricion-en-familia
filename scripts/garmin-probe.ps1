param(
  [Parameter(Mandatory=$true)]
  [ValidatePattern('^https://nutricion-garmin-personal-probe\.[a-z0-9-]+\.workers\.dev/?$')]
  [string]$WorkerUrl,
  [ValidateSet('status','probe')]
  [string]$Action = 'status'
)
# Administrator token only. The Garmin key belongs exclusively in Cloudflare Secrets.
$secureToken = Read-Host 'Token de administración del Worker (entrada oculta)' -AsSecureString
$probeHeaders = $null
try {
  $credential = [System.Management.Automation.PSCredential]::new('probe', $secureToken)
  $probeHeaders = @{ Authorization = 'Bearer ' + $credential.GetNetworkCredential().Password }
  $method = if ($Action -eq 'probe') { 'POST' } else { 'GET' }
  $result = Invoke-RestMethod -Uri ($WorkerUrl.TrimEnd('/') + '/' + $Action) -Method $method -Headers $probeHeaders -MaximumRedirection 0 -TimeoutSec 55
  $result | ConvertTo-Json -Depth 8
} catch {
  # Never print request headers, response bodies, exception messages or stack traces.
  $httpStatus = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { $null }
  @{ code = 'request_failed'; http_status = $httpStatus } | ConvertTo-Json
  exit 1
} finally {
  $probeHeaders = $null
  $credential = $null
  $secureToken.Dispose()
}
