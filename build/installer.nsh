; Auto-update / reinstall helpers for Windows NSIS.
;
; Critical: NEVER kill processes by a broad "Shveycariya" needle — that also
; matches Hotel-Shveycariya-CRM-Setup-*.exe and the installer suicides mid-run
; (app closes, nothing installs, update dialog loops forever).

!macro _KillCrmProcesses
  DetailPrint "Stopping CRM app + bundled Python..."

  ; App executable only (not the Setup installer)
  nsExec::ExecToLog `taskkill /F /IM HotelShveycariyaCRM.exe /T`
  Pop $0
  Sleep 300
  nsExec::ExecToLog `taskkill /F /IM HotelShveycariyaCRM.exe /T`
  Pop $0

  ; Portable CPython under the installed app tree only
  nsExec::ExecToLog `powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process -EA SilentlyContinue | ForEach-Object { $$p = $$_; $$name = $$p.Name; $$path = '' + $$p.ExecutablePath; $$cmd = '' + $$p.CommandLine; if ($$name -eq 'HotelShveycariyaCRM.exe') { Stop-Process -Id $$p.ProcessId -Force -EA SilentlyContinue } elseif ($$name -match '^python(w)?\.exe$$' -and ($$path -match '\\HotelShveycariyaCRM\\' -or $$cmd -match 'HotelShveycariyaCRM')) { Stop-Process -Id $$p.ProcessId -Force -EA SilentlyContinue } }" `
  Pop $0
!macroend

!macro _ClearUninstallRegistry
  ; Skip previous Uninstall.exe — it often fails while files are locked and
  ; electron-builder then shows the endless "close app / Retry" dialog.
  DetailPrint "Clearing previous uninstall registry (reinstall in place)..."
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
  Sleep 1200
  !insertmacro _KillCrmProcesses
  Sleep 600

  !insertmacro _ClearUninstallRegistry
  !insertmacro _ForceRemoveInstallDir

  !insertmacro _KillCrmProcesses
  Sleep 400
!macroend

!macro customInit
  !insertmacro _KillCrmProcesses
  !insertmacro _ClearUninstallRegistry
!macroend

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
  Sleep 1200
  !insertmacro _ForceRemoveInstallDir
!macroend
