$weights = @{A=3;B=2;C=2;D=3;E=1;F=2;G=1;H=2;I=1;J=2;K=2;L=1;M=1;N=1}
$total = 0
foreach ($k in $weights.Keys) { $total += $weights[$k] }
$r = Get-Random -Minimum 0 -Maximum $total
$acc = 0
foreach ($k in $weights.Keys) {
  $acc += $weights[$k]
  if ($r -lt $acc) { Write-Output $k; break }
}
