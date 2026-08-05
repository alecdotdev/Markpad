import assert from 'node:assert/strict';
import test from 'node:test';

import {
	EditorOptions,
	inUntrustedWorkspace,
	type UnicodeHighlightOptions,
} from 'monaco-editor/esm/vs/editor/common/config/editorOptions.js';
import {
	UnicodeTextModelHighlighter,
	type UnicodeHighlightResult,
} from 'monaco-editor/esm/vs/editor/common/services/unicodeTextModelHighlighter.js';
import ts from 'typescript';

import { readSource, sliceBetween } from './sourceTree.js';

// Editor.svelte translates the settings store into Monaco options and
// keybindings. Every regression locked here came from that translation layer
// being wired to the wrong shape: a string option read as a boolean, a
// modifier that macOS never delivers, one key bound twice, and a native
// behaviour dropped by the action that replaced it.

const editor = readSource('src/lib/components/Editor.svelte');
const settingsStore = readSource('src/lib/stores/settings.svelte.ts');

function count(source: string, pattern: RegExp): number {
	return source.match(pattern)?.length ?? 0;
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

	const block = sliceBetween(editor, 'editor.updateOptions({', '});');
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

	// Back-reference rather than the literal `tabCycleModifier`: what has to hold
	// is that the binding uses the same value the platform check produced, and
	// the local holding it is free to be renamed.
	assert.match(
		editor,
		/const (\w+) = isMacPlatform\(\)\s*\?\s*monaco\.KeyMod\.WinCtrl\s*:\s*monaco\.KeyMod\.CtrlCmd[\s\S]*?keybindings: \[\1 \| monaco\.KeyCode\.Tab\]/,
		'modifier is chosen per platform (real Ctrl on macOS, CtrlCmd elsewhere) and tab-next uses it',
	);
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
	const helper = sliceBetween(editor, 'function isMacPlatform', '\n\t}');
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
	const copyAction = sliceBetween(editor, 'id: "custom-copy"', 'id: "toggle-minimap"');

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

// ----------------------------------------------------------------- executed
//
// Everything above matches Editor.svelte as text, because a keybinding and a
// settings-driven enum cannot be exercised without a DOM. `unicodeHighlight`
// can do better, and the weak form would be particularly bad here: asserting
// that the string "ambiguousCharacters" occurs in the file says nothing about
// which characters Monaco ends up outlining, which is the entire contract.
//
// So the option literal is lifted out of the real `monaco.editor.create` call,
// evaluated, and pushed through the same two pieces of Monaco the running
// editor uses — `EditorOptions.unicodeHighlight.applyUpdate` to merge it over
// the shipped defaults, and `UnicodeTextModelHighlighter` to decide what gets a
// box. A regression has to survive Monaco's own code to reach the assertions.

/** The options object Editor.svelte hands to `monaco.editor.create`, evaluated. */
function createdEditorOptions(): Record<string, unknown> {
	const script = sliceBetween(editor, '<script lang="ts">', '</script>');
	const source = ts.createSourceFile('Editor.ts', script, ts.ScriptTarget.Latest, true);

	const literals: ts.Expression[] = [];
	const visit = (node: ts.Node): void => {
		if (ts.isCallExpression(node) && node.expression.getText(source) === 'monaco.editor.create') {
			assert.equal(node.arguments.length, 2, 'monaco.editor.create(container, options)');
			literals.push(node.arguments[1]);
		}
		ts.forEachChild(node, visit);
	};
	visit(source);

	// Also the check that this file is looking at the only editor in the app: a
	// second `create` call would need the same option and would not be covered
	// by anything below.
	assert.equal(literals.length, 1, 'exactly one Monaco editor is constructed in Editor.svelte');

	const js = ts.transpileModule(`(${literals[0].getText(source)})`, {
		compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
	}).outputText;

	// The literal closes over four locals. None of them can reach
	// `unicodeHighlight`, which is a constant, so they are stubbed rather than
	// reconstructed — the settings proxy answers undefined for every key, which
	// is enough to let the object build.
	return new Function('settings', 'value', 'language', 'getTheme', `return ${js};`)(
		new Proxy({}, { get: () => undefined }),
		'',
		'markdown',
		() => 'app-theme-dark',
	) as Record<string, unknown>;
}

/**
 * Monaco's shipped defaults with the component's option merged over them.
 *
 * `?? {}` models the real absence case rather than guarding: a component that
 * passes no `unicodeHighlight` gets Monaco's defaults, which is the state this
 * whole section exists to move away from. Without it, deleting the option from
 * Editor.svelte fails the tests below with a TypeError raised inside Monaco
 * instead of the assertion naming the characters that came back.
 */
function effectiveUnicodeHighlight(passed: unknown): UnicodeHighlightOptions {
	const option = EditorOptions.unicodeHighlight;
	return option.applyUpdate(option.defaultValue, passed ?? {}).newValue;
}

/**
 * What Monaco would outline in `lines`, given an effective option set.
 *
 * Mirrors `resolveOptions()` in unicodeHighlighter.ts, which is not exported.
 * `trusted` is true because that is what standalone Monaco reports —
 * `StandaloneWorkspaceTrustManagementService.isWorkspaceTrusted()` returns true
 * unconditionally. That is why `nonBasicASCII`, whose default is the
 * `inUntrustedWorkspace` sentinel, is already off and needs no setting in
 * Editor.svelte: it resolves through `!trusted`.
 */
function outlined(lines: string[], effective: UnicodeHighlightOptions): UnicodeHighlightResult {
	const trusted = true;
	const through = (value: boolean | 'inUntrustedWorkspace') =>
		value === inUntrustedWorkspace ? !trusted : value;
	return UnicodeTextModelHighlighter.computeUnicodeHighlights(
		{ getLineCount: () => lines.length, getLineContent: (n: number) => lines[n - 1] },
		{
			nonBasicASCII: through(effective.nonBasicASCII),
			ambiguousCharacters: effective.ambiguousCharacters,
			invisibleCharacters: effective.invisibleCharacters,
			includeComments: through(effective.includeComments),
			includeStrings: through(effective.includeStrings),
			allowedCodePoints: Object.keys(effective.allowedCharacters).map((c) => c.codePointAt(0)),
			// The real value is derived from the OS locale and Monaco's UI
			// language. It is pinned here because it makes no difference: the
			// fullwidth forms are confusable in every locale Monaco ships, zh-CN
			// and ja-JP included, which is why the reporters saw boxes on
			// CJK systems in the first place.
			allowedLocales: ['en'],
		},
	);
}

// Prose a CJK author actually types. The boxes need a basic-ASCII character in
// the same word as the fullwidth punctuation — `shouldHighlightNonBasicASCII`
// suppresses the highlight when the surrounding word is entirely non-ASCII —
// so a Latin technical term or a Markdown emphasis marker is what triggers it.
const CJK_PROSE = [
	'使用 Monaco，然后保存。',
	'安装依赖（npm ci），再运行测试。',
	'这是 Markdown，不是 HTML。',
	'打开 Settings：Editor，字体大小。',
	'**粗体**，*斜体*，`代码`。',
	'标题（English Title）说明',
	'你好，世界。（测试）！？',
];

test('the editor turns off ambiguous-character highlighting and nothing else', () => {
	// Reports #186 and #94 are both Monaco outlining fullwidth punctuation.
	// Narrowness is the assertion: `unicodeHighlight: false` or a third
	// sub-option would also make the boxes go away, and would take the
	// invisible-character warning with it.
	const options = createdEditorOptions();
	assert.deepEqual(
		options.unicodeHighlight,
		{ ambiguousCharacters: false },
		'exactly one sub-option is overridden',
	);
});

test('no box is drawn on fullwidth CJK punctuation', () => {
	const effective = effectiveUnicodeHighlight(createdEditorOptions().unicodeHighlight);
	const found = outlined(CJK_PROSE, effective);
	assert.equal(
		found.ranges.length,
		0,
		`nothing outlined in CJK prose, got ${JSON.stringify(
			found.ranges.map((r) => CJK_PROSE[r.startLineNumber - 1].slice(r.startColumn - 1, r.endColumn - 1)),
		)}`,
	);
	assert.equal(found.ambiguousCharacterCount, 0);
});

test('the fixtures still reproduce the bug once the option is taken away', () => {
	// Without this the test above could pass because Monaco stopped treating
	// the fullwidth forms as confusable — an upgrade would quietly leave it
	// asserting nothing. It fails loudly instead, on the fixtures rather than
	// on the fix.
	const withDefaults = effectiveUnicodeHighlight({ ambiguousCharacters: true });
	const found = outlined(CJK_PROSE, withDefaults);
	assert.ok(
		found.ambiguousCharacterCount >= 6,
		`Monaco's defaults still box CJK punctuation, got ${found.ambiguousCharacterCount}`,
	);
});

test('the invisible-character warning survives the fix', () => {
	// A stray NBSP or zero-width space is a real hazard in Markdown — an NBSP
	// after `-` stops a list from parsing — and unlike the punctuation it is
	// never something the author typed on purpose. Turning the whole feature
	// off would have taken it with it.
	const effective = effectiveUnicodeHighlight(createdEditorOptions().unicodeHighlight);
	assert.equal(effective.invisibleCharacters, true, 'left at the Monaco default');

	const found = outlined(['a b', 'x​z'], effective);
	assert.equal(found.invisibleCharacterCount, 2, 'NBSP and zero-width space are still flagged');
});
