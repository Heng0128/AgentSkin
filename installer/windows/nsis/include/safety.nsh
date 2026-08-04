; SPDX-License-Identifier: MPL-2.0
; ============================================================
; AgentSkin Installer — install/uninstall protection (D1)
; Marker mechanism, directory ownership validation, legacy
; cleanup, and the uninstall-side mirror functions.
; ============================================================

!ifndef AGENTSKIN_SAFETY_NSH
!define AGENTSKIN_SAFETY_NSH

!include "config.nsh"
!include "log.nsh"
!include "path.nsh"
!include "LogicLib.nsh"

; ============================================================
; Installer-side functions
; (single-script layout: un.* functions coexist below; labels
; are globally unique across both contexts)
; ============================================================

; ------------------------------------------------------------
; D1/D4: AgentSkinValidateInstallDir
; Validate $INSTDIR is a dedicated \AgentSkin directory.
; On failure: Chinese MessageBox + error flag (caller decides
; whether to re-show the wizard or Quit in silent mode).
; ------------------------------------------------------------
Function AgentSkinValidateInstallDir
  Push $0
  Push $1

  ; Empty path check
  StrCmp $INSTDIR "" 0 as_val_notempty
  MessageBox MB_ICONSTOP|MB_OK "安装目录不能为空。请选择一个安装位置。"
  SetErrors
  Goto as_val_fail
as_val_notempty:

  ; Must end with \AgentSkin
  StrLen $0 $INSTDIR
  IntOp $0 $0 - 10
  ${If} $0 < 0
    MessageBox MB_ICONSTOP|MB_OK "安装目录必须是独立的 AgentSkin 文件夹。$\r$\n例如：D:\AgentSkin"
    SetErrors
    Goto as_val_fail
  ${EndIf}
  StrCpy $1 $INSTDIR "" $0
  StrCmp $1 "\${AS_DIR_NAME}" as_val_suffix_ok 0
  MessageBox MB_ICONSTOP|MB_OK "安装目录必须以 \AgentSkin 结尾。$\r$\n例如：D:\AgentSkin"
  SetErrors
  Goto as_val_fail
as_val_suffix_ok:

  ; C-drive protection: warn when D-Z drives exist, unless the
  ; target is already an AgentSkin install (upgrade in place).
  StrCpy $0 $INSTDIR 1 0
  StrCpy $1 $INSTDIR 1 1
  ${If} $1 == ":"
    ${If} $0 == "C"
    ${OrIf} $0 == "c"
      IfFileExists "$INSTDIR\${AS_MARKER_FILE}" as_val_cdrive_ok 0
      IfFileExists "$INSTDIR\${AS_PRODUCT_EXE}" as_val_cdrive_ok 0
      Call AgentSkinHasPreferredDrive
      Pop $1
      ${If} $1 == "1"
        MessageBox MB_ICONSTOP|MB_OK "检测到这台电脑还有 D-Z 盘，AgentSkin 建议不安装到 C 盘。$\r$\n请改选 D 盘或其它非 C 盘的 AgentSkin 文件夹。$\r$\n如果电脑只有 C 盘，安装器会自动放行 C:\AgentSkin。"
        SetErrors
        Goto as_val_fail
      ${EndIf}
    ${EndIf}
  ${EndIf}
as_val_cdrive_ok:

  ; Non-empty foreign directory check
  IfFileExists "$INSTDIR\*.*" 0 as_val_ok
  IfFileExists "$INSTDIR\${AS_MARKER_FILE}" as_val_ok 0
  IfFileExists "$INSTDIR\${AS_PRODUCT_EXE}" as_val_ok 0
  MessageBox MB_ICONSTOP|MB_OK "所选目录不为空，且不属于 AgentSkin。$\r$\n请选择一个空文件夹或已有的 AgentSkin 安装目录。"
  SetErrors
  Goto as_val_fail

as_val_ok:
  ClearErrors
  Goto as_val_end
as_val_fail:
  SetErrors
as_val_end:
  Pop $1
  Pop $0
FunctionEnd

