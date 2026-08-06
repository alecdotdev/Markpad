import assert from 'node:assert/strict';
import test from 'node:test';

import { readSource } from './sourceTree.js';

// What this file locks, and why it is not visible from reading the config once.
//
// Dependabot's own schema check accepts a config that groups majors, and the
// consequence only appears a month later as a pull request nobody can review:
// the first run after #472 batched eleven npm packages across TypeScript 5 -> 7
// and Vite 6 -> 8 (#477), and seventeen crates across
// tauri-plugin-prevent-default 2 -> 5 (#478). Nothing failed. It just produced a
// `chore(deps)` title wrapped around a toolchain migration.
//
// Blocks are checked one at a time rather than by searching the whole file, so
// that a fourth ecosystem added without the same limits fails here instead of
// passing because the other three still match.
//
// `ecosystemBlocks` asserts it found something because every check below is a
// `for` over its result, and a `for` over an empty list passes. Measured: an
// extra space after the `-` in each `- package-ecosystem:` line left the four
// property checks green and only the coverage check red. That is the shape
// where a guard and the thing it guards share one detector, so the detector
// states its own precondition rather than leaving it to a sibling test.

const config = readSource('.github/dependabot.yml');

/**
 * The prose above `version: 2` — the argument that justifies the settings below
 * it — as one line, with the `#` markers and the wrapping removed.
 *
 * Unwrapped because a sentence in a YAML comment is broken across lines at
 * whatever column it reaches, so `/one grouped pull request a month/` against
 * the raw text is a claim about where the author happened to press enter. It
 * did not match: the phrase is split after "pull".
 */
const header = config
	.slice(0, config.indexOf('version: 2'))
	.replace(/^#[ \t]?/gm, '')
	.replace(/\s+/g, ' ');

type EcosystemBlock = { ecosystem: string; text: string };

function ecosystemBlocks(): EcosystemBlock[] {
	const blocks: EcosystemBlock[] = [];
	const starts: number[] = [];
	const marker = /^ {2}- package-ecosystem: (\S+)$/gm;
	const names: string[] = [];
	for (let m = marker.exec(config); m; m = marker.exec(config)) {
		starts.push(m.index);
		names.push(m[1]);
	}
	assert.ok(
		starts.length > 0,
		'found no `- package-ecosystem:` block in .github/dependabot.yml; every check in this ' +
			'file iterates over these blocks, so an unparsed file passes all of them silently',
	);
	for (let i = 0; i < starts.length; i += 1) {
		blocks.push({
			ecosystem: names[i],
			text: config.slice(starts[i], starts[i + 1] ?? config.length),
		});
	}
	return blocks;
}

test('every ecosystem the repository has is configured', () => {
	const found = ecosystemBlocks().map((b) => b.ecosystem);
	// Sorted so the assertion is about coverage rather than about ordering.
	assert.deepEqual([...found].sort(), ['cargo', 'github-actions', 'npm']);
});

test('no group may batch a major version', () => {
	for (const { ecosystem, text } of ecosystemBlocks()) {
		assert.match(
			text,
			/update-types:\n\s+- minor\n\s+- patch\n/,
			`the ${ecosystem} group must limit itself to minor and patch; without that, ` +
				'a major lands inside a grouped pull request and stops being reviewable',
		);
		assert.doesNotMatch(
			text,
			/^\s+- major$/m,
			`the ${ecosystem} group must not list major among its update types`,
		);
	}
});

test('a security fix never waits for the monthly batch', () => {
	for (const { ecosystem, text } of ecosystemBlocks()) {
		// Without this, Dependabot folds security updates into the grouped pull
		// request, and an advisory published on the 2nd waits until the 1st.
		assert.match(
			text,
			/applies-to: version-updates/,
			`the ${ecosystem} group must apply to version updates only`,
		);
	}
});

test('the schedule is the cadence the header comment promises', () => {
	// Two copies of one fact: the prose that argues for a quiet bot, and the
	// `interval:` that implements it. Asserting `interval: monthly` on its own
	// would be a constant checking itself — the header could be edited to
	// promise a weekly bot and nothing would notice. So the expected value is
	// read out of the promise.
	const promised = /one grouped pull request a (day|week|month)\b/.exec(header);
	assert.ok(
		promised,
		'the header comment must still state the cadence it is asking a maintainer to accept',
	);
	const interval = { day: 'daily', week: 'weekly', month: 'monthly' }[promised[1]];
	for (const { ecosystem, text } of ecosystemBlocks()) {
		assert.match(
			text,
			new RegExp(`interval: ${interval}\\b`),
			`the header comment promises one grouped pull request a ${promised[1]}, so ${ecosystem} ` +
				`must be on \`interval: ${interval}\``,
		);
	}
});

test('the open pull request limit leaves room for majors to queue', () => {
	for (const { ecosystem, text } of ecosystemBlocks()) {
		const limit = /open-pull-requests-limit: (\d+)/.exec(text);
		assert.ok(limit, `${ecosystem} must state an open-pull-requests-limit`);
		// One slot is spent on the grouped minor/patch pull request. A limit of 2
		// leaves exactly one for majors, which is what made the backlog invisible.
		assert.ok(
			Number(limit[1]) >= 3,
			`${ecosystem} has a limit of ${limit[1]}; majors open one pull request each, ` +
				'so anything under 3 hides the queue rather than shortening it',
		);
	}
});
