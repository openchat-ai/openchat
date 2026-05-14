Get-CimInstance Win32_Process -Filter "Name='node.exe'" | 
  Where-Object { $_.CommandLine -match 'main.js' } | 
  Format-Table ProcessId, CommandLine -AutoSize