param(
  [string[]]$Names = @("chrome.exe", "headless_shell.exe", "chrome-headless-shell.exe")
)

# Total working set of all browser processes. The caller takes a before/after
# delta, which avoids needing the browser's PID (not exposed by patchright).
$all = Get-CimInstance Win32_Process | Where-Object { $Names -contains $_.Name }
$sum = ($all | Measure-Object WorkingSetSize -Sum).Sum
[math]::Round($sum / 1MB)
