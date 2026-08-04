; SPDX-License-Identifier: MPL-2.0
; ============================================================
; AgentSkin Installer — intelligent path decisions (D2)
; Ported from build/installer.nsh (electron-builder era).
; Installer-side only: the uninstaller never picks a path.
; ============================================================

!ifndef AGENTSKIN_PATH_NSH
!define AGENTSKIN_PATH_NSH

!include "config.nsh"
!include "log.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"

; ------------------------------------------------------------
; D2: AgentSkinTrimInstallDir
; Remove trailing backslashes from $INSTDIR.
; ------------------------------------------------------------
Function AgentSkinTrimInstallDir
  Push $0
  StrCpy $0 $INSTDIR
  ${Do}
    StrCpy $R0 $0 1 -1
    ${If} $R0 == "\"
      StrCpy $0 $0 -1
    ${Else}
      ${ExitDo}
    ${EndIf}
  ${Loop}
  StrCpy $INSTDIR $0
  Pop $0
FunctionEnd

; ------------------------------------------------------------
; D2: AgentSkinNormalizeInstallDir
; Ensure $INSTDIR ends with \AgentSkin. Handle short drive
; letters (C: -> C:\AgentSkin). Enforce max depth.
; ------------------------------------------------------------
Function AgentSkinNormalizeInstallDir
  Push $0
  Push $1

  Call AgentSkinTrimInstallDir

  ; Short drive letter: "C:" (len 2) or "C:\" (len 3) -> "C:\AgentSkin"
  StrLen $0 $INSTDIR
  ${If} $0 <= 3
    StrCpy $INSTDIR "$INSTDIR\${AS_DIR_NAME}"
    Goto as_norm_done
  ${EndIf}

  ; Already ends with \AgentSkin? (case-insensitive)
  StrLen $0 $INSTDIR
  IntOp $0 $0 - 10  ; len("\AgentSkin") = 10
  ${If} $0 < 0
    StrCpy $INSTDIR "$INSTDIR\${AS_DIR_NAME}"
    Goto as_norm_done
  ${EndIf}
  StrCpy $1 $INSTDIR "" $0
  StrCmp $1 "\${AS_DIR_NAME}" as_norm_done 0
  StrCpy $INSTDIR "$INSTDIR\${AS_DIR_NAME}"

as_norm_done:
  ; Max depth guard — count backslashes
  StrCpy $0 0
  StrCpy $1 0
  ${Do}
    StrCpy $R0 $INSTDIR 1 $0
    ${If} $R0 == ""
      ${ExitDo}
    ${EndIf}
    ${If} $R0 == "\"
      IntOp $1 $1 + 1
    ${EndIf}
    IntOp $0 $0 + 1
  ${Loop}
  ${If} $1 > ${AS_MAX_DEPTH}
    StrCpy $0 $INSTDIR 2  ; drive letter, e.g. "C:"
    StrCpy $INSTDIR "$0\${AS_DIR_NAME}"
    !insertmacro LogDetail "Path too deep, reset to: $INSTDIR"
  ${EndIf}

  Pop $1
  Pop $0
FunctionEnd

; ------------------------------------------------------------
; D2: AgentSkinHasPreferredDrive
; Push "1" if any D-Z drive exists, else "0".
; ------------------------------------------------------------
Function AgentSkinHasPreferredDrive
  Push $0
  Push $1
  Push $2

  StrCpy $1 "DEFGHIJKLMNOPQRSTUVWXYZ"
  StrCpy $0 0

as_pref_loop:
  StrCpy $2 $1 1 $0
  StrCmp $2 "" as_pref_no
  IfFileExists "$2:\" 0 as_pref_next
  Pop $2
  Pop $1
  Pop $0
  Push "1"
  Return

as_pref_next:
  IntOp $0 $0 + 1
  Goto as_pref_loop

as_pref_no:
  Pop $2
  Pop $1
  Pop $0
  Push "0"
  Return
FunctionEnd

