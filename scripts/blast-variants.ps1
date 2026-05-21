$target = "F:\openchat\tmp\variants"
$empty  = "F:\openchat\tmp\__empty__"

# Prep empty dir for robocopy
if (Test-Path $empty) {
    [System.IO.Directory]::Delete($empty, $true)
}
$null = New-Item -ItemType Directory -Path $empty -Force

Write-Host "[1/4] .NET Directory.Delete (fastest)" -ForegroundColor Cyan
try {
    [System.IO.Directory]::Delete($target, $true)
    Write-Host "  OK - Directory deleted" -ForegroundColor Green
    $null = New-Item -ItemType Directory -Path $target -Force
    Write-Host "DONE" -ForegroundColor Green
    Remove-Item -Path $empty -Recurse -Force -ErrorAction SilentlyContinue
    exit 0
} catch {
    Write-Host "  FAIL: $($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host "  -> fallback to rmdir" -ForegroundColor Gray
}

Write-Host "[2/4] cmd rmdir /s /q" -ForegroundColor Cyan
try {
    & cmd /c "rmdir /s /q ""$target"" 2>nul"
    if (-not (Test-Path $target)) {
        Write-Host "  OK - rmdir succeeded" -ForegroundColor Green
        $null = New-Item -ItemType Directory -Path $target -Force
        Write-Host "DONE" -ForegroundColor Green
        Remove-Item -Path $empty -Recurse -Force -ErrorAction SilentlyContinue
        exit 0
    }
} catch {
    Write-Host "  FAIL: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host "[3/4] robocopy /mir (empty mirror)" -ForegroundColor Cyan
try {
    & robocopy $empty $target /mir /r:0 /w:0 /np /njh /njs 2>$null
    try { [System.IO.Directory]::Delete($target, $true) } catch {}
    if (-not (Test-Path $target)) {
        Write-Host "  OK - robocopy succeeded" -ForegroundColor Green
        $null = New-Item -ItemType Directory -Path $target -Force
        Write-Host "DONE" -ForegroundColor Green
        Remove-Item -Path $empty -Recurse -Force -ErrorAction SilentlyContinue
        exit 0
    }
} catch {
    Write-Host "  FAIL: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host "[4/4] .NET parallel + \\?\ long path (last resort)" -ForegroundColor Cyan
try {
    $longPath = "\\?\$target"
    if ([System.IO.Directory]::Exists($longPath)) {
        $batchSize = 10000
        $sw = [System.Diagnostics.Stopwatch]::StartNew()
        $total = 0
        do {
            $files = [System.IO.Directory]::EnumerateFiles($longPath, "*", [System.IO.SearchOption]::TopDirectoryOnly) |
                     Select-Object -First $batchSize
            $count = 0
            foreach ($f in $files) {
                try { [System.IO.File]::Delete($f); $count++ } catch {}
            }
            $total += $count
            if ($sw.Elapsed.TotalSeconds -ge 1) {
                Write-Host "  deleted $total files..." -ForegroundColor Gray
                $sw.Restart()
            }
        } while ($count -eq $batchSize)

        $dirs = [System.IO.Directory]::EnumerateDirectories($longPath, "*", [System.IO.SearchOption]::TopDirectoryOnly)
        foreach ($d in $dirs) {
            try { [System.IO.Directory]::Delete($d, $true) } catch {}
        }
        try { [System.IO.Directory]::Delete($longPath) } catch {}
    }
    if (-not (Test-Path $target)) {
        Write-Host "  OK - parallel delete succeeded" -ForegroundColor Green
        $null = New-Item -ItemType Directory -Path $target -Force
        Write-Host "DONE" -ForegroundColor Green
        Remove-Item -Path $empty -Recurse -Force -ErrorAction SilentlyContinue
        exit 0
    }
} catch {
    Write-Host "  ALL FAILED: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Manual fallback (run as admin):" -ForegroundColor Yellow
    Write-Host '  cmd /c "rmdir /s /q F:\openchat\tmp\variants"' -ForegroundColor White
    Remove-Item -Path $empty -Recurse -Force -ErrorAction SilentlyContinue
    exit 1
}

Remove-Item -Path $empty -Recurse -Force -ErrorAction SilentlyContinue
