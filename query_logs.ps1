# query_logs.ps1 — PS5 compatible; no jq; stderr-safe; writes ONLY to log.txt
$ErrorActionPreference = 'Stop'
$env:AWS_PAGER = ""   # disable pager

# ---- tiny wrappers (for non-start calls) ----
function AwsText { param([string[]]$A) try { (& aws @A 2>$null | Out-String).Trim() } catch { "" } }
function AwsJson { param([string[]]$A) $t = AwsText $A; if (!$t) { return $null } try { $t | ConvertFrom-Json } catch { $null } }

# ---- region / window ----
$region = $env:AWS_REGION; if (-not $region) { $region = AwsText @('configure','get','region') }
if (-not $region) { throw "Set AWS_REGION or configure a default region." }

if ($env:DURATION_MIN) { $durationMinutes = [int]$env:DURATION_MIN } else { $durationMinutes = 50 }
$start = [int][double]::Parse((Get-Date -Date (Get-Date).ToUniversalTime().AddMinutes(-$durationMinutes) -UFormat %s))
$end   = [int][double]::Parse((Get-Date -Date (Get-Date).ToUniversalTime()                      -UFormat %s))

# Order controls output shape
$query = @"
fields @timestamp, @message, @logStream, @log
| sort @timestamp desc
| limit 500
"@.Trim()

# ---- collect groups (this account/region) ----
$groups = AwsJson @('logs','describe-log-groups','--region',$region,'--query','logGroups[].logGroupName','--output','json')
$groups = @($groups)
$logfile = "log.txt"

if ($groups.Count -eq 0) {
  Set-Content -Path $logfile -Value "No log groups found in $region." -Encoding utf8 -Force
  Write-Host "Results written to $logfile"; exit
}

# ---- start query (single call; 33 < 50 limit) ----
# Build ONE args array and pass it with splatting to the native aws.exe.
$startArgs = @(
  'logs','start-query',
  '--region', $region,
  '--start-time', $start,
  '--end-time', $end,
  '--query-string', $query,
  '--log-group-names'
) + $groups + @('--query','queryId','--output','text')

$qid = (& aws @startArgs 2>$null | Out-String).Trim()
if (-not $qid) {
  Set-Content -Path $logfile -Value "Failed to start query (no queryId). Region=$region Groups=$($groups.Count)" -Encoding utf8 -Force
  Write-Host "Results written to $logfile"; exit
}

# ---- poll ----
for ($i=0; $i -lt 120; $i++) {
  Start-Sleep -Seconds 1
  $status = AwsText @('logs','get-query-results','--region',$region,'--query-id',$qid,'--query','status','--output','text')
  if ($status -eq 'Complete') { break }
  if ($status -in @('Failed','Cancelled','Timeout')) {
    Set-Content -Path $logfile -Value "Query $qid ended with status: $status" -Encoding utf8 -Force
    Write-Host "Results written to $logfile"; exit
  }
}

# ---- fetch & shape rows ----
$res = AwsJson @('logs','get-query-results','--region',$region,'--query-id',$qid,'--output','json')
$items = @()
foreach ($r in $res.results) {
  # values come in the same order as 'fields'
  $vals = @(); foreach ($c in $r) { $vals += $c.value }
  if ($vals.Count -ge 4 -and $vals[0]) {
    $items += [pscustomobject]@{ timestamp=$vals[0]; message=$vals[1]; logStream=$vals[2]; log=$vals[3] }
  }
}

# ---- header + table lines ----
$acctId = (AwsJson @('sts','get-caller-identity','--output','json')).Account
$lines  = New-Object System.Collections.Generic.List[string]
$null = $lines.Add("Using account: $acctId")
$null = $lines.Add("Region       : $region")
$null = $lines.Add("Window       : last $durationMinutes minutes")
$null = $lines.Add("-" * 80)
$null = $lines.Add(("Log groups found: {0}" -f $groups.Count))
$null = $lines.Add(("{0,-24}  {1,-60}  {2,-40}  {3}" -f "timestamp","logStream","log","message"))
$null = $lines.Add(("-" * 160))

if ($items.Count -eq 0) {
  $null = $lines.Add("No log events found in last $durationMinutes minutes in region $region.")
} else {
  $items |
    Sort-Object timestamp -Descending |
    Select-Object -First 50 |
    ForEach-Object {
      $ts  = if ($_.timestamp) { $_.timestamp } else { "" }
      $ls  = if ($_.logStream) { $_.logStream } else { "" }
      $lg  = if ($_.log)       { $_.log.Substring(0,[Math]::Min(40,$_.log.Length)) } else { "" }
      $msg = if ($_.message)   { $_.message } else { "" }
      $lines.Add("{0,-24}  {1,-60}  {2,-40}  {3}" -f $ts,$ls,$lg,$msg) | Out-Null
    }
}

# ---- write file (force overwrite) ----
if (Test-Path $logfile) { Remove-Item $logfile -Force -ErrorAction SilentlyContinue }
Set-Content -Path $logfile -Value $lines -Encoding utf8 -Force
Write-Host "Results written to $logfile"
