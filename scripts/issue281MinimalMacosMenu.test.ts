import assert from 'node:assert/strict';
import test from 'node:test';

import { readSource, sliceBetween } from './sourceTree.js';

const tauriLib = readSource('src-tauri/src/lib.rs');
const viewer = readSource('src/lib/MarkdownViewer.svelte');

test('macOS native menu keeps only application-level actions', () => {
	const menuSetup = sliceBetween(
		tauriLib,
		'#[cfg(target_os = "macos")]\n            {\n                use tauri::menu',
		'\n            let config_dir',
	);

	assert.match(menuSetup, /MenuItemBuilder::with_id\("menu-app-settings", "Settings…"\)\s*\.accelerator\("CmdOrCtrl\+,"\)/);
	assert.match(menuSetup, /MenuItemBuilder::with_id\("check-updates", "Check for Updates…"\)/);
	assert.match(menuSetup, /PredefinedMenuItem::services\(app, None\)/);
	assert.match(menuSetup, /PredefinedMenuItem::hide\(app, None\)/);
	assert.doesNotMatch(menuSetup, /PredefinedMenuItem::(?:hide_others|show_all)/);
	assert.match(menuSetup, /\.items\(&\[&app_submenu, &edit_submenu\]\)/);
	assert.doesNotMatch(menuSetup, /SubmenuBuilder::new\(app, "(?:File|Window)"\)/);
});

// Document actions stay in the in-window controls (#281), but Edit is not a
// document menu: macOS routes ⌘X/⌘C/⌘V/⌘A through the main menu to the
// first responder, so dropping it left every native input unable to paste
// (#526).
test('macOS menu keeps the standard Edit items so text fields can paste', () => {
	const menuSetup = sliceBetween(
		tauriLib,
		'#[cfg(target_os = "macos")]\n            {\n                use tauri::menu',
		'\n            let config_dir',
	);

	assert.match(menuSetup, /SubmenuBuilder::new\(app, "Edit"\)/);
	for (const item of ['undo', 'redo', 'cut', 'copy', 'paste', 'select_all']) {
		assert.match(menuSetup, new RegExp(`PredefinedMenuItem::${item}\\(app, None\\)`));
	}
});

test('native Settings opens only the focused window settings modal', () => {
	assert.match(tauriLib, /if id == "menu-app-settings" \{\s*let _ = app\.emit_to\(window\.label\(\), "menu-app-settings", \(\)\);/);
	assert.match(viewer, /appWindow\.listen\('menu-app-settings', \(\) => \{\s*showSettings = true;\s*\}\)/);
});
