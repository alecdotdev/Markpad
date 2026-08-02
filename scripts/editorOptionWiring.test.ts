import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Editor.svelte translates the settings store into Monaco options and
// keybindings. Every regression locked here came from that translation layer
// being wired to the wrong shape: a string option read as a boolean, a
// modifier that macOS never delivers, one key bound twice, and a native
// behaviour dropped by the action that replaced it.

const editor = readFileSync('src/lib/components/Editor.svelte', 'utf8');
const settingsStore = readFileSync('src/lib/stores/settings.svelte.ts', 'utf8');

function count(source: string, pattern: RegExp): number {
	return source.match(pattern)?.length ?? 0;
}

function sliceBlock(source: string, startMarker: string, endMarker: string): string {
	const start = source.indexOf(startMarker);
	assert.notEqual(start, -1, `expected to find ${startMarker}`);
	const end = source.indexOf(endMarker, start + startMarker.length);
	assert.notEqual(end, -1, `expected to find ${endMarker} after ${startMarker}`);
	return source.slice(start, end);
}

test('renderLineHighlight is a Monaco string enum, not a boolean flag', () => {
	// The store holds 'line' / 'none'. Any non-empty string is truthy, so a
	// ternary on it can only ever produce "line" and silently defeats both the
	// line-highlight toggle and Zen mode (which sets it to 'none').
	assert.match(settingsStore, /renderLineHighlight = \$state\('line'\)/);
	assert.match(settingsStore, /this\.renderLineHighlight = this\.renderLineHighlight === 'line' \? 'none' : 'line'/);
	assert.match(settingsStore, /this\.renderLineHighlight = 'none'/, 'zen mode sets the string to none');

	assert.doesNotMatch(
		editor,
		/renderLineHighlight:\s*settings\.renderLineHighlight\s*\?/,
		'renderLineHighlight must never be branched on as a boolean',
	);
	assert.doesNotMatch(
		editor,
		/renderLineHighlight:\s*settings\.renderLineHighlight\s*(?:===|!==)/,
		'renderLineHighlight must not be re-derived from a comparison either',
	);
	assert.equal(
		count(editor, /renderLineHighlight: settings\.renderLineHighlight as "line" \| "none"/g),
		2,
		'creation and updateOptions both forward the stored string unchanged',
	);
});

