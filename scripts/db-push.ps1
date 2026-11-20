#Requires -Version 5.1
<#
    Runs SQL against the MORGGY Postgres database without psql or the
    Supabase CLI. Loads Npgsql 4.1 (net461) plus its dependencies from
    .tools/nuget into the current PowerShell session.

    Examples:
        powershell -NoProfile -File scripts\db-push.ps1 -Command "select version()"
        powershell -NoProfile -File scripts\db-push.ps1 -SqlFile supabase\migrations\20261120000100_init.sql
        powershell -NoProfile -File scripts\db-push.ps1 -All -Folder supabase\migrations
#>
param(
    [string]$SqlFile,
    [string]$Command,
    [string]$Folder,
    [switch]$All
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$nuget = Join-Path $root '.tools/nuget'
$lib = Join-Path $nuget 'lib'

function Expand-Packages {
    if (-not (Test-Path $nuget)) { throw "Missing $nuget (download the .nupkg files first)." }
    New-Item -ItemType Directory -Force -Path $lib | Out-Null
    Get-ChildItem $nuget -Filter *.nupkg | ForEach-Object {
        $target = Join-Path $lib $_.BaseName
        if (Test-Path $target) { return }
        $zip = [IO.Path]::ChangeExtension($_.FullName, '.zip')
        Copy-Item $_.FullName $zip -Force
        Expand-Archive -Path $zip -DestinationPath $target -Force
        Remove-Item $zip -Force
    }
}

# Npgsql 3.2.7 is a single net45 assembly with no external dependencies,
# which is what actually loads inside Windows PowerShell 5.1.
$LOAD_ORDER = @('Npgsql')

function Import-Npgsql {
    $bin = Join-Path $nuget 'bin'
    New-Item -ItemType Directory -Force -Path $bin | Out-Null

    $targets = @('net461', 'net47', 'net45', 'netstandard2.0')
    foreach ($name in $LOAD_ORDER) {
        $found = $null
        foreach ($tfm in $targets) {
            $candidate = Get-ChildItem $lib -Recurse -Filter "$name.dll" -ErrorAction SilentlyContinue |
                Where-Object { $_.FullName -match "\\$tfm\\" } |
                Select-Object -First 1
            if ($candidate) { $found = $candidate; break }
        }
        if (-not $found) { Write-Warning "missing $name.dll in .tools/nuget/lib"; continue }
        Copy-Item $found.FullName (Join-Path $bin "$name.dll") -Force
    }

    foreach ($name in $LOAD_ORDER) {
        $path = Join-Path $bin "$name.dll"
        if (-not (Test-Path $path)) { continue }
        try {
            Add-Type -Path $path -ErrorAction Stop
        } catch {
            if ($_.Exception.Message -notmatch 'already loaded|Assembly with same name') {
                Write-Warning "load $name failed: $($_.Exception.Message)"
            }
        }
    }
    if (-not ('Npgsql.NpgsqlConnection' -as [type])) {
        throw 'Npgsql failed to load from .tools/nuget/bin'
    }
}

function Get-ConnectionString {
    $envFile = Join-Path $root '.env'
    if (-not (Test-Path $envFile)) { throw "Missing $envFile" }
    $url = $null
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*DATABASE_URL\s*=\s*(.+)$') { $url = $Matches[1].Trim() }
    }
    if (-not $url) { throw 'DATABASE_URL not found in .env' }
    if ($url -notmatch '^postgres(ql)?://([^:]+):([^@]+)@([^:/]+):(\d+)/(.+)$') {
        throw 'DATABASE_URL is not a postgres://user:pass@host:port/db URI'
    }
    $user = [uri]::UnescapeDataString($Matches[2])
    $pass = [uri]::UnescapeDataString($Matches[3])
    $hostName = $Matches[4]
    $port = $Matches[5]
    $db = $Matches[6]
    return "Host=$hostName;Port=$port;Database=$db;Username=$user;Password=$pass;SSL Mode=Require;Trust Server Certificate=true;Timeout=30;Command Timeout=120;Pooling=false"
}

function Invoke-Sql([string]$sql, [string]$label) {
    $conn = New-Object Npgsql.NpgsqlConnection (Get-ConnectionString)
    try {
        $conn.Open()
        $cmd = $conn.CreateCommand()
        $cmd.CommandText = $sql
        $cmd.CommandTimeout = 120
        $reader = $cmd.ExecuteReader()
        $rows = 0
        do {
            if ($reader.FieldCount -gt 0) {
                $names = @()
                for ($i = 0; $i -lt $reader.FieldCount; $i++) { $names += $reader.GetName($i) }
                Write-Output ($names -join "`t")
                while ($reader.Read()) {
                    $values = @()
                    for ($i = 0; $i -lt $reader.FieldCount; $i++) {
                        $values += $(if ($reader.IsDBNull($i)) { '' } else { $reader.GetValue($i).ToString() })
                    }
                    Write-Output ($values -join "`t")
                    $rows++
                }
            }
        } while ($reader.NextResult())
        $reader.Close()
        Write-Output "OK: $label ($rows rows)"
    } finally {
        try {
            if ($conn.State -ne 'Closed') { $conn.Close() }
            $conn.Dispose()
        } catch {
            # Closing can fail if the driver never finished opening; the
            # original error above is the one worth reading.
        }
    }
}

Expand-Packages
Import-Npgsql

if ($Command) { Invoke-Sql -sql $Command -label 'command'; return }
if ($SqlFile) { Invoke-Sql -sql (Get-Content -Raw $SqlFile) -label (Split-Path -Leaf $SqlFile); return }
if ($All -or $Folder) {
    $dir = if ($Folder) { if ([IO.Path]::IsPathRooted($Folder)) { $Folder } else { Join-Path $root $Folder } } else { Join-Path $root 'supabase/migrations' }
    Get-ChildItem $dir -Filter *.sql | Sort-Object Name | ForEach-Object {
        Invoke-Sql -sql (Get-Content -Raw $_.FullName) -label $_.Name
    }
    return
}
Write-Output 'Nothing to do. Pass -Command, -SqlFile, or -All.'
