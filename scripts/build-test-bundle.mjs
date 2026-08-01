import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const identifier = process.env.MARKPAD_TEST_BUNDLE_ID;

if (!identifier || !identifier.startsWith('dev.') || identifier === 'com.alecdotdev.markpad') {
	throw new Error('Set MARKPAD_TEST_BUNDLE_ID to a non-production identifier beginning with dev.');
}

const config = JSON.stringify({
	identifier,
	productName: 'Markpad 2.7.0 Test',
	bundle: { targets: ['app'], createUpdaterArtifacts: false },
});
const rustRoot = resolve(root, '.local-rust');
const env = {
	...process.env,
	CARGO_HOME: resolve(rustRoot, 'cargo'),
	RUSTUP_HOME: resolve(rustRoot, 'rustup'),
	PATH: `${resolve(rustRoot, 'rustup/toolchains/stable-aarch64-apple-darwin/bin')}:${process.env.PATH}`,
};

execFileSync('npm', ['run', 'tauri', '--', 'build', '--bundles', 'app', '--config', config], {
	cwd: root,
	env,
	stdio: 'inherit',
});

const macosDir = resolve(root, 'src-tauri/target/release/bundle/macos');
const appName = readdirSync(macosDir).find((entry) => entry.endsWith('.app'));
if (!appName) throw new Error('Tauri did not produce a macOS .app bundle.');

const outputDir = resolve(root, 'dist/test-bundle');
const output = resolve(outputDir, appName);
mkdirSync(outputDir, { recursive: true });
rmSync(output, { recursive: true, force: true });
cpSync(resolve(macosDir, appName), output, { recursive: true });
if (!existsSync(output)) throw new Error(`Failed to copy test bundle to ${output}`);
console.log(`Test bundle: ${output}`);