test('editor options are applied by a single updateOptions effect', () => {
	// Two competing effects (one nested in onMount, one top level) wrote the
	// same Monaco options with different values — notably fontSize with and
	// without the zoom factor — so the winner depended on effect ordering.
	assert.equal(count(editor, /editor\.updateOptions\(\{/g), 1, 'exactly one updateOptions call site');

	const block = sliceBlock(editor, 'editor.updateOptions({', '});');
	assert.match(block, /wordWrapColumn: settings\.editorMaxWidth/, 'wordWrapColumn survived the merge');
	assert.match(block, /fontSize: settings\.editorFontSize \* \(zoomLevel \/ 100\)/, 'zoom-aware font size is the surviving one');
	for (const option of [
		'minimap',
		'wordWrap:',
		'lineNumbers',
		'renderLineHighlight',
		'occurrencesHighlight',
		'fontFamily',
		'renderWhitespace',
	]) {
		assert.ok(block.includes(option), `merged effect still applies ${option}`);
	}
});

test('tab cycling avoids Cmd+Tab, which macOS never delivers to the app', () => {
	// Reference frame: VS Code binds Ctrl+Tab / Ctrl+Shift+Tab with
	// KeyMod.WinCtrl on macOS (mac override on
	// workbench.action.quickOpenPreviousRecentlyUsedEditorInGroup) precisely
	// because Cmd+Tab belongs to the system application switcher.
	assert.doesNotMatch(
		editor,
		/monaco\.KeyMod\.CtrlCmd \| monaco\.KeyCode\.Tab/,
		'no unconditional CtrlCmd+Tab binding',
	);
	assert.doesNotMatch(
		editor,
		/monaco\.KeyMod\.CtrlCmd \| monaco\.KeyMod\.Shift \| monaco\.KeyCode\.Tab/,
		'no unconditional CtrlCmd+Shift+Tab binding',
	);

	assert.match(
		editor,
		/const tabCycleModifier = isMacPlatform\(\)\s*\?\s*monaco\.KeyMod\.WinCtrl\s*:\s*monaco\.KeyMod\.CtrlCmd/,
		'modifier is chosen per platform: real Ctrl on macOS, CtrlCmd elsewhere',
	);
	assert.match(editor, /keybindings: \[tabCycleModifier \| monaco\.KeyCode\.Tab\]/, 'tab-next uses the platform modifier');
	assert.match(
		editor,
		/tabCycleModifier \| monaco\.KeyMod\.Shift \| monaco\.KeyCode\.Tab/,
		'tab-prev uses the platform modifier',
	);
});

test('platform detection reads settings.osType and never writes it', () => {
	// The `navigator.platform` fallback is deprecated but load-bearing, and it is
	// asserted here so nobody "modernises" it away. The value is frozen at
	// "MacIntel" on every Mac, arm64 included (verified on an Apple M5), so it is
	// wrong about the CPU and permanently right about the vendor — which is the
	// only thing asked of it. That is why the helper may stay synchronous and why
	// the keybindings are registered once, at mount, rather than re-registered
	// when settings.osType resolves. Full argument: the comment on
	// isMacPlatform() in Editor.svelte.
	const helper = sliceBlock(editor, 'function isMacPlatform', '\n\t}');
	assert.match(helper, /settings\.osType !== 'unknown'/, 'prefers the resolved Tauri os type');
	assert.match(helper, /settings\.osType === 'macos'/);
	assert.match(helper, /navigator\.platform/, 'falls back while osType is still resolving');

	assert.doesNotMatch(editor, /settings\.osType\s*=[^=]/, 'Editor.svelte must not write to the settings store');
});

test('Ctrl+S is registered exactly once, by the command-palette action', () => {
	assert.equal(count(editor, /monaco\.KeyCode\.KeyS/g), 1, 'a single Ctrl+S binding');
	assert.match(
		editor,
		/id: "file-save",[\s\S]*?keybindings: \[monaco\.KeyMod\.CtrlCmd \| monaco\.KeyCode\.KeyS\]/,
		'the surviving binding is the addAction, which also lists in the command palette',
	);
	assert.doesNotMatch(
		editor,
		/addCommand\(monaco\.KeyMod\.CtrlCmd \| monaco\.KeyCode\.KeyS/,
		'the bare addCommand duplicate is gone',
	);
});

test('custom copy keeps Monaco\'s whole-line copy on an empty selection', () => {
	// Reference frame: Monaco ships `emptySelectionClipboard` (documented as
	// "Copying without a selection copies the current line") on by default, and
	// its viewmodel builds that text as getLineContent(line) + EOL. VS Code
	// (editor.emptySelectionClipboard) and Sublime Text behave the same. Since
	// custom-copy overrides the native copy action, bailing out on an empty
	// selection deleted the behaviour outright.
	const copyAction = sliceBlock(editor, 'id: "custom-copy"', 'id: "toggle-minimap"');

	assert.doesNotMatch(
		copyAction,
		/if \(!selection \|\| selection\.isEmpty\(\)\) return/,
		'an empty selection is no longer an early return',
	);
	assert.match(
		copyAction,
		/selection\.isEmpty\(\)\s*\?\s*model\.getLineContent\(selection\.startLineNumber\) \+ model\.getEOL\(\)\s*:\s*model\.getValueInRange\(selection\)/,
		'empty selection copies the current line plus its line ending',
	);
	assert.equal(
		count(copyAction, /invoke\("clipboard_write_text"/g),
		1,
		'both cases go through the one clipboard_write_text path',
	);
});

test('Show Whitespace renders every whitespace run, not just trailing', () => {
	// The setting is labelled without qualification ("Show Whitespace" /
	// "显示空白"), so "trailing" left interior spaces unmarked.
	assert.doesNotMatch(editor, /renderWhitespace: settings\.showWhitespace \? "trailing"/);
	assert.doesNotMatch(editor, /"trailing"/, 'no trailing-only whitespace rendering remains');
	assert.equal(
		count(editor, /renderWhitespace: settings\.showWhitespace \? "all" : "none"/g),
		2,
		'creation and updateOptions agree on "all"',
	);
});
