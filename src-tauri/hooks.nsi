; NSIS installer hooks, included by the bundler template
; (crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi) and inserted from
; `!ifmacrodef NSIS_HOOK_POSTINSTALL` / `!ifmacrodef NSIS_HOOK_POSTUNINSTALL`.
; There is no underscore between POST and INSTALL, and `!ifmacrodef` is a
; compile-time conditional, so any other spelling is skipped in silence.
;
; Everything a hook does here has to be something the template does not already
; do. The template creates the desktop shortcut from the finish-page checkbox
; (and automatically for silent and passive installs), registers `.md` and
; `.markdown` from `bundle.fileAssociations` via APP_ASSOCIATE, and writes every
; key through SHCTX so it follows `installMode`. Duplicating any of that from
; here overrides a choice the user was already given.

; Drop the uninstall entry a pre-2.7 custom install left in one hive.
;
; Those installs wrote `UninstallString = "…\Markpad.exe" --uninstall` under the
; same key this installer uses. Section Install overwrites that value, but only
; in SHCTX -- so when the old install chose the other hive, its entry survives as
; a second Add/Remove Programs row pointing at a command the binary no longer
; answers. Only the custom installer ever wrote `--uninstall`, so matching on the
; tail of the value cannot hit an entry this installer owns.
;
; DeleteRegKey under HKLM fails without elevation. That is left as a silent
; no-op: the binary forwards a stray `--uninstall` to uninstall.exe on its own,
; which is the same outcome by a slower road.
!macro MARKPAD_DROP_LEGACY_UNINSTALL_ENTRY HIVE
  Push $0
  Push $1
  ClearErrors
  ReadRegStr $0 ${HIVE} "${UNINSTKEY}" "UninstallString"
  ${IfNot} ${Errors}
    StrCpy $1 $0 "" -11
    ${If} $1 == "--uninstall"
      DeleteRegKey ${HIVE} "${UNINSTKEY}"
    ${EndIf}
  ${EndIf}
  Pop $1
  Pop $0
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; The template registers the file associations through FileAssociation.nsh but
  ; never inserts that header's own UPDATEFILEASSOC, so Explorer can go on
  ; serving the previous handler and icon for `.md` until the next logon.
  ; Broadcasting SHCNE_ASSOCCHANGED (0x08000000) with SHCNF_IDLIST (0) and two
  ; null items is the documented way to tell it to re-read them.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'

  ; Section Install has already written the good value into SHCTX by the time
  ; this hook runs, so neither pass can match the entry that was just written.
  !insertmacro MARKPAD_DROP_LEGACY_UNINSTALL_ENTRY HKCU
  !insertmacro MARKPAD_DROP_LEGACY_UNINSTALL_ENTRY HKLM
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; And again once APP_UNASSOCIATE has handed `.md` back.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
