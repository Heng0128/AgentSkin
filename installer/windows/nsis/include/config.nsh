; SPDX-License-Identifier: MPL-2.0
; ============================================================
; AgentSkin Installer — centralized configuration (D5)
; NSIS + DuiLib architecture. No MUI pages: the entire UI is
; hosted by AgentSkinUI.dll (DuiLib_Ultimate).
; Brand palette is synced from scripts/branding.config.mjs by
; installer/windows/scripts/generate-duilib-assets.mjs.
; ============================================================

!ifndef AGENTSKIN_CONFIG_NSH
!define AGENTSKIN_CONFIG_NSH

; ---- Product identity (VERSION / UNPACKED injected via makensis /D) ----
!ifndef VERSION
  !define VERSION "0.0.0-dev"
!endif
!ifndef UNPACKED
  !define UNPACKED "..\..\..\out\make\dist\win-unpacked"
!endif

!define AS_PRODUCT_NAME  "AgentSkin"
!define AS_PRODUCT_EXE   "AgentSkin.exe"
!define AS_APP_ID        "com.agentskin.desktop"
!define AS_PUBLISHER     "AgentSkin"
!define AS_SETUP_NAME    "AgentSkin-${VERSION}-x86-Setup.exe"

; ---- Registry layout ----
; New keys are human-readable (we own both ends). The legacy
; electron-builder key is kept for upgrade detection only.
!define AS_INSTALL_REG_KEY         "Software\AgentSkin"
!define AS_UNINSTALL_REG_KEY       "Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentSkin"
!define AS_LEGACY_UNINSTALL_KEY    "Software\Microsoft\Windows\CurrentVersion\Uninstall\${AS_APP_ID}"

; ---- Safety / path policy (D1/D2) ----
!define AS_DIR_NAME    "AgentSkin"
!define AS_MARKER_FILE ".agentskin-install-root"
!define AS_MAX_DEPTH   4

; ---- Process termination (D1) ----
; Kill AgentSkin's own processes WITHOUT recursing the process tree.
; AgentSkin spawns agent apps (TRAE/QoderWork/WorkBuddy/Doubao/Codex/ZCode)
; as children via child_process with --remote-debugging-port=0. On Windows a
; detached spawn still leaves the child's ParentProcessId pointing at
; AgentSkin, so `taskkill /F /IM AgentSkin.exe /T` — the /T recurses into the
; tree — kills every agent AgentSkin launched for theming, even agents the
; user is actively working in. That is a destructive surprise for the user.
;
; We kill by process name via PowerShell Stop-Process instead: it targets the
; named processes only and does NOT recurse into child processes. electron-
; builder names every AgentSkin process (main + renderer/GPU helpers)
; "AgentSkin.exe", so Get-Process -Name picks up the whole app while no agent
; (different image name) is ever touched.
!macro AS_KILL_RUNNING_APP
  nsExec::Exec 'powershell -NoProfile -Command "Get-Process -Name ${AS_PRODUCT_NAME} -ErrorAction SilentlyContinue | Stop-Process -Force"'
  Pop $0
!macroend

; ---- Logging (outside install dir, survives uninstall) ----
!define AS_LOG_DIR  "$LOCALAPPDATA\AgentSkin"
!define AS_LOG_FILE "${AS_LOG_DIR}\installer.log"

; ---- Brand palette (NSIS-side fallbacks; the DuiLib skin owns
; ---- the authoritative ARGB values, generated from the same source) ----
!define AS_ACCENT_HEX     "6B8FD8"
!define AS_PRIMARY_HEX    "5B3FA0"
!define AS_SURFACE_HEX    "F5F5F7"
!define AS_TEXT_HEX       "1D1D1F"
!define AS_TEXT_LIGHT_HEX "6E6E73"

; ---- DuiLib plugin / skin layout ----
!define AS_PLUGIN_DLL   "AgentSkinUI.dll"
!define AS_SKIN_DIRNAME "skin"
; Runtime subdir (inside $PLUGINSDIR for install, $INSTDIR\Uninstall for uninstall)
!define AS_UI_SUBDIR    "ui"

; ---- userData (Electron %APPDATA%\AgentSkin) — only removed when the
; ---- user explicitly ticks "remove my data" on the uninstall page ----
!define AS_USERDATA_DIR "$APPDATA\AgentSkin"

!endif ; AGENTSKIN_CONFIG_NSH
