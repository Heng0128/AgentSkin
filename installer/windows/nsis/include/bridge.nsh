; SPDX-License-Identifier: MPL-2.0
; ============================================================
; AgentSkin Installer — NSIS <-> DuiLib plugin bridge (D5)
; Thin wrappers around AgentSkinUI.dll exports. The plugin
; hosts the full wizard UI on its own thread; NSIS only sends
; progress updates and reads back user decisions.
;
; Plugin export contract (see plugin/src/Exports.cpp — packed
; response format, no user variables mutated):
;
;   Init        (skinDir, mode)          -> "ok" | "error:<msg>"
;   ShowWizard  (defaultDir)             -> "install|<dir>|<desktop>|<startmenu>"
;                                         | "cancel" | "error:<msg>"
;   SetProgress (pct, text)              -> "ok"      (non-blocking)
;   ShowFinish  (mode)                   -> "run" | "close" | "error:<msg>"
;   ShowUninstall(defaultDir)            -> "uninstall|<removeUserData>"
;                                         | "cancel" | "error:<msg>"
;   Shutdown    ()                       -> "ok"
; ============================================================

!ifndef AGENTSKIN_BRIDGE_NSH
!define AGENTSKIN_BRIDGE_NSH

!include "config.nsh"
!include "LogicLib.nsh"

; --- One-time init. SKINDIR = absolute skin folder path ---
!macro ASBridgeInit SKINDIR MODE
  AgentSkinUI::Init "${SKINDIR}" "${MODE}"
  Pop $R9
  ${If} $R9 != "ok"
    ; Plugin pushes "error:<msg>" on failure — strip the prefix.
    StrCpy $R8 $R9 6       ; first 6 chars of $R9
    ${If} $R8 == "error:"
      StrCpy $R9 $R9 "" 6  ; strip first 6 chars
    ${EndIf}
    MessageBox MB_ICONSTOP|MB_OK "安装器界面初始化失败：$R9"
    Quit
  ${EndIf}
!macroend

; --- Progress update (never blocks the install flow) ---
!macro ASProgress PCT TEXT
  AgentSkinUI::SetProgress "${PCT}" "${TEXT}"
  Pop $R9
!macroend

; --- Packed-result parsers ----------------------------------
; Exports now push a single packed response; NSIS splits on '|'.
;
; WordFunc.nsh (WordFind/WordFindS/WordFind2X) is broken in this
; NSIS 3.12 build: its !define expansions use '' inside backticks,
; which produces a literal single-quote that breaks the
; CallArtificialFunction rewrite rule. We therefore hand-roll the
; '|' split using StrLen + StrCpy + a character loop.
;
;   "install|<dir>|<desktop>|<startmenu>"
;    1       2     3         4
;   "uninstall|<removeUserData>"
;    1          2
;
; All parsers clobber $R7/$R8/$R9 internally.

; Find 0-based index of first "|" in $R0. Clobbers $R7/$R8, result in $R9.
; If not found, $R9 = -1.
!macro ASFindPipe
  StrLen $R8 $R0
  StrCpy $R9 0
  ${DoUntil} $R8 = 0
    StrCpy $R7 $R0 1 $R9
    ${If} $R7 == `|`
      ${ExitDo}
    ${EndIf}
    IntOp $R9 $R9 + 1
    IntOp $R8 $R8 - 1
  ${Loop}
  ${If} $R8 = 0
    StrCpy $R9 -1
  ${EndIf}
!macroend

; Split a ShowWizard accepted result into $R1=dir $R2=desktop $R3=startmenu.
; Pre: $R0 = packed response with leading "install" prefix already validated
;      (caller compared first 7 chars).
!macro ASBridgeSplitWizardResult
  ; Strip "install|" (8 chars) -> $R0 = "<dir>|<desktop>|<startmenu>"
  StrCpy $R0 $R0 "" 8
  ; Extract <dir>: chars [0, first|)
  !insertmacro ASFindPipe
  StrCpy $R1 $R0 $R9       ; $R1 = <dir>
  IntOp $R9 $R9 + 1        ; skip the |
  StrCpy $R0 $R0 "" $R9    ; $R0 = "<desktop>|<startmenu>"
  ; Extract <desktop>
  !insertmacro ASFindPipe
  StrCpy $R2 $R0 $R9
  IntOp $R9 $R9 + 1
  StrCpy $R0 $R0 "" $R9    ; $R0 = "<startmenu>"
  ; Remainder is <startmenu>
  StrCpy $R3 $R0
!macroend

; Split a ShowUninstall accepted result into $R1=removeUserData.
; Pre: $R0 starts with "uninstall" (caller stripped/checked).
!macro ASBridgeSplitUninstallResult
  ; Strip "uninstall|" (10 chars) -> $R0 = "<removeUserData>"
  StrCpy $R0 $R0 "" 10
  StrCpy $R1 $R0
!macroend

!endif ; AGENTSKIN_BRIDGE_NSH
