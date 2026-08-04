; SPDX-License-Identifier: MPL-2.0
; ============================================================
; AgentSkin Installer — logging macros (D5.5)
; Writes to %LOCALAPPDATA%\AgentSkin\installer.log so the log
; survives uninstall and is independent of the install path.
; ============================================================

!ifndef AGENTSKIN_LOG_NSH
!define AGENTSKIN_LOG_NSH

!include "config.nsh"

; --- Timestamp helper (result in $R9) ---
!macro TimeStamp
  ClearErrors
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  Push $6
  System::Alloc 16
  Pop $0
  System::Call 'kernel32::GetLocalTime(ir0)'
  System::Call '*$0(&i2 .r1, &i2 .r2, &i2 .r3, &i2 .r4, &i2 .r5, &i2 .r6, &i2 .r7, &i2 .r8)'
  System::Free $0
  StrCpy $R9 "$1-$2-$3 $4:$5:$6"
  Pop $6
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
!macroend

; --- Primary log entry ---
!macro LogMessage MSG
  ClearErrors
  CreateDirectory "${AS_LOG_DIR}"
  FileOpen $9 "${AS_LOG_FILE}" a
  FileSeek $9 0 END
  Push $R9
  !insertmacro TimeStamp
  FileWrite $9 "[AgentSkin] [$R9] ${MSG}$\r$\n"
  Pop $R9
  FileClose $9
!macroend

; --- Detail log entry (indented continuation line) ---
!macro LogDetail MSG
  ClearErrors
  CreateDirectory "${AS_LOG_DIR}"
  FileOpen $9 "${AS_LOG_FILE}" a
  FileSeek $9 0 END
  FileWrite $9 "    ${MSG}$\r$\n"
  FileClose $9
!macroend

!endif ; AGENTSKIN_LOG_NSH
