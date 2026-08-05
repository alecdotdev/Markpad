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

!macro NSIS_HOOK_POSTINSTALL
  ; The template registers the file associations through FileAssociation.nsh but
  ; never inserts that header's own UPDATEFILEASSOC, so Explorer can go on
  ; serving the previous handler and icon for `.md` until the next logon.
  ; Broadcasting SHCNE_ASSOCCHANGED (0x08000000) with SHCNF_IDLIST (0) and two
  ; null items is the documented way to tell it to re-read them.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; And again once APP_UNASSOCIATE has handed `.md` back.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
