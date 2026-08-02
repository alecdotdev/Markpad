# Issue 281: Minimal macOS application menu

## Goal

Provide only macOS application-level native actions while retaining Markpad's
in-window controls as the source of document and window actions.

## Scope

- Keep the application menu's About, Settings, update, Services, hide, and
  quit actions.
- Give Settings the `Cmd+,` accelerator.
- Remove native File, Edit, and Window submenus.
- Route Settings only to the focused webview and open the modal; it must not
  toggle an already-open modal or broadcast to other windows.

## Implementation

1. Build a `menu-app-settings` menu item in the existing macOS-only setup and
   attach only the application submenu to the native menu bar.
2. Route `menu-app-settings` through the existing focused-window event path.
3. Listen for that event in `MarkdownViewer` and set `showSettings = true`,
   matching the titlebar callback.
4. Remove now-unused native File action listeners and the macOS keyboard guard
   for their old accelerators.

## Validation

- Add source-contract tests for the native menu shape and focused-window
  Settings event wiring.
- Run `npm ci`, `npm run check`, `npm test`, and `cargo test`.
