import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
	MERMAID_PRINT_THEME,
	findRestorableDiagrams,
	readDiagramSource,
	rememberDiagramSource,
	renderDiagramsForPrint,
	resolveMermaidTheme,
} from '../src/lib/utils/mermaidPrint.js';

const viewer = readFileSync(new URL('../src/lib/MarkdownViewer.svelte', import.meta.url), 'utf8');

/**
 * Minimal stand-ins for the DOM pieces the helper touches. Enough to drive
 * the real implementation without a browser, which is how the rest of
 * scripts/ tests DOM-adjacent logic.
 */
class FakeElement {
	attributes = new Map<string, string>();
	innerHTML = '';
	constructor(public className = '') {}
	setAttribute(name: string, value: string) {
		this.attributes.set(name, value);
	}
	getAttribute(name: string) {
		return this.attributes.has(name) ? this.attributes.get(name)! : null;
	}
}

class FakeRoot {
	constructor(private elements: FakeElement[]) {}
	querySelectorAll(selector: string) {
		assert.match(selector, /\.mermaid-diagram\[data-mermaid-source\]/);
		return this.elements.filter(
			(element) => element.className.includes('mermaid-diagram') && element.getAttribute('data-mermaid-source') !== null,
		);
	}
}

function makeMermaid(behaviour: (source: string) => string) {
	const themes: string[] = [];
	return {
		themes,
		initialize(config: { startOnLoad: boolean; theme: string }) {
			themes.push(config.theme);
		},
		async render(_id: string, source: string) {
			return { svg: behaviour(source) };
		},
	};
}

function diagram(source: string | null, html: string) {
	const element = new FakeElement('mermaid-diagram');
	if (source !== null) rememberDiagramSource(element, source);
	element.innerHTML = html;
	return element;
}

test('the diagram theme follows the app appearance', () => {
	assert.equal(resolveMermaidTheme({ theme: 'dark', systemPrefersDark: false }), 'dark');
	assert.equal(resolveMermaidTheme({ theme: 'light', systemPrefersDark: true }), 'neutral');
	assert.equal(resolveMermaidTheme({ theme: 'system', systemPrefersDark: true }), 'dark');
	assert.equal(resolveMermaidTheme({ theme: 'system', systemPrefersDark: false }), 'neutral');
	// A VS Code theme reports its polarity through the dataset instead.
	assert.equal(
		resolveMermaidTheme({ theme: 'vscode:whatever', datasetThemeType: 'dark', systemPrefersDark: false }),
		'dark',
	);
});

test('the source is kept on the container so the diagram can be rebuilt', () => {
	const element = diagram('flowchart TD\n A --> B', '<svg>screen</svg>');
	assert.equal(readDiagramSource(element), 'flowchart TD\n A --> B');
	assert.equal(findRestorableDiagrams(new FakeRoot([element]) as unknown as ParentNode).length, 1);
	// A diagram rendered before this change carries no source and is skipped
	// rather than blanked.
	assert.equal(findRestorableDiagrams(new FakeRoot([diagram(null, '<svg/>')]) as unknown as ParentNode).length, 0);
});

test('exporting re-renders with the print theme and then restores the screen rendering', async () => {
	const first = diagram('sequenceDiagram\n A->>B: hi', '<svg>dark-1</svg>');
	const second = diagram('flowchart TD\n A --> B', '<svg>dark-2</svg>');
	const mermaid = makeMermaid((source) => `<svg>light:${source.split('\n')[0]}</svg>`);

	const restore = await renderDiagramsForPrint({
		root: new FakeRoot([first, second]) as unknown as ParentNode,
		mermaid,
		sanitizeSvg: (svg) => svg,
		screenTheme: 'dark',
		idFactory: (index) => `id-${index}`,
	});

	assert.equal(first.innerHTML, '<svg>light:sequenceDiagram</svg>');
	assert.equal(second.innerHTML, '<svg>light:flowchart TD</svg>');
	assert.deepEqual(mermaid.themes, [MERMAID_PRINT_THEME]);

	restore();
	assert.equal(first.innerHTML, '<svg>dark-1</svg>');
	assert.equal(second.innerHTML, '<svg>dark-2</svg>');
	assert.deepEqual(mermaid.themes, [MERMAID_PRINT_THEME, 'dark']);

	// Restoring twice must not re-run initialize or clobber a later render.
	first.innerHTML = '<svg>re-rendered later</svg>';
	restore();
	assert.equal(first.innerHTML, '<svg>re-rendered later</svg>');
	assert.deepEqual(mermaid.themes, [MERMAID_PRINT_THEME, 'dark']);
});

test('a diagram that fails to re-render keeps its screen rendering', async () => {
	const element = diagram('broken', '<svg>dark</svg>');
	const errors: unknown[] = [];
	const mermaid = {
		themes: [] as string[],
		initialize(config: { startOnLoad: boolean; theme: string }) {
			this.themes.push(config.theme);
		},
		async render(): Promise<{ svg: string }> {
			throw new Error('bad diagram');
		},
	};

	const restore = await renderDiagramsForPrint({
		root: new FakeRoot([element]) as unknown as ParentNode,
		mermaid,
		sanitizeSvg: (svg) => svg,
		screenTheme: 'dark',
		onError: (error) => errors.push(error),
	});

	assert.equal(element.innerHTML, '<svg>dark</svg>');
	assert.equal(errors.length, 1);
	restore();
	assert.equal(element.innerHTML, '<svg>dark</svg>');
});

test('the helper is inert when there is nothing to re-render', async () => {
	const restore = await renderDiagramsForPrint({
		root: null,
		mermaid: null,
		sanitizeSvg: (svg) => svg,
		screenTheme: 'dark',
	});
	restore();
	assert.equal(typeof restore, 'function');
});

test('the PDF export wraps the print render and always restores', () => {
	assert.match(viewer, /const restoreDiagrams = await renderDiagramsForPrint\(\{/);
	assert.match(viewer, /\} finally \{\n\t\t\trestoreDiagrams\(\);\n\t\t\}/);
	// The screen render must record the source, or there is nothing to rebuild.
	assert.match(viewer, /rememberDiagramSource\(container, mermaidCode\);/);
	// One theme decision, shared by the screen render and the restore.
	assert.match(viewer, /mermaid\.initialize\(\{ startOnLoad: false, theme: currentMermaidTheme\(\) \}\)/);
});
