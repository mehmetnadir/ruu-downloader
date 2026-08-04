# Ruu Helper kurulumu — Windows.
# Sistem geneline hiçbir şey yazmaz; yalnızca kullanıcı profilindeki registry
# anahtarını ve kullanıcı dizinindeki ikiliyi oluşturur.
param([string]$ExtId = $env:RUU_EXT_ID, [switch]$Uninstall)

$HostName = "com.ruu.downloader.helper"
$BinDir   = "$env:LOCALAPPDATA\RuuDownloader"
$Bin      = "$BinDir\ruu-helper.exe"
$RegKey   = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName"

if ($Uninstall) {
  Remove-Item -Force -ErrorAction SilentlyContinue $Bin, "$BinDir\$HostName.json"
  Remove-Item -Force -Recurse -ErrorAction SilentlyContinue $RegKey
  Write-Host "kaldırıldı. Başka hiçbir iz bırakılmamıştı."
  exit 0
}
if (-not $ExtId) { throw "RUU_EXT_ID gerekli — chrome://extensions sayfasındaki kimlik" }
if (-not (Get-Command go -ErrorAction SilentlyContinue)) { throw "go bulunamadı — https://go.dev/dl" }

New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
Push-Location $PSScriptRoot
$env:CGO_ENABLED = "0"
go build -trimpath -ldflags "-s -w -buildid=" -o $Bin .
Pop-Location

@{
  name = $HostName; description = "Ruu Downloader helper"; path = $Bin
  type = "stdio"; allowed_origins = @("chrome-extension://$ExtId/")
} | ConvertTo-Json | Set-Content "$BinDir\$HostName.json" -Encoding utf8

New-Item -Path $RegKey -Force | Out-Null
Set-ItemProperty -Path $RegKey -Name "(Default)" -Value "$BinDir\$HostName.json"

Write-Host "kuruldu."
Write-Host "  ikili   : $Bin"
Write-Host "  sağlama : $((Get-FileHash $Bin -Algorithm SHA256).Hash)"
Write-Host "  erişim  : yalnızca chrome-extension://$ExtId"
