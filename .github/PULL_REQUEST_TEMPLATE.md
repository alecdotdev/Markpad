<!--
Nothing below is required. These are the sections the merged pull requests here
tend to have, offered so you don't have to reverse-engineer them. Delete any
that don't apply, rename them to say what you actually found, and write prose
rather than filling in fields.
-->

## What this is

What changes, and `Closes #123` if there's an issue. If someone reported it,
say who and where.

## Mechanism

Why the old behaviour happened — the specific line, default or assumption
responsible — rather than what you did about it. If you measured something,
paste the numbers.

## Scope

What you deliberately left alone, and why. Anything you noticed while working
and chose not to fix here belongs in this section too.

## Tests

What you added or changed. For a fix: revert the fix, keep the test, and say
whether it goes red. A test that passes either way isn't testing the fix.

## Verification

The commands you ran and what they said — the ones CI runs are:

```
npm audit
npm run check
npm test
cargo test        # in src-tauri/
```

And what you *didn't* verify: platforms you couldn't try, paths you reasoned
about rather than ran. That's more useful to a reviewer than a list with no
gaps in it.
