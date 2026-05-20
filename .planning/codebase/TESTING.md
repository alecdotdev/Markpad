# Testing Patterns

**Analysis Date:** 2026-05-20

## Test Framework

**Runner:** None detected

No test framework is installed or configured. Searching for `jest.config.*`, `vitest.config.*`, `*.test.*`, and `*.spec.*` files across the entire repository returns zero results. Neither `jest`, `vitest`, `mocha`, nor any other JavaScript/TypeScript test runner appears in `package.json` dependencies or devDependencies.

**Rust:**
No `#[test]` functions, `#[cfg(test)]` modules, or integration test directories (`src-tauri/tests/`) exist in the Rust codebase.

**Run Commands:**
```bash
# No test commands exist in package.json scripts
# "check" runs type checking only, not tests:
npm run check          # svelte-check type checking
```

The only static analysis available is:
```bash
npm run check          # TypeScript + Svelte type checking via svelte-check
npm run check:watch    # Same in watch mode
```

## Test File Organization

**Location:** Not applicable — no test files exist.

**Naming:** Not applicable.

## Test Structure

No test suites, `describe` blocks, `it` blocks, or `test` blocks exist anywhere in the codebase.

## Mocking

Not applicable — no mocking framework or patterns present.

## Fixtures and Factories

Not applicable — no test data factories or fixture files present.

## Coverage

**Requirements:** None enforced — no coverage tooling configured.

## Test Types

**Unit Tests:** Not present.

**Integration Tests:** Not present.

**E2E Tests:** Not present.

## What Exists Instead of Tests

**Type checking (TypeScript strict mode):**
- `tsconfig.json` enables `strict: true`, catching type errors at compile time
- `svelte-check` runs both TypeScript and Svelte-specific checks

**Manual validation:**
- The `check` script is the only automated quality gate currently in place

**Production safety mechanisms (Rust):**
- `atomic_write` in `src-tauri/src/lib.rs` has extensive inline documentation describing correctness guarantees (symlink resolution, permission preservation, POSIX durability) — correctness is documented but not verified by tests

## Gaps and Risk Areas

The following logic is entirely untested and would benefit from unit tests if a framework is added:

**Rust (`src-tauri/src/lib.rs`):**
- `process_internal_embeds` — regex-based Obsidian embed `![[...]]` parsing
- `process_wikilinks` — wikilink, block-ID, highlight, and inline footnote transformations
- `convert_markdown` — full markdown-to-HTML pipeline including all extensions
- `atomic_write` — file durability across symlink, permission, and concurrent-write scenarios

**TypeScript (`src/lib/utils/markdown.ts`):**
- `resolvePath` — path resolution across Windows/POSIX separators
- `processMarkdownHtml` — post-processing of rendered HTML (YouTube embeds, image rewriting, alerts)

**TypeScript (`src/lib/stores/tabs.svelte.ts`):**
- `TabManager` navigation — `navigate`, `goBack`, `goForward`, history management
- `cycleTab` — wrapping index arithmetic

**TypeScript (`src/lib/stores/settings.svelte.ts`):**
- `parseFontSize` — clamping and NaN guard logic

## Adding Tests (Guidance for Future Work)

**Recommended frontend framework:** Vitest (already in the Vite ecosystem; zero additional config for non-Svelte utilities)

Minimal setup:
```bash
npm install --save-dev vitest
# Add to package.json scripts:
#   "test": "vitest run",
#   "test:watch": "vitest"
```

Example unit test structure for `src/lib/utils/markdown.ts`:
```typescript
// src/lib/utils/markdown.test.ts
import { describe, it, expect } from 'vitest';
import { resolvePath } from './markdown';

describe('resolvePath', () => {
    it('resolves relative paths from base', () => {
        expect(resolvePath('/docs/notes/index.md', 'images/photo.png'))
            .toBe('/docs/notes/images/photo.png');
    });
    it('returns absolute paths unchanged', () => {
        expect(resolvePath('/docs/index.md', '/absolute/path.png'))
            .toBe('/absolute/path.png');
    });
});
```

**Recommended Rust framework:** Built-in `#[cfg(test)]` modules (no extra dependencies)

Minimal example for `src-tauri/src/lib.rs`:
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_process_wikilinks_highlight() {
        let input = "Hello ==world== foo";
        let result = process_wikilinks(input);
        assert!(result.contains("<mark>world</mark>"));
    }
}
```

---

*Testing analysis: 2026-05-20*
