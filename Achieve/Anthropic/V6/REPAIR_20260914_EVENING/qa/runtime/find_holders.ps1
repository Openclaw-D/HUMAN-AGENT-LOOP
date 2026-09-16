# 查找命令行含 qa/runtime 的 node 进程（D路隔离实例残留）
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'REPAIR_20260914_EVENING' } | ForEach-Object {
  "{0} :: {1}" -f $_.ProcessId, $_.CommandLine.Substring(0, [Math]::Min(160, $_.CommandLine.Length))
}
