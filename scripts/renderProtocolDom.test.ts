/**
 * Self-checks for the fixture harness in `renderProtocolDom.ts`.
 *
 * `renderProtocol.test.ts` trusts that shim to represent what a browser would
 * hand `processMarkdownHtml`. A shim bug would otherwise turn into a silently
 * wrong contract test, so the pieces that carry the risk — the parser, the
 * serializer, the selector engine and the tree walker — are exercised here on
 * their own. If these fail, the protocol assertions mean nothing.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	NODE_ELEMENT,
	NODE_TEXT,
	installShimDom,
	parseHtml,
	structureOf,
	type ShimNode,
} from './renderProtocolDom.ts';
import { renderFixtures } from './renderProtocolFixtures.ts';

installShimDom();

test('parsing and reserializing every fixture is stable', () => {
	for (const [name, fixture] of Object.entries(renderFixtures)) {
		const once = parseHtml(fixture.html).body;
		const twice = parseHtml(once.innerHTML).body;
		assert.deepEqual(
			structureOf(twice),
			structureOf(once),
			`${name}: the shim does not round-trip the renderer's HTML`,
		);
	}
});

test('parsing preserves the document text exactly', () => {
	const decode = (value: string) =>
		value
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&quot;/g, '"')
			.replace(/&#39;/g, "'")
			.replace(/&amp;/g, '&');

	for (const [name, fixture] of Object.entries(renderFixtures)) {
		assert.equal(
			parseHtml(fixture.html).body.textContent,
			decode(fixture.html.replace(/<[^>]*>/g, '')),
			`${name}: text was lost or invented while parsing`,
		);
	}
});

test('the parser keeps attributes, nesting and void elements', () => {
	const body = parseHtml(
		'<ul class="a b"><li data-sourcepos="1:1-1:9"><input type="checkbox" disabled="" /> x<br />y</li></ul>',
	).body;

	assert.deepEqual(structureOf(body), {
		tag: 'body',
		attributes: [],
		children: [
			{
				tag: 'ul',
				attributes: [['class', 'a b']],
				children: [
					{
						tag: 'li',
						attributes: [['data-sourcepos', '1:1-1:9']],
						children: [
							{
								tag: 'input',
								attributes: [
									['type', 'checkbox'],
									['disabled', ''],
								],
								children: [],
							},
							{ text: ' x' },
							{ tag: 'br', attributes: [], children: [] },
							{ text: 'y' },
						],
					},
				],
			},
		],
	});
});

test('the parser decodes entities in text and attributes', () => {
	const body = parseHtml('<p title="a &amp; b">1 &lt; 2 &amp;&amp; 3 &gt; 2 &#39;ok&#39;</p>').body;
	const paragraph = body.querySelectorAll('p')[0];

	assert.equal(paragraph.getAttribute('title'), 'a & b');
	assert.equal(paragraph.textContent, "1 < 2 && 3 > 2 'ok'");
	assert.equal(paragraph.innerHTML, '1 &lt; 2 &amp;&amp; 3 &gt; 2 \'ok\'');
});

test('the selector engine handles the shapes the render pipeline uses', () => {
	const body = parseHtml(
		'<ul><li><input type="checkbox" data-task-checkbox="" /></li></ul>' +
			'<p><input type="radio" /></p>' +
			'<h2><a class="anchor" id="x"></a>T</h2>' +
			'<div class="block-id">^one</div>',
	).body;

	assert.equal(body.querySelectorAll('li input[type="checkbox"]').length, 1);
	assert.equal(body.querySelectorAll('input[type="checkbox"]').length, 1);
	assert.equal(body.querySelectorAll('li input[data-task-checkbox]').length, 1);
	assert.equal(body.querySelectorAll('p, li').length, 2);
	assert.equal(body.querySelectorAll('h1, h2, h3, h4, h5, h6').length, 1);
	assert.equal(body.querySelectorAll('a.anchor')[0].id, 'x');
	assert.equal(body.querySelectorAll('.block-id, [data-block-id]').length, 1);

	const checkbox = body.querySelectorAll('input[type="checkbox"]')[0];
	assert.equal(checkbox.closest('li')?.tagName, 'LI');
	assert.equal(checkbox.closest('table'), null);
});

test('the tree walker skips rejected subtrees and yields only text', () => {
	const body = parseHtml('<p>keep<code>drop<em>drop too</em></code>tail</p>').body;
	const scope = globalThis as unknown as {
		document: {
			createTreeWalker(
				root: ShimNode,
				whatToShow: number,
				filter?: { acceptNode(node: ShimNode): number },
			): { nextNode(): ShimNode | null };
		};
		NodeFilter: { SHOW_TEXT: number; FILTER_ACCEPT: number; FILTER_REJECT: number };
	};

	const walker = scope.document.createTreeWalker(body, scope.NodeFilter.SHOW_TEXT, {
		acceptNode(node) {
			let current = node.parentElement;
			while (current && current !== body) {
				if (current.tagName === 'CODE') return scope.NodeFilter.FILTER_REJECT;
				current = current.parentElement;
			}
			return scope.NodeFilter.FILTER_ACCEPT;
		},
	});

	const seen: string[] = [];
	let node: ShimNode | null;
	while ((node = walker.nextNode())) {
		assert.equal(node.nodeType, NODE_TEXT);
		seen.push(node.textContent);
	}
	assert.deepEqual(seen, ['keep', 'tail']);
});

test('mutation keeps parent links and document order consistent', () => {
	const doc = parseHtml('<div><span>a</span><span>b</span><span>c</span></div>');
	const container = doc.body.querySelectorAll('div')[0];
	const [a, b, c] = container.querySelectorAll('span');

	const wrapper = doc.createElement('em');
	b.replaceWith(wrapper);
	wrapper.appendChild(b);
	assert.equal(container.innerHTML, '<span>a</span><em><span>b</span></em><span>c</span>');
	assert.equal(b.parentNode, wrapper);

	container.insertBefore(doc.createTextNode('|'), c);
	assert.equal(container.innerHTML, '<span>a</span><em><span>b</span></em>|<span>c</span>');

	a.remove();
	assert.equal(a.parentNode, null);
	assert.equal(container.childNodes.length, 3);

	container.replaceChildren(doc.createTextNode('only'));
	assert.equal(container.innerHTML, 'only');
	assert.equal(container.childNodes[0].nodeType, NODE_TEXT);

	const heading = doc.createElement('h1');
	heading.classList.add('one', 'two');
	heading.classList.remove('one');
	heading.id = 'h';
	assert.equal(heading.outerHTML, '<h1 class="two" id="h"></h1>');
	assert.equal(heading.nodeType, NODE_ELEMENT);
});

test('checked reflects the attribute the renderer emits', () => {
	const body = parseHtml('<input type="checkbox" checked="" /><input type="checkbox" />').body;
	const [checked, unchecked] = body.querySelectorAll('input');

	assert.equal(checked.checked, true);
	assert.equal(unchecked.checked, false);
	unchecked.checked = true;
	assert.equal(unchecked.hasAttribute('checked'), true);
});