; ------------------------------------------------------------
; D2: AgentSkinUseFirstAvailableInstallDir
; Scan D-Z drives for a preferred default. Only C: -> fallback
; to $LOCALAPPDATA\Programs\AgentSkin (NSIS default).
; ------------------------------------------------------------
Function AgentSkinUseFirstAvailableInstallDir
  Push $0
  Push $1
  Push $2

  StrCpy $2 "DEFGHIJKLMNOPQRSTUVWXYZ"
  StrCpy $1 0

as_scan_loop:
  StrCpy $0 $2 1 $1
  StrCmp $0 "" as_scan_fallback
  IfFileExists "$0:\" 0 as_scan_next
  IfFileExists "$0:\${AS_DIR_NAME}\*.*" 0 as_scan_found
  IfFileExists "$0:\${AS_DIR_NAME}\${AS_MARKER_FILE}" as_scan_found 0
as_scan_next:
  IntOp $1 $1 + 1
  Goto as_scan_loop

as_scan_found:
  StrCpy $INSTDIR "$0:\${AS_DIR_NAME}"
  !insertmacro LogDetail "Auto-selected install dir: $INSTDIR"
  Goto as_scan_end

as_scan_fallback:
  !insertmacro LogDetail "No D-Z drive found, keeping default: $INSTDIR"

as_scan_end:
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

; ------------------------------------------------------------
; D2: AgentSkinExistingInstallPathCanBeAdopted
; Input: $R8 candidate path (from registry). Verifies ownership
; via marker / AgentSkin.exe / resources\app.asar.
; Sets error flag when the path cannot be adopted.
; ------------------------------------------------------------
Function AgentSkinExistingInstallPathCanBeAdopted
  Push $0

  StrCmp $R8 "" as_adopt_fail

  StrLen $0 $R8
  IntOp $0 $0 - 10
  ${If} $0 >= 0
    StrCpy $0 $R8 "" $0
    StrCmp $0 "\${AS_DIR_NAME}" 0 as_adopt_nosuffix
    Goto as_adopt_checks
as_adopt_nosuffix:
    StrCpy $R8 "$R8\${AS_DIR_NAME}"
  ${EndIf}

as_adopt_checks:
  IfFileExists "$R8\${AS_MARKER_FILE}" as_adopt_ok
  IfFileExists "$R8\${AS_PRODUCT_EXE}" as_adopt_ok
  IfFileExists "$R8\resources\app.asar" as_adopt_ok
  Goto as_adopt_fail

as_adopt_ok:
  ClearErrors
  Goto as_adopt_end
as_adopt_fail:
  SetErrors
as_adopt_end:
  Pop $0
FunctionEnd

; ------------------------------------------------------------
; D2: AgentSkinDetectCommandLineDir
; Log /D=<path> if present (NSIS applies it to $INSTDIR itself;
; the /D switch is handled by the NSIS runtime before .onInit).
; ------------------------------------------------------------
Function AgentSkinDetectCommandLineDir
  Push $0
  Push $1
  Push $R0
  Push $R1

  ${GetParameters} $0
  StrCmp $0 "" as_cmdline_done

  StrCpy $1 0
as_cmdline_search:
  StrCpy $R0 $0 3 $1
  StrCmp $R0 "" as_cmdline_done
  StrCmp $R0 "/D=" as_cmdline_found
  StrCmp $R0 "/d=" as_cmdline_found
  IntOp $1 $1 + 1
  Goto as_cmdline_search

as_cmdline_found:
  IntOp $1 $1 + 3
  StrCpy $R0 $0 "" $1
  StrCpy $R1 $R0 1
  StrCmp $R1 '"' 0 as_cmdline_noquote
  StrCpy $R0 $R0 -1 1
as_cmdline_noquote:
  !insertmacro LogDetail "Command-line /D= detected: $R0"

as_cmdline_done:
  Pop $R1
  Pop $R0
  Pop $1
  Pop $0
FunctionEnd

!endif ; AGENTSKIN_PATH_NSH
