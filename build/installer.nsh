; Runs before files are copied. Must work for both outer/inner UAC and oneClick.
; Default electron-builder "app running" check breaks with spaces in INSTDIR and is
; skipped on the elevated UAC inner instance (where file copy actually happens).

!macro customCheckAppRunning
  DetailPrint "Preparing install folder..."

  nsExec::ExecToLog `taskkill /F /IM HotelShveycariyaCRM.exe /T`
  Pop $0
  nsExec::ExecToLog `taskkill /F /IM HotelShveycariyaCRM.exe /T`
  Pop $0

  ; Kill python only if its path looks like our bundled runtime
  nsExec::ExecToLog `powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process -EA SilentlyContinue | ? { $$_.Name -match '^python(w)?\.exe$$' -and $$_.ExecutablePath -match 'HotelShveycariya|hotel-shveycariya|Shveycariya' } | % { Stop-Process -Id $$_.ProcessId -Force -EA SilentlyContinue }"`
  Pop $0

  Sleep 1200

  ; Clear read-only flags that block CopyFiles
  ${if} "$INSTDIR" != ""
    nsExec::ExecToLog `cmd /C attrib -R /S /D "$INSTDIR\*.*" `
    Pop $0

    ; Move old install aside so CopyFiles writes into a fresh folder
    ${if} ${FileExists} "$INSTDIR"
      RMDir /r "$INSTDIR.__old"
      ClearErrors
      Rename "$INSTDIR" "$INSTDIR.__old"
      ${if} ${errors}
        ; Fallback: delete the heaviest locked targets in place
        Delete "$INSTDIR\HotelShveycariyaCRM.exe"
        RMDir /r "$INSTDIR\resources"
        RMDir /r "$INSTDIR\locales"
      ${endif}
      ; Best-effort cleanup of the renamed leftover (ignore failures)
      RMDir /r "$INSTDIR.__old"
    ${endif}
  ${endif}

  ; Legacy install path (productName with spaces from older builds)
  nsExec::ExecToLog `cmd /C if exist "%LOCALAPPDATA%\Programs\Hotel Shveycariya CRM" attrib -R /S /D "%LOCALAPPDATA%\Programs\Hotel Shveycariya CRM\*.*"`
  Pop $0
  RMDir /r "$LOCALAPPDATA\Programs\Hotel Shveycariya CRM"
  RMDir /r "$LOCALAPPDATA\Programs\Hotel Shveycariya CRM.__old"

  Sleep 500
!macroend

; Ensure the elevated (inner) installer also clears the folder — CHECK_APP_RUNNING
; is skipped for UAC inner instances when oneClick=false.
!macro customInit
  nsExec::ExecToLog `taskkill /F /IM HotelShveycariyaCRM.exe /T`
  Pop $0
!macroend
