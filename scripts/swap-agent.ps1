$src = "C:\Users\Jakeb\sessionforge\agent\sessionforge-new.exe"
$dst = "C:\Users\Jakeb\AppData\Local\Programs\sessionforge\sessionforge.exe"
$bak = "C:\Users\Jakeb\AppData\Local\Programs\sessionforge\sessionforge.exe.bak"

sc.exe stop SessionForgeAgent
Start-Sleep 3
Copy-Item $dst $bak -Force
Copy-Item $src $dst -Force
sc.exe start SessionForgeAgent
Start-Sleep 3
sc.exe query SessionForgeAgent
