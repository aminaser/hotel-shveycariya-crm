; Auto-update / reinstall helpers for Windows NSIS.
; Critical: do NOT rename or delete $INSTDIR here before electron-builder runs
; uninstallOldVersion — that leaves UninstallString pointing at a missing path
; and surfaces: "Не удалось удалить старые файлы приложения … : 2"

!macro _KillCrmProcesses
  DetailPrint "Stopping HotelShveycariyaCRM processes..."

  nsExec::ExecToLog `taskkill /F /IM HotelShveycariyaCRM.exe /T`
  Pop $0
  Sleep 400
  nsExec::ExecToLog `taskkill /F /IM HotelShveycariyaCRM.exe /T`
  Pop $0

  ; Kill bundled Python/uvicorn holding locks under resources\backend\runtime
  nsExec::ExecToLog `powershell -NoProfile -ExecutionPolicy Bypass -Command "$$paths = @('HotelShveycariyaCRM','hotel-shveycariya-crm','Shveycariya'); Get-CimInstance Win32_Process -EA SilentlyContinue | ForEach-Object { $$p = $$_; $$hit = $$false; if ($$p.ExecutablePath) { foreach ($$x in $$paths) { if ($$p.ExecutablePath -like ('*' + $$x + '*')) { $$hit = $$true } } }; if (-not $$hit -and $$p.CommandLine) { foreach ($$x in $$paths) { if ($$p.CommandLine -like ('*' + $$x + '*')) { $$hit = $$true } } }; if ($$hit -and $$p.Name -match '^(python(w)?|HotelShveycariyaCRM)\.exe$$') { Stop-Process -Id $$p.ProcessId -Force -EA SilentlyContinue } }" `
  Pop $0
!macroend

!macro customCheckAppRunning
  !insertmacro _KillCrmProcesses
  Sleep 1500

  ; Clear read-only flags only — leave the folder in place for the old uninstaller
  ${if} "$INSTDIR" != ""
    nsExec::ExecToLog `cmd /C if exist "$INSTDIR" attrib -R /S /D "$INSTDIR\*.*"`
    Pop $0
  ${endif}

  ; Legacy install path (productName with spaces from older builds)
  nsExec::ExecToLog `cmd /C if exist "%LOCALAPPDATA%\Programs\Hotel Shveycariya CRM" attrib -R /S /D "%LOCALAPPDATA%\Programs\Hotel Shveycariya CRM\*.*"`
  Pop $0
  !insertmacro _KillCrmProcesses
  Sleep 500
!macroend

; Elevated inner instance also needs process kill (oneClick path).
!macro customInit
  !insertmacro _KillCrmProcesses
!macroend

; If the previous uninstaller still returns non-zero (busy file, partial tree),
; continue with the new install instead of aborting the whole update.
!macro customUnInstallCheck
  ${if} $R0 != 0
    DetailPrint `Old uninstall exit code: $R0 — continuing with new files`
  ${endif}
!macroend

!macro customUnInstallCheckCurrentUser
  ${if} $R0 != 0
    DetailPrint `Old uninstall (HKCU) exit code: $R0 — continuing with new files`
  ${endif}
!macroend

; More reliable than atomic rename for this app: large portable CPython tree
; often leaves file locks briefly after Electron exits.
!macro customRemoveFiles
  !insertmacro _KillCrmProcesses
  Sleep 2000

  ${if} "$INSTDIR" != ""
    nsExec::ExecToLog `cmd /C if exist "$INSTDIR" attrib -R /S /D "$INSTDIR\*.*"`
    Pop $0

    RMDir /r "$INSTDIR"
    ${if} ${FileExists} "$INSTDIR"
      DetailPrint "Retry remove install dir..."
      Sleep 1500
      !insertmacro _KillCrmProcesses
      Sleep 1000
      RMDir /r "$INSTDIR"
    ${endif}

    ; Last resort: move aside so the new installer can recreate INSTDIR
    ${if} ${FileExists} "$INSTDIR"
      RMDir /r "$INSTDIR.__old"
      ClearErrors
      Rename "$INSTDIR" "$INSTDIR.__old"
      RMDir /r "$INSTDIR.__old"
    ${endif}
  ${endif}

  RMDir /r "$LOCALAPPDATA\Programs\Hotel Shveycariya CRM"
  RMDir /r "$LOCALAPPDATA\Programs\Hotel Shveycariya CRM.__old"
!macroend
