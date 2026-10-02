# Arranca ViralLab al encender la PC (Programador de tareas -> al iniciar sesion).
# 1) server del dashboard + webhook Telegram. 2) n8n (si esta instalado).
$root = "C:\dev\virallab"
$ff = "C:\Users\brian\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0.2-full_build\bin"
$env:PATH = "$ff;$env:PATH"

Set-Location $root
# server siempre (dashboard en http://localhost:3100)
Start-Process -FilePath "node" -ArgumentList "server.mjs" -WorkingDirectory $root -WindowStyle Hidden

# n8n solo si existe (npm i -g n8n una vez)
if (Get-Command n8n -ErrorAction SilentlyContinue) {
  Start-Process -FilePath "n8n" -ArgumentList "start" -WorkingDirectory $root -WindowStyle Hidden
} else {
  Write-Output "n8n no instalado: npm i -g n8n (los jobs igual corren con node jobs/*.mjs)"
}
