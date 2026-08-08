# Ruu Helper kurulumu — Windows.
#
# Kullanım (eklentinin ayarlar sayfası bu satırı kimliğinle birlikte verir):
#   $env:RUU_EXT_ID='<EKLENTI_ID>'; iwr -useb https://raw.githubusercontent.com/mehmetnadir/ruu-downloader/main/helper/install.ps1 | iex
#
# Ne yapar: hazır ikiliyi indirir, SHA-256'sını doğrular, kullanıcı profiline
# koyar ve Chrome'un native-messaging kaydını yazar.
# Ne YAPMAZ: yönetici hakkı istemez, sistem geneline yazmaz, servis kaydetmez,
# otomatik güncelleme kurmaz, hiçbir yere veri göndermez.
#
# Kaldırmak için: & "$env:LOCALAPPDATA\RuuDownloader\uninstall.ps1"
param([string]$ExtId = $env:RUU_EXT_ID)
$ErrorActionPreference = 'Stop'

if (-not $ExtId) {
  Write-Host "Eklenti kimliği gerekli. Ruu ayarlarındaki komutu kopyala — kimliğin içinde hazır."
  exit 1
}
if ($ExtId -notmatch '^[a-p]{32}$') {
  Write-Host "Bu bir Chrome eklenti kimliğine benzemiyor: $ExtId"
  exit 1
}

$Repo     = 'mehmetnadir/ruu-downloader'
$HostName = 'com.ruu.downloader.helper'
$BinDir   = "$env:LOCALAPPDATA\RuuDownloader"
$Bin      = "$BinDir\ruu-helper.exe"
$RegKey   = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName"
$Asset    = 'ruu-helper-windows-amd64.exe'
$Base     = "https://github.com/$Repo/releases/latest/download"

New-Item -ItemType Directory -Force -Path $BinDir | Out-Null

# Depo yanındaysa ve Go varsa kaynaktan derle (en doğrulanabilir yol);
# değilse hazır ikiliyi indir ve sağlamasını DOĞRULA.
$srcMain = Join-Path $PSScriptRoot 'main.go'
if ((Test-Path $srcMain) -and (Get-Command go -ErrorAction SilentlyContinue)) {
  Write-Host '-> kaynaktan derleniyor'
  Push-Location $PSScriptRoot
  $env:CGO_ENABLED = '0'; $env:GOTELEMETRY = 'off'
  go build -trimpath -ldflags '-s -w -buildid=' -o $Bin .
  Pop-Location
} else {
  Write-Host "-> hazir ikili indiriliyor (windows/amd64)"
  $tmp = Join-Path $env:TEMP $Asset
  Invoke-WebRequest -UseBasicParsing "$Base/$Asset" -OutFile $tmp
  Invoke-WebRequest -UseBasicParsing "$Base/CHECKSUMS.txt" -OutFile "$env:TEMP\ruu-checksums.txt"

  Write-Host '-> saglama dogrulaniyor'
  $wantLine = Get-Content "$env:TEMP\ruu-checksums.txt" | Where-Object { $_ -match [regex]::Escape($Asset) }
  $want = ($wantLine -split '\s+')[0]
  $got = (Get-FileHash $tmp -Algorithm SHA256).Hash.ToLower()
  if (-not $want -or $want.ToLower() -ne $got) {
    Write-Host 'SAGLAMA UYUSMADI - kurulum durduruldu.'
    Write-Host "  beklenen: $want"
    Write-Host "  gelen   : $got"
    exit 1
  }
  Move-Item -Force $tmp $Bin
}

@{
  name = $HostName; description = 'Ruu Downloader helper'; path = $Bin
  type = 'stdio'; allowed_origins = @("chrome-extension://$ExtId/")
} | ConvertTo-Json | Set-Content "$BinDir\$HostName.json" -Encoding utf8

New-Item -Path $RegKey -Force | Out-Null
Set-ItemProperty -Path $RegKey -Name '(Default)' -Value "$BinDir\$HostName.json"

# Kaldırma tek komut olsun — geri dönüşü zor kurulum güven kırar.
@"
Remove-Item -Force -ErrorAction SilentlyContinue '$Bin', '$BinDir\$HostName.json'
Remove-Item -Force -Recurse -ErrorAction SilentlyContinue '$RegKey'
Remove-Item -Force -ErrorAction SilentlyContinue '$BinDir\uninstall.ps1'
Write-Host 'Ruu Helper kaldirildi. Baska hicbir iz birakilmamisti.'
"@ | Set-Content "$BinDir\uninstall.ps1" -Encoding utf8

Write-Host ''
Write-Host 'Kuruldu.'
Write-Host "  ikili    : $Bin"
Write-Host "  erisim   : yalnizca chrome-extension://$ExtId"
Write-Host "  kaldirma : & `"$BinDir\uninstall.ps1`""
Write-Host ''
Write-Host "Simdi Chrome'da Ruu ayarlar sayfasinda 'Yeniden dene' dugmesine bas."
