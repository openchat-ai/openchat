# 清理所有 Bridge 相关进程（包括老格式）
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | 
  Where-Object { 
    $_.CommandLine -match '--fairy|--port=3800|--nesting|main.js.*openchat' -and 
    $_.CommandLine -notmatch 'npm|node_modules|vscode'
  } | 
  ForEach-Object { 
    Write-Host "Killing PID:" $_.ProcessId 
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }

Write-Host "Done"