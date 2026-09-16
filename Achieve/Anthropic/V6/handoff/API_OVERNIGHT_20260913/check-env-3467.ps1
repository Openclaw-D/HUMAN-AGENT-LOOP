$p = [System.Diagnostics.Process]::GetProcessById(21536)
$envs = $p.StartInfo.EnvironmentVariables
if ($null -eq $envs -or $envs.Count -eq 0) { Write-Output 'ENV_UNAVAILABLE'; exit 0 }
foreach ($k in @('JIANWEI_MODEL_API_KEY','JIANWEI_MODEL_BASE_URL','JIANWEI_MODEL_NAME','JIANWEI_MODEL_MODE','V5_PREVIEW_DATA_DIR')) {
  $v = $envs[$k]
  if ($null -eq $v) { Write-Output ($k + '=MISSING') }
  elseif ($k -eq 'JIANWEI_MODEL_API_KEY') { Write-Output ($k + '=SET(len=' + $v.Length + ')') }
  else { Write-Output ($k + '=' + $v) }
}
