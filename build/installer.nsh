; Replace broken default "is app running?" check.
; electron-builder's PowerShell StartsWith($INSTDIR) breaks when the install
; path contains spaces ("Hotel Shveycariya CRM") and can falsely report CRM as
; running even after reboot with nothing open.

!macro customCheckAppRunning
  DetailPrint "Closing Hotel Shveycariya CRM processes (if any)..."

  ; Electron main process (win.executableName)
  nsExec::ExecToLog `taskkill /F /IM HotelShveycariyaCRM.exe /T`
  Pop $0

  ; Backend python only if it was started from this app's folder
  nsExec::ExecToLog `powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $$_.Name -match '^(python|pythonw)\\.exe$$' -and $$_.ExecutablePath -and ($$_.ExecutablePath -match 'Hotel.?Shveycariya|hotel-shveycariya-crm|HotelShveycariyaCRM') } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"`
  Pop $0

  Sleep 1000
!macroend
