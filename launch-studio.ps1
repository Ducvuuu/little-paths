$studioDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$frontend = Join-Path $studioDir "node_modules\.bin\vinext.cmd"

Start-Process -WindowStyle Hidden -FilePath "cmd.exe" -ArgumentList @("/c", "`"$frontend`" dev") -WorkingDirectory $studioDir
Start-Sleep -Seconds 4
Start-Process "http://localhost:3000/"