; ------------------------------------------------------------
; D1: AgentSkinWriteMarker
; Write .agentskin-install-root after successful extraction.
; ------------------------------------------------------------
Function AgentSkinWriteMarker
  Push $0
  FileOpen $0 "$INSTDIR\${AS_MARKER_FILE}" w
  FileWrite $0 "appId=${AS_APP_ID}$\r$\n"
  FileWrite $0 "version=${VERSION}$\r$\n"
  FileWrite $0 "product=${AS_PRODUCT_NAME}$\r$\n"
  Push $R9
  !insertmacro TimeStamp
  FileWrite $0 "installedAt=$R9$\r$\n"
  Pop $R9
  FileClose $0
  Pop $0
  !insertmacro LogDetail "Marker written: $INSTDIR\${AS_MARKER_FILE}"
FunctionEnd

; ------------------------------------------------------------
; D1: AgentSkinDeleteLegacyUninstaller
; Remove old "Uninstall *.exe" files when no marker exists.
; ------------------------------------------------------------
Function AgentSkinDeleteLegacyUninstaller
  Push $0
  Push $1
  IfFileExists "$INSTDIR\${AS_MARKER_FILE}" as_legacy_done 0
  FindFirst $0 $1 "$INSTDIR\Uninstall *.exe"
  ${Do}
    StrCmp $1 "" as_legacy_nomore
    Delete "$INSTDIR\$1"
    !insertmacro LogDetail "Deleted legacy uninstaller: $1"
    FindNext $0 $1
  ${Loop}
as_legacy_nomore:
  FindClose $0
as_legacy_done:
  Pop $1
  Pop $0
FunctionEnd

; ------------------------------------------------------------
; D1: AgentSkinRemovePreviousInstall
; Input: $R8 = previous install dir (already adopted).
; Hard-clean: files + registry, so upgrade starts clean.
; ------------------------------------------------------------
Function AgentSkinRemovePreviousInstall
  Push $0
  !insertmacro AS_KILL_RUNNING_APP
  Sleep 500
  RMDir /r "$R8"
  DeleteRegKey HKCU "${AS_INSTALL_REG_KEY}"
  DeleteRegKey HKLM "${AS_INSTALL_REG_KEY}"
  DeleteRegKey HKCU "${AS_UNINSTALL_REG_KEY}"
  DeleteRegKey HKLM "${AS_UNINSTALL_REG_KEY}"
  DeleteRegKey HKCU "${AS_LEGACY_UNINSTALL_KEY}"
  DeleteRegKey HKLM "${AS_LEGACY_UNINSTALL_KEY}"
  !insertmacro LogDetail "Removed previous install at: $R8"
  Pop $0
FunctionEnd

; ============================================================
; Uninstaller-side functions (un.* namespace, D5.2.4)
; ============================================================

; ------------------------------------------------------------
; D1: un.AgentSkinInstallDirLooksOwned
; Marker file must exist and start with "appId=".
; ------------------------------------------------------------
Function un.AgentSkinInstallDirLooksOwned
  Push $0
  Push $R0
  Push $R1
  IfFileExists "$INSTDIR\${AS_MARKER_FILE}" 0 as_un_notowned
  FileOpen $0 "$INSTDIR\${AS_MARKER_FILE}" r
  FileRead $0 $R0
  FileClose $0
  StrCpy $R1 $R0 6
  StrCmp $R1 "appId=" 0 as_un_notowned
  ClearErrors
  Goto as_un_owned_end
as_un_notowned:
  SetErrors
as_un_owned_end:
  Pop $R1
  Pop $R0
  Pop $0
FunctionEnd

; ------------------------------------------------------------
; D1/D4: un.AgentSkinValidateUninstallDir
; Block uninstall from a directory we do not own.
; Silent installs (running uninstaller /S) still enforced.
; ------------------------------------------------------------
Function un.AgentSkinValidateUninstallDir
  Call un.AgentSkinInstallDirLooksOwned
  IfErrors 0 as_un_val_ok
  ${If} ${Silent}
    !insertmacro LogDetail "SILENT: uninstall dir validation FAILED, aborting"
    Quit
  ${EndIf}
  MessageBox MB_ICONSTOP|MB_OK "此目录不属于 AgentSkin，无法执行卸载。$\r$\n如需清理，请手动删除文件夹。"
  Quit
as_un_val_ok:
FunctionEnd

; ------------------------------------------------------------
; D1: un.AgentSkinRemoveMarker
; ------------------------------------------------------------
Function un.AgentSkinRemoveMarker
  Delete "$INSTDIR\${AS_MARKER_FILE}"
FunctionEnd

