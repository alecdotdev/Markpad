import assert from 'node:assert/strict';
import test from 'node:test';

import { readSource, sliceBetween } from './sourceTree.js';

const workflow = readSource('.github/workflows/build.yml');
const testWorkflow = readSource('.github/workflows/test.yml');
const testBuildWorkflow = readSource('.github/workflows/test_build.yml');
const releasing = readSource('RELEASING.md');
const snapcraft = readSource('snapcraft.yaml');
const cargoToml = readSource('src-tauri/Cargo.toml');
const packageJson = JSON.parse(readSource('package.json')) as {
	scripts: Record<string, string>;
	version: string;
};
const tauriConf = JSON.parse(readSource('src-tauri/tauri.conf.json')) as {
	plugins: { updater: { endpoints: string[]; pubkey: string } };
};

/** Every `node-version:` value in a workflow, in file order. */
function nodeVersions(source: string): string[] {
	return [...source.matchAll(/^\s*node-version:\s*'?([^'\s]+)'?\s*$/gm)].map((m) => m[1]);
}

test('release builds install the locked dependency graph', () => {
	assert.match(workflow, /name: Install Frontend Dependencies\s+run: npm ci/);
	assert.doesNotMatch(workflow, /npm install/);
});

test('the snap build installs the locked dependency graph too', () => {
	// RELEASING.md promises every release channel resolves exactly the committed
	// lockfile. The snap is built by snapcraft, not by build.yml, so the
	// assertion above cannot see it.
	assert.match(snapcraft, /^\s+npm ci$/m);
	assert.doesNotMatch(snapcraft, /npm install/);
});

test('the runtime version and the frontend version cannot drift apart', () => {
	// Tauri reads the runtime version from Cargo.toml while the Tauri config and
	// the frontend read package.json. A mismatch makes tauri-plugin-updater
	// compare the wrong version and either skip or replay an update.
	const cargoVersion = /^\s*\[package\][\s\S]*?^\s*version\s*=\s*"([^"]+)"/m.exec(cargoToml)?.[1];
	assert.equal(cargoVersion, packageJson.version);
});

test('portable executables are not mislabeled as installers', () => {
	assert.doesNotMatch(workflow, /MarkpadInstaller_/);
	assert.match(workflow, /bundle\/nsis.*-setup\.exe/);
});

test('the test bundle command uses an isolated builder', () => {
	assert.equal(packageJson.scripts['build:test-bundle'], 'node scripts/build-test-bundle.mjs');
});

test('the shipped app is built on the Node the tests ran on', () => {
	// build.yml pinned '20' in both of its jobs while test.yml and
	// test_build.yml used lts/*, so the binary users install was produced by a
	// runtime nothing had exercised. Node 20 went end-of-life in April 2026 and
	// left the runner toolcache in May: the v2.7.0 run downloaded 20.20.2 fresh
	// in all five jobs ("Attempting to download 20... Acquiring 20.20.2"), while
	// lts/* is a cache hit.
	//
	// The three files are one fact, so they are asserted against each other
	// rather than against a literal — pinning a specific version here would
	// re-create the drift one level up.
	const expected = [...new Set([...nodeVersions(testWorkflow), ...nodeVersions(testBuildWorkflow)])];
	assert.deepEqual(expected.length, 1, `the test workflows disagree on Node: ${expected.join(', ')}`);
	assert.deepEqual(
		[...new Set(nodeVersions(workflow))],
		expected,
		'build.yml must request the same Node as the workflows that test the code it ships',
	);
});

test('the updater feed publishes the keys an installed Markpad can ask for', () => {
	// tauri-plugin-updater tries `{os}-{arch}-{installer}` and then `{os}-{arch}`,
	// and only tries the first when the binary knows its own bundle type. Ours
	// does not on Windows or Linux — the `__TAURI_BUNDLE_TYPE` patch fails there,
	// three times in the v2.7.0 build. Those clients therefore look up the plain
	// key and nothing else, so a per-installer key added here would be invisible
	// to them, and one added *instead* would strand them on TargetsNotFound.
	const platforms = sliceBetween(workflow, 'platforms: ({', '} | with_entries');
	const keys = [...platforms.matchAll(/"([a-z0-9_-]+)":/g)].map((m) => m[1]);
	assert.ok(keys.length >= 5, `expected the five platform keys, found ${keys.length}`);
	for (const key of keys) {
		assert.match(
			key,
			/^(darwin|windows|linux)-[a-z0-9_]+$/,
			`latest.json key "${key}" carries an installer suffix; Windows and Linux clients ` +
				'cannot ask for one until the missing bundle type is fixed',
		);
	}
});

test('the updater endpoint names the repository RELEASING.md documents', () => {
	// The endpoint is compiled into every installed copy, so getting it wrong is
	// only discoverable by a user who stops being offered updates. It was left
	// on `alecdotdev/Markpad` after the transfer and survived on a GitHub
	// redirect, which RELEASING.md now explains must never be broken. Config and
	// runbook are one fact; if the repository moves again, both move.
	//
	// Matched against the one sentence that states it, not against the document.
	// Measured: "RELEASING.md mentions this repo somewhere" passed with the
	// endpoint reverted to `alecdotdev/Markpad`, because the section warning
	// against recreating that repository necessarily names it.
	const endpoints = tauriConf.plugins.updater.endpoints;
	assert.equal(endpoints.length, 1, 'expected exactly one updater endpoint');
	const repo = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/releases\//.exec(endpoints[0])?.[1];
	assert.ok(repo, `updater endpoint is not a GitHub releases URL: ${endpoints[0]}`);
	const documented = /The updater endpoint in `src-tauri\/tauri\.conf\.json` points at \*\*`([\w.-]+\/[\w.-]+)`\*\*/.exec(
		releasing,
	);
	assert.ok(documented, 'RELEASING.md must state which repository the updater endpoint names');
	assert.equal(
		repo,
		documented[1],
		`tauri.conf.json points the updater at ${repo} while RELEASING.md documents ${documented[1]}`,
	);
});
