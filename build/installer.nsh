; Auto-update / reinstall helpers for Windows NSIS.
;
; Do NOT run the previous Uninstall.exe when it is broken/locked — that surfaces
; "Не удалось закрыть … нажмите Повторить" in a loop (electron-builder retries
; uninstall 5 times, then shows appCannotBeClosed; Retry never resets cleanly).
; Instead: kill CRM + bundled Python, clear uninstall registry, remove INSTDIR,
; and let the new installer write a fresh tree.

!macro _KillCrmProcesses
  DetailPrint "Stopping HotelShveycariyaCRM processes..."

  nsExec::ExecToLog `taskkill /F /IM HotelShveycariyaCRM.exe /T`
  Pop $0
  Sleep 300
  nsExec::ExecToLog `taskkill /F /IM HotelShveycariyaCRM.exe /T`
  Pop $0
  ; Older builds / shortcut display name variants
  nsExec::ExecToLog `taskkill /F /IM "Hotel Shveycariya CRM.exe" /T`
  Pop $0

  ; Kill anything whose path or command line lives under our install folders
  ; (Electron + portable CPython/uvicorn holding file locks).
  nsExec::ExecToLog `powershell -NoProfile -ExecutionPolicy Bypass -Command "$$needles = @('HotelShveycariyaCRM','hotel-shveycariya-crm','Hotel Shveycariya CRM','Shveycariya'); Get-CimInstance Win32_Process -EA SilentlyContinue | ForEach-Object { $$p = $$_; $$blob = (($$p.ExecutablePath + ' ' + $$p.CommandLine) + ''); foreach ($$n in $$needles) { if ($$blob -like ('*' + $$n + '*')) { Stop-Process -Id $$p.ProcessId -Force -EA SilentlyContinue; break } } }" `
  Pop $0
!macroend

!macro _ClearUninstallRegistry
  ; Skip previous Uninstall.exe — it often fails while Python locks runtime files
  ; and electron-builder then shows the endless Retry dialog.
  DetailPrint "Clearing previous uninstall registry (will reinstall in place)..."
  DeleteRegKey HKCU "${UNINSTALL_REGISTRY_KEY}"
  DeleteRegKey HKLM "${UNINSTALL_REGISTRY_KEY}"
  !ifdef UNINSTALL_REGISTRY_KEY_2
    DeleteRegKey HKCU "${UNINSTALL_REGISTRY_KEY_2}"
    DeleteRegKey HKLM "${UNINSTALL_REGISTRY_KEY_2}"
  !endif
  DeleteRegKey HKCU "${INSTALL_REGISTRY_KEY}"
  DeleteRegKey HKLM "${INSTALL_REGISTRY_KEY}"
!macroend

!macro _ForceRemoveInstallDir
  ${if} "$INSTDIR" != ""
    nsExec::ExecToLog `cmd /C if exist "$INSTDIR" attrib -R /S /D "$INSTDIR\*.*"`
    Pop $0
    RMDir /r "$INSTDIR"
    ${if} ${FileExists} "$INSTDIR"
      Sleep 1000
      !insertmacro _KillCrmProcesses
      Sleep 800
      RMDir /r "$INSTDIR"
    ${endif}
    ${if} ${FileExists} "$INSTDIR"
      RMDir /r "$INSTDIR.__old"
      ClearErrors
      Rename "$INSTDIR" "$INSTDIR.__old"
      RMDir /r "$INSTDIR.__old"
    ${endif}
  ${endif}

  nsExec::ExecToLog `cmd /C if exist "%LOCALAPPDATA%\Programs\Hotel Shveycariya CRM" attrib -R /S /D "%LOCALAPPDATA%\Programs\Hotel Shveycariya CRM\*.*"`
  Pop $0
  RMDir /r "$LOCALAPPDATA\Programs\Hotel Shveycariya CRM"
  RMDir /r "$LOCALAPPDATA\Programs\Hotel Shveycariya CRM.__old"
!macroend

!macro customCheckAppRunning
  !insertmacro _KillCrmProcesses
  Sleep 1500
  !insertmacro _KillCrmProcesses
  Sleep 800

  !insertmacro _ClearUninstallRegistry
  !insertmacro _ForceRemoveInstallDir

  !insertmacro _KillCrmProcesses
  Sleep 500
!macroend

; Elevated inner instance (UAC) also needs the same cleanup.
!macro customInit
  !insertmacro _KillCrmProcesses
  !insertmacro _ClearUninstallRegistry
!macroend

; If something still invokes an uninstaller, never abort the update on its exit code.
!macro customUnInstallCheck
  ${if} $R0 != 0
    DetailPrint `Old uninstall exit code: $R0 — continuing with new files`
    StrCpy $R0 0
  ${endif}
!macroend

!macro customUnInstallCheckCurrentUser
  ${if} $R0 != 0
    DetailPrint `Old uninstall (HKCU) exit code: $R0 — continuing with new files`
    StrCpy $R0 0
  ${endif}
!macroend

!macro customRemoveFiles
  !insertmacro _KillCrmProcesses
  Sleep 1500
  !insertmacro _ForceRemoveInstallDir
!macroend