; ------------------------------------------------------------
; D5.6: un.AgentSkinRemoveInstalledFiles
; Explicit known-file deletion (safety net before RMDir /r).
; ------------------------------------------------------------
Function un.AgentSkinRemoveInstalledFiles
  Delete "$INSTDIR\${AS_PRODUCT_EXE}"
  Delete "$INSTDIR\chrome_100_percent.pak"
  Delete "$INSTDIR\chrome_200_percent.pak"
  Delete "$INSTDIR\resources.pak"
  Delete "$INSTDIR\icudtl.dat"
  Delete "$INSTDIR\v8_context_snapshot.bin"
  Delete "$INSTDIR\vk_swiftshader.dll"
  Delete "$INSTDIR\vulkan-1.dll"
  Delete "$INSTDIR\d3dcompiler_47.dll"
  Delete "$INSTDIR\libEGL.dll"
  Delete "$INSTDIR\libGLESv2.dll"
  Delete "$INSTDIR\ffmpeg.dll"
  Delete "$INSTDIR\LICENSE.electron.txt"
  Delete "$INSTDIR\LICENSES.chromium.html"
  RMDir /r "$INSTDIR\resources"
  RMDir /r "$INSTDIR\locales"
  RMDir /r "$INSTDIR\swiftshader"
  RMDir /r "$INSTDIR\crashpad"
  ; DuiLib plugin + skin staged next to the uninstaller
  RMDir /r "$INSTDIR\Uninstall\${AS_UI_SUBDIR}"
  Delete "$INSTDIR\${AS_MARKER_FILE}"
FunctionEnd

; ------------------------------------------------------------
; D5: un.AgentSkinCleanRegistry
; Symmetric cleanup of every key the installer writes.
; ------------------------------------------------------------
Function un.AgentSkinCleanRegistry
  DeleteRegKey HKCU "${AS_INSTALL_REG_KEY}"
  DeleteRegKey HKLM "${AS_INSTALL_REG_KEY}"
  DeleteRegKey HKCU "${AS_UNINSTALL_REG_KEY}"
  DeleteRegKey HKLM "${AS_UNINSTALL_REG_KEY}"
  DeleteRegKey HKCU "${AS_LEGACY_UNINSTALL_KEY}"
  DeleteRegKey HKLM "${AS_LEGACY_UNINSTALL_KEY}"
  ; File associations
  DeleteRegKey HKCU "Software\Classes\.agenttheme"
  DeleteRegKey HKCU "Software\Classes\.agentskin-theme"
  DeleteRegKey HKCU "Software\Classes\.codex-theme"
  DeleteRegKey HKCU "Software\Classes\AgentSkin.Theme"
FunctionEnd

; ------------------------------------------------------------
; un.AgentSkinScheduleSelfDelete
; The uninstaller exe is locked while running. Drop a tiny
; cleanup script into $TEMP that waits for our PID to exit,
; then deletes the exe and removes leftover dirs IF EMPTY.
; ------------------------------------------------------------
Function un.AgentSkinScheduleSelfDelete
  Push $0
  Push $1
  System::Call 'kernel32::GetCurrentProcessId() i .r0'
  ; Release the CWD hold on the install dir so it can be removed
  SetOutPath "$TEMP"
  FileOpen $1 "$TEMP\agentskin-uninstall-cleanup.cmd" w
  ; Write the cleanup .cmd line-by-line so we never nest quotes inside
  ; a FileWrite string literal (NSIS v3.12 still tokenizes " inside
  ; backtick strings).
  FileWrite $1 "@echo off$\r$\n"
  FileWrite $1 "powershell -NoProfile -WindowStyle Hidden -Command $\"while (Get-Process -Id "
  FileWrite $1 $0
  FileWrite $1 " -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 400 } ; Remove-Item -LiteralPath '"
  FileWrite $1 $EXEPATH
  FileWrite $1 "' -Force -ErrorAction SilentlyContinue ; Remove-Item -LiteralPath '"
  FileWrite $1 $EXEDIR
  FileWrite $1 "' -ErrorAction SilentlyContinue ; Remove-Item -LiteralPath '"
  FileWrite $1 $EXEDIR
  FileWrite $1 "\..' -ErrorAction SilentlyContinue$\"$\r$\n"
  FileClose $1
  Exec 'cmd.exe /C start "" /MIN "$TEMP\agentskin-uninstall-cleanup.cmd"'
  Pop $1
  Pop $0
FunctionEnd

!endif ; AGENTSKIN_SAFETY_NSH
