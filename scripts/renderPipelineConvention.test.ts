import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

// Every preview render must go through renderMarkdownPreview, which strips
// YAML front matter before invoking the Rust renderer. Calling the raw
// `invoke('render_markdown')` command anywhere else silently bypasses that
// step — the compiler cannot catch it because the command name is a string.
// This test pins the exact set of files allowed to touch the raw command.
//
// If you add a new render call site, use renderMarkdownPreview (or
// renderTabPreviewFromRaw for the full render-and-apply sequence) instead
// of widening the allowlist.

const RAW_COMMAND = "invoke('render_markdown'";

const ALLOWED: Record<string, number> = {
	// The pipeline helper itself — the one legitimate caller.
	'src/lib/MarkdownViewer.svelte': 1,
	// Export strips front matter on its own before rendering.
	'src/lib/utils/export.ts': 1,
};

function walk(dir: string): string[] {
	const out: string[] = [];
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) out.push(...walk(path));
		else if (/\.(ts|svelte|js)$/.test(name)) out.push(path);
	}
	return out;
}

test('raw render_markdown invocations appear only at allowlisted sites', () => {
	const found: Record<string, number> = {};
	for (const path of walk('src')) {
		const count = readFileSync(path, 'utf8').split(RAW_COMMAND).length - 1;
		if (count > 0) found[path.replace(/\\/g, '/')] = count;
	}
	assert.deepEqual(
		found,
		ALLOWED,
		'unexpected raw render_markdown call site — render through renderMarkdownPreview instead',
	);
});

test('the viewer occurrence lives inside renderMarkdownPreview', () => {
	const viewer = readFileSync('src/lib/MarkdownViewer.svelte', 'utf8');
	assert.match(
		viewer,
		/async function renderMarkdownPreview[\s\S]{0,400}?invoke\('render_markdown'/,
		'renderMarkdownPreview must be the function wrapping the raw command',
	);
});
