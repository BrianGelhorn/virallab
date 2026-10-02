# Arranca ViralLab al encender la PC (Startup folder -> al iniciar sesion).
# Usa rutas absolutas: en logon temprano el PATH puede estar incompleto.
$root = "C:\dev\virallab"
$node = "C:\Program Files\nodejs\node.exe"
$ff = "C:\Users\brian\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0.2-full_build\bin"
$env:PATH = "$ff;$env:PATH"

$logdir = Join-Path $root "logs"
New-Item -ItemType Directory -Force -Path $logdir | Out-Null
$log = Join-Path $logdir ("start-{0}.log" -f (Get-Date -Format "yyyy-MM-dd"))
Add-Content $log ("[{0}] start" -f (Get-Date -Format "HH:mm:ss"))

Set-Location $root
# server siempre (dashboard en http://localhost:3100)
Start-Process -FilePath $node -ArgumentList "server.mjs" -WorkingDirectory $root -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $logdir "server-out.log") `
  -RedirectStandardError (Join-Path $logdir "server-err.log")
Add-Content $log "server lanzado"

# n8n solo si existe (npm i -g n8n una vez)
$n8n = Get-Command n8n -ErrorAction SilentlyContinue
if ($n8n) {
  Start-Process -FilePath $n8n.Source -ArgumentList "start" -WorkingDirectory $root -WindowStyle Hidden
  Add-Content $log "n8n lanzado"
} else {
  Add-Content $log "n8n no instalado: npm i -g n8n (los jobs igual corren con node jobs/*.mjs)"
}
