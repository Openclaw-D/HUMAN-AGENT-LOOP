Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32Focus {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@
$p = Get-Process -Name ZCode | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($p -eq $null) { Write-Output "NO_ZCODE_WINDOW"; exit 1 }
[Win32Focus]::ShowWindow($p.MainWindowHandle, 9) | Out-Null
[Win32Focus]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
Write-Output "FOCUSED $($p.MainWindowHandle)"
