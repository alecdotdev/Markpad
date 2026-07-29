import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const sessionPath = new URL('../src/lib/sessions/documentSession.svelte.ts', import.meta.url);
const session = existsSync(sessionPath) ? readFileSync(sessionPath, 'utf8') : '';

test('large-file completion requires the current clean load revision and unchanged view mode', () => {
	assert.match(session, /const loadRevisionByTab = new Map<string, number>\(\);/);
	assert.match(session, /const fullLoadRevision = \(loadRevisionByTab\.get\(activeId\) \?\? 0\) \+ 1;/);
	assert.match(session, /loadRevisionByTab\.set\(activeId, fullLoadRevision\);/);
	assert.match(
		session,
		/loadRevisionByTab\.get\(activeId\) === fullLoadRevision[\s\S]*!targetTab\.isDirty[\s\S]*targetTab\.isEditing === initialIsEditing[\s\S]*targetTab\.isSplit === initialIsSplit/,
	);
});
