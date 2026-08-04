import assert from 'node:assert/strict';
import test from 'node:test';

import { readSource } from './sourceTree.js';

const workflow = readSource('.github/workflows/build.yml');
const snapcraft = readSource('snapcraft.yaml');
const cargoToml = readSource('src-tauri/Cargo.toml');
const packageJson = JSON.parse(readSource('package.json')) as {
	scripts: Record<string, string>;
	version: string;
};

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
