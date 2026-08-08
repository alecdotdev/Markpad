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

/** The prose above `version: 2` — the argument that justifies the settings below it. */
const headerLines = config.slice(0, config.indexOf('version: 2')).split('\n');

const manifest = JSON.parse(readSource('package.json')) as {
	dependencies: Record<string, string>;
	devDependencies: Record<string, string>;
};

/**
 * The cadence the header comment promises for each ecosystem, read out of the
 * table it opens with:
 *
 *   github-actions  monthly    -- someone else's deadline
 *   npm             quarterly  -- our own deadline
 *
 * Per ecosystem rather than one global cadence. The previous version of this
 * file read a single promised cadence and applied it to every block, which was
 * only right because every block agreed; with two cadences that shape passes as
 * long as *some* ecosystem matches, which is a test going green for the wrong
 * reason.
 */
const promisedCadence = new Map(
	headerLines
		.map((line) =>
			/^#\s{2,}([a-z-]+)\s{2,}(daily|weekly|monthly|quarterly|semiannually|yearly)\b/.exec(line),
		)
		.filter((m): m is RegExpExecArray => m !== null)
		.map((m) => [m[1], m[2]]),
);

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

test('a security fix never waits for the grouped batch', () => {
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

test('each ecosystem runs on the cadence the header comment promises for it', () => {
	// Two copies of one fact: the table that argues for each cadence, and the
	// `interval:` that implements it. Checked per ecosystem, so that changing one
	// block's interval fails and names that block, rather than passing because
	// its two siblings still agree with the comment.
	const blocks = ecosystemBlocks();
	assert.deepEqual(
		[...promisedCadence.keys()].sort(),
		blocks.map((b) => b.ecosystem).sort(),
		'the header comment must state a cadence for every ecosystem and no others',
	);
	for (const { ecosystem, text } of blocks) {
		const promised = promisedCadence.get(ecosystem);
		const actual = /interval:\s*(\S+)/.exec(text)?.[1];
		assert.equal(
			actual,
			promised,
			`the header comment promises ${ecosystem} runs ${promised}, but its block says ${actual}`,
		);
	}
});

test('every pre-1.0 npm dependency is kept out of the grouped batch', () => {
	// Dependabot types an npm update by the literal position of the number, so
	// katex 0.16.47 -> 0.18.1 is a `minor` and lands in the batch — while npm's
	// own caret rule stops `^0.16.47` before 0.17, because below 1.0 a minor
	// bump is the breaking one. KaTeX 0.18.0 renamed every internal CSS class;
	// it arrived inside the batch that is supposed to be safe to skim (#487).
	//
	// Cargo gets this right on its own (`Cargo::Version` implements the pre-1.0
	// rule), so this is an npm-only exclusion, and `patterns` cannot express it
	// — they match names, not versions. So it is a hand-written list, and this
	// is what keeps the list honest: the expectation is derived from
	// package.json, so adding a 0.x dependency, or an existing one reaching 1.0,
	// fails here rather than silently changing what the batch contains.
	const ranges = { ...manifest.dependencies, ...manifest.devDependencies };
	const preRelease = Object.entries(ranges)
		.filter(([, range]) => /^[\^~]?0\./.test(range))
		.map(([name]) => name)
		.sort();
	assert.ok(
		preRelease.length > 0,
		'expected package.json to declare at least one pre-1.0 dependency; if that is no longer ' +
			'true this test and the exclude-patterns it guards should both go',
	);

	const npm = ecosystemBlocks().find((b) => b.ecosystem === 'npm');
	assert.ok(npm, 'the npm ecosystem block must exist');
	const excluded = /exclude-patterns:\n((?:\s+- '[^']+'\n)+)/.exec(npm.text);
	assert.ok(
		excluded,
		`the npm group must exclude its pre-1.0 dependencies (${preRelease.join(', ')}); without ` +
			'that they ride along in the grouped pull request as ordinary minor bumps',
	);
	const listed = [...excluded[1].matchAll(/- '([^']+)'/g)].map((m) => m[1]).sort();
	assert.deepEqual(
		listed,
		preRelease,
		'the npm group\'s exclude-patterns must name exactly the pre-1.0 dependencies in package.json',
	);
});

test('every ignored range names a version series, so the entry lapses', () => {
	// An `ignore` is the one thing in this file that also filters *security*
	// updates, and the one thing with no expiry. A bare `dependency-name`, or a
	// semver level, silences a dependency until somebody deletes the line —
	// and nothing will ever prompt them to.
	//
	// A bounded series does prompt them: `windows` is held at `0.62.*` because
	// tauri requires `^0.61`, and the day `windows` 0.63 ships, Dependabot
	// proposes it and the question gets asked again.
	//
	// This does not assert *which* dependencies are ignored — that is a decision
	// the file may change. It asserts that whatever is ignored is ignored in a
	// way that ends.
	for (const { ecosystem, text } of ecosystemBlocks()) {
		// Two steps, not one: "does this block ignore anything" is asked
		// separately from "can this test read what it ignores", so a spelling the
		// parser below does not understand fails here instead of skipping the
		// block and reporting success.
		if (!/^ {4}ignore:$/m.test(text)) continue;
		const ignores = /^ {4}ignore:\n((?: {6}[-\s].*\n)+)/m.exec(text);
		assert.ok(
			ignores,
			`${ecosystem} has an \`ignore:\` key this test cannot parse, so it cannot vouch for it`,
		);
		const entries = [
			...ignores[1].matchAll(/- dependency-name:\s*(\S+)\n\s+versions:\s*\[([^\]]*)\]/g),
		];
		const names = [...ignores[1].matchAll(/- dependency-name:/g)];
		assert.equal(
			entries.length,
			names.length,
			`every ignore entry under ${ecosystem} must carry a \`versions:\` list; an entry without ` +
				'one silences the dependency permanently, including its security updates',
		);
		for (const [, name, versions] of entries) {
			for (const range of versions.split(',')) {
				assert.match(
					range.trim(),
					/^'\d+\.\d+\.\*'$/,
					`ignoring ${name} at ${range.trim()} does not name a bounded version series, so ` +
						'nothing will ever reopen the question',
				);
			}
		}
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
