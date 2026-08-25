; AgentSkin NSIS installer customizations
; This file is included by electron-builder's built-in NSIS template.
; Reference: https://www.electron.build/configuration/nsis#custom-nsis-script
;
; Available electron-builder NSIS macros:
;   !macro customHeader          - Inserted at the top of the install section
;   !macro customInstall         - Installed after electron app files
;   !macro customUnInstall       - Called during uninstall
;   !macro customRemoveFiles     - Before file removal (can abort)
;   !macro customInstallMode     - Change to current|all install modes
;
; Use macros below to customize installer behavior. For example:
;
; !macro customInstall
;   ; Grant standard users write access to the install directory
;   ; (needed for themes/skins stored alongside the app)
;   AccessControl::GrantOnFile "$INSTDIR" "(BU)" "GenericRead + GenericWrite"
; !macroend
