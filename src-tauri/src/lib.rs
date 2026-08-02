use comrak::{markdown_to_html, Anchorizer, ComrakExtensionOptions, ComrakOptions};
use regex::{Captures, Regex};
use std::borrow::Cow;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};

static INTERNAL_EMBED_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?s)!\[\[(.*?)\]\]").unwrap());
static WIKILINK_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?s)\[\[#([^\|\]]+)(?:\|([^\]]+))?\]\]").unwrap());
static BLOCK_ID_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?m)\s+\^([a-zA-Z0-9_-]+)$").unwrap());
static HIGHLIGHT_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"==([^=\n]+)==").unwrap());
static INLINE_FOOTNOTE_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\^\[([^\]]+)\]").unwrap());
static TASK_ITEM_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"<li data-sourcepos="(?<sourcepos>(?<line>\d+):\d+-\d+:\d+)">(?<input><input type="checkbox" disabled=""(?: checked="")? />)"#,
    )
    .unwrap()
});
static TASK_SOURCE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^\s*(?:>\s*)*(?:[-+*]|\d+[.)])\s+\[[ xX]\](?:\s|$)").unwrap()
});

/// Write `bytes` to `target` durably and atomically: write to a sibling temp
/// file, fsync it, then rename over the target. Atomic on both Unix and
/// modern Windows — `std::fs::rename` calls `MoveFileExW` with
/// `MOVEFILE_REPLACE_EXISTING` on Windows since Rust 1.35, so an existing
/// destination is replaced atomically without a dedicated fallback path.
/// Markpad targets Tauri v2 (Rust 1.70+), so we can rely on this everywhere.
///
/// **Other correctness preservations vs. plain `fs::write`:**
/// - **Symlinks:** if `target` is a symlink, follow it to the real file so we
///   replace the linked content rather than the link itself.
/// - **Permissions:** on overwrite, restore the destination's original mode
///   bits after the rename; the temp file otherwise inherits the process
///   umask.
/// - **Read-only targets:** refuse up front. Replacing an inode only needs
///   write permission on the *directory*, so without this check a read-only
///   file (Unix `chmod 444`) would be silently rewritten and then have its
///   read-only bit restored, while Windows' `MoveFileExW` refuses a read-only
///   destination outright — the same document would be writable on one
///   platform and not on another.
/// - **POSIX durability:** on Unix, fsync the parent directory after the
///   rename so the directory entry update survives a crash. Windows NTFS
///   journals this on its own, so no extra step is needed there.
pub(crate) fn atomic_write(target: &Path, bytes: &[u8]) -> std::io::Result<()> {
    // Resolve symlinks so we update the real file. `symlink_metadata` does NOT
    // follow links (unlike `metadata`); if target is a symlink, canonicalize
    // returns the real path it points to. For a non-existent target or a
    // regular file, we keep the original path.
    let resolved: PathBuf = match fs::symlink_metadata(target) {
        Ok(m) if m.file_type().is_symlink() => target.canonicalize()?,
        _ => target.to_path_buf(),
    };
    let target = resolved.as_path();

    // For a relative path with no leading directory (e.g. just "foo.md"),
    // `target.parent()` returns Some("") which is unusable for the temp
    // file. Treat that as the current directory so we can still place the
    // temp alongside the target and keep the rename atomic.
    let parent_path: PathBuf = match target.parent() {
        Some(p) if !p.as_os_str().is_empty() => p.to_path_buf(),
        _ => PathBuf::from("."),
    };

    // Snapshot existing permissions so we can re-apply them after rename.
    // `fs::rename` brings over the temp file's permissions, dropping mode
    // bits / ACLs that the destination had. `None` means "target didn't
    // exist", in which case there's nothing to restore.
    let existing_perms = fs::metadata(target).ok().map(|m| m.permissions());

    // Refuse a read-only destination before creating anything. The rename
    // below swaps the inode, which the target's own mode bits do not guard —
    // only the parent directory's do — so a `chmod 444` file would otherwise
    // be rewritten on Unix while the identical operation fails on Windows.
    if existing_perms.as_ref().is_some_and(|perms| perms.readonly()) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            format!("{} is read-only", target.display()),
        ));
    }

    let file_name = target
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "markpad".to_string());
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let pid = std::process::id();
    let temp_name = format!(".{}.markpad-tmp-{}-{}", file_name, pid, nanos);
    let mut temp_path = parent_path.clone();
    temp_path.push(temp_name);

    let write_result = (|| -> std::io::Result<()> {
        let mut f = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        Ok(())
    })();

    if let Err(e) = write_result {
        let _ = fs::remove_file(&temp_path);
        return Err(e);
    }

    // Atomic on both Unix and modern Windows: std::fs::rename uses
    // `rename(2)` (POSIX) or `MoveFileExW(MOVEFILE_REPLACE_EXISTING)`
    // (Windows since Rust 1.35). The destination is either fully replaced
    // or left untouched — never partially overwritten or missing. If the
    // rename fails (e.g. target locked by another process on Windows),
    // we clean up the temp file and surface the original error without
    // touching the target.
    if let Err(e) = fs::rename(&temp_path, target) {
        let _ = fs::remove_file(&temp_path);
        return Err(e);
    }

    // Best-effort restore of the original mode bits. If this fails (e.g. the
    // filesystem doesn't support it, or the user lacks privileges), the file
    // contents are still correctly written, so we don't surface the error.
    if let Some(perms) = existing_perms {
        let _ = fs::set_permissions(target, perms);
    }

    // POSIX durability: a rename is not durable until the parent directory's
    // metadata is also flushed to disk. Without this, a crash right after
    // rename could leave the target missing or pointing at the old inode.
    // Windows doesn't expose directory fsync semantics — its NTFS journal
    // already handles this, so we skip the call there.
    #[cfg(unix)]
    {
        if let Ok(dir) = fs::File::open(&parent_path) {
            let _ = dir.sync_all();
        }
    }

    Ok(())
}

/// Decode `bytes` as UTF-8, substituting U+FFFD for invalid sequences rather
/// than rejecting the whole file. `read_to_string` refuses a document on its
/// first invalid byte, which made a legacy-encoded (GBK/Big5/Shift-JIS) file
/// openable or not purely by size: the truncated-preview path has always
/// decoded leniently, so the same file failed at 50 KB and succeeded at
/// 51 KB. Every read path now uses one decoder.
fn decode_utf8_lossy(bytes: Vec<u8>) -> String {
    match String::from_utf8(bytes) {
        Ok(text) => text,
        Err(error) => String::from_utf8_lossy(error.as_bytes()).into_owned(),
    }
}

fn read_to_string_lossy(path: &str) -> std::io::Result<String> {
    Ok(decode_utf8_lossy(fs::read(path)?))
}

/// Length of `bytes` with an incomplete trailing UTF-8 sequence removed.
/// Truncating a file at a raw byte offset can split a multi-byte character;
/// dropping the partial tail keeps the preview from ending in a replacement
/// character. Only the tail is inspected — a file that is not UTF-8 at all
/// must still produce a full-length (lossy) preview, so earlier bytes are
/// left alone.
fn utf8_truncation_boundary(bytes: &[u8]) -> usize {
    let len = bytes.len();
    // A UTF-8 sequence is at most four bytes, so at most three trailing bytes
    // can belong to an unfinished one.
    for back in 1..=3.min(len) {
        let index = len - back;
        let byte = bytes[index];
        if byte & 0b1100_0000 == 0b1000_0000 {
            // Continuation byte; keep walking left for its lead byte.
            continue;
        }
        let needed = if byte & 0b1000_0000 == 0 {
            1
        } else if byte & 0b1110_0000 == 0b1100_0000 {
            2
        } else if byte & 0b1111_0000 == 0b1110_0000 {
            3
        } else if byte & 0b1111_1000 == 0b1111_0000 {
            4
        } else {
            // Not a valid lead byte, so this is not a split character.
            return len;
        };
        return if back < needed { index } else { len };
    }
    len
}

/// HTML-escapes `value` for use inside a double-quoted attribute. Embed
/// rewriting builds `<img …>` by string concatenation, so an unescaped quote
/// in a wikilink target (`![[a" onerror="…]]`) would break out of the
/// attribute. The in-app viewer sanitizes with DOMPurify, but the HTML export
/// path writes this markup straight to disk.
fn escape_html_attribute(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '&' => escaped.push_str("&amp;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&#39;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            _ => escaped.push(character),
        }
    }
    escaped
}

/// The anchor id comrak assigns to a heading with this text. We call comrak's
/// own `Anchorizer` rather than re-implementing its rules (lowercase, strip
/// everything outside letters/marks/numbers/underscore/space/hyphen, spaces
/// to hyphens), so a comrak upgrade cannot silently desynchronize wikilink
/// targets from the ids actually rendered into the document.
///
/// A fresh anchorizer is used per lookup on purpose: its duplicate handling
/// appends `-1`, `-2`, … per *document*, and a link target can only ever
/// address the first heading with a given text.
fn heading_anchor_id(target: &str) -> String {
    Anchorizer::new().anchorize(target.to_string())
}

fn safe_path_component<'a>(value: &'a str, label: &str) -> Result<&'a str, String> {
    if value.is_empty()
        || value == "."
        || value == ".."
        || value.contains(['/', '\\'])
        || Path::new(value).is_absolute()
    {
        return Err(format!("Invalid {}", label));
    }
    Ok(value)
}

fn resolve_image_directory(parent_dir: &str, image_directory: &str) -> Result<(PathBuf, PathBuf), String> {
    let root = Path::new(parent_dir)
        .canonicalize()
        .map_err(|e| format!("Invalid image parent directory: {}", e))?;
    let requested_dir = if image_directory.is_empty() {
        root.clone()
    } else {
        root.join(safe_path_component(image_directory, "image directory")?)
    };

    fs::create_dir_all(&requested_dir).map_err(|e| e.to_string())?;
    let image_dir = requested_dir.canonicalize().map_err(|e| e.to_string())?;
    if !image_dir.starts_with(&root) {
        return Err("Image directory must remain inside the document directory".to_string());
    }
    Ok((root, image_dir))
}

fn ensure_path_within_root(root: &Path, path: &Path) -> Result<(), String> {
    let resolved = match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => path.canonicalize().map_err(|e| e.to_string())?,
        _ => path.to_path_buf(),
    };
    if resolved.starts_with(root) {
        Ok(())
    } else {
        Err("Image path must remain inside the document directory".to_string())
    }
}

const MAX_VSIX_DOWNLOAD_BYTES: usize = 20 * 1024 * 1024;
const MAX_VSIX_ENTRIES: usize = 10_000;
const MAX_VSIX_UNCOMPRESSED_BYTES: u64 = 100 * 1024 * 1024;
const MAX_THEME_JSON_BYTES: u64 = 2 * 1024 * 1024;
const VSIX_CONNECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);
const VSIX_REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);

/// Reads a VSIX entry as text under a hard byte ceiling.
///
/// The `size()` checks elsewhere use the size the archive *declares* in its
/// central directory, which a hostile file is free to understate — the zip
/// reader only bounds the *compressed* stream, so a small entry claiming to
/// be 1 KB can still inflate without limit. Reading through `take` makes the
/// ceiling apply to the bytes actually produced.
fn read_zip_entry_to_string<R: std::io::Read>(entry: R, limit: u64) -> Result<String, String> {
    use std::io::Read;
    let mut text = String::new();
    entry
        .take(limit + 1)
        .read_to_string(&mut text)
        .map_err(|e| e.to_string())?;
    if text.len() as u64 > limit {
        return Err("VSIX entry exceeds the allowed size".to_string());
    }
    Ok(text)
}

fn validate_vsix_archive_limits<R: std::io::Read + std::io::Seek>(
    archive: &mut zip::ZipArchive<R>,
) -> Result<(), String> {
    if archive.len() > MAX_VSIX_ENTRIES {
        return Err("VSIX contains too many files".to_string());
    }

    let mut total_size = 0_u64;
    for index in 0..archive.len() {
        let file = archive.by_index(index).map_err(|e| e.to_string())?;
        total_size = total_size
            .checked_add(file.size())
            .ok_or("VSIX uncompressed size overflow")?;
        if total_size > MAX_VSIX_UNCOMPRESSED_BYTES {
            return Err("VSIX expands beyond the allowed size".to_string());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(tag: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("markpad-{tag}-{nonce}"))
    }

    #[test]
    fn atomic_write_refuses_a_read_only_target() {
        // Replacing an inode by rename only needs write permission on the
        // parent directory, so without an explicit check a `chmod 444` file
        // would be rewritten on Unix and its read-only bit put back, while
        // Windows' MoveFileExW refuses the same operation.
        let path = temp_path("readonly");
        fs::write(&path, b"original").unwrap();
        let mut perms = fs::metadata(&path).unwrap().permissions();
        perms.set_readonly(true);
        fs::set_permissions(&path, perms).unwrap();

        let error = atomic_write(&path, b"replacement")
            .expect_err("a read-only target must be refused, not silently replaced");
        assert_eq!(error.kind(), std::io::ErrorKind::PermissionDenied);
        assert_eq!(fs::read(&path).unwrap(), b"original");

        // Deleting needs write permission on the directory rather than the
        // file, so Unix needs no permission restore here; Windows refuses to
        // delete a file that still carries the read-only attribute.
        #[cfg(windows)]
        {
            let mut perms = fs::metadata(&path).unwrap().permissions();
            #[allow(clippy::permissions_set_readonly_false)]
            perms.set_readonly(false);
            fs::set_permissions(&path, perms).unwrap();
        }
        fs::remove_file(&path).unwrap();
    }

    #[test]
    fn atomic_write_replaces_the_target_and_leaves_no_temp_file() {
        let dir = temp_path("atomic-dir");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("session.json");
        fs::write(&path, b"{\"old\":true}").unwrap();

        atomic_write(&path, b"{\"new\":true}").unwrap();

        assert_eq!(fs::read(&path).unwrap(), b"{\"new\":true}");
        let leftovers: Vec<String> = fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| name.contains("markpad-tmp"))
            .collect();
        assert!(leftovers.is_empty(), "temp files left behind: {leftovers:?}");

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn every_read_path_decodes_legacy_encodings_leniently() {
        // "中文" in GBK. `read_to_string` rejects the whole document on the
        // first invalid byte, so the same file used to open or fail purely by
        // size: the truncated-preview branch has always decoded leniently.
        let gbk = [0xD6u8, 0xD0, 0xCE, 0xC4];
        assert!(String::from_utf8(gbk.to_vec()).is_err());

        let path = temp_path("gbk.txt");
        fs::write(&path, gbk).unwrap();
        assert!(
            fs::read_to_string(&path).is_err(),
            "strict decoding is expected to reject these bytes",
        );

        let decoded = read_to_string_lossy(path.to_str().unwrap())
            .expect("lenient decoding must open the file instead of failing");
        assert!(decoded.contains('\u{FFFD}'), "got: {decoded:?}");

        fs::remove_file(path).unwrap();
    }

    #[test]
    fn truncation_boundary_drops_only_a_split_trailing_character() {
        assert_eq!(utf8_truncation_boundary(&[]), 0);
        assert_eq!(utf8_truncation_boundary(b"ab"), 2);

        let three_byte = "中".as_bytes();
        assert_eq!(utf8_truncation_boundary(three_byte), 3);
        assert_eq!(utf8_truncation_boundary(&three_byte[..2]), 0);
        assert_eq!(utf8_truncation_boundary(&three_byte[..1]), 0);

        let four_byte = "🙂".as_bytes();
        assert_eq!(utf8_truncation_boundary(four_byte), 4);
        assert_eq!(utf8_truncation_boundary(&four_byte[..3]), 0);

        // Only the tail is affected; earlier bytes are kept.
        let mixed = "ab中".as_bytes();
        assert_eq!(utf8_truncation_boundary(&mixed[..4]), 2);

        // A buffer that is not UTF-8 at all must still yield a full-length
        // preview; at most the last three bytes can ever be dropped.
        let gbk = [0xD6u8, 0xD0, 0xCE, 0xC4];
        assert!(utf8_truncation_boundary(&gbk) >= gbk.len() - 3);
    }

    #[test]
    fn zip_entry_reads_stop_at_the_limit_even_when_the_header_understates_size() {
        let payload = vec![b'a'; 64];
        assert_eq!(
            read_zip_entry_to_string(payload.as_slice(), 64).unwrap().len(),
            64,
        );
        assert!(
            read_zip_entry_to_string(payload.as_slice(), 32).is_err(),
            "an entry larger than the ceiling must be rejected, not buffered",
        );
    }

    #[test]
    fn export_data_url_uses_mime_from_extension_case_insensitively() {
        assert_eq!(mime_type_for_export_path(Path::new("diagram.PNG")), "image/png");
        assert_eq!(mime_type_for_export_path(Path::new("photo.JpEg")), "image/jpeg");
        assert_eq!(mime_type_for_export_path(Path::new("vector.svg")), "image/svg+xml");
        assert_eq!(mime_type_for_export_path(Path::new("unknown.bin")), "application/octet-stream");
    }

    #[test]
    fn export_data_url_encodes_bytes_with_mime() {
        assert_eq!(
            file_bytes_to_data_url("image/png", b"Markpad"),
            "data:image/png;base64,TWFya3BhZA==",
        );
    }

    #[test]
    fn task_list_checkbox_is_emitted_at_the_start_of_its_list_item() {
        let html = convert_markdown("- [ ] open task\n- [x] completed task\n");
        assert!(
            html.contains("<li data-sourcepos=\"1:1-1:15\"><input type=\"checkbox\" data-task-checkbox=\"\" disabled=\"\" /> open task</li>"),
            "unexpected task-list HTML: {html}",
        );
        assert!(
            html.contains("<li data-sourcepos=\"2:1-2:20\"><input type=\"checkbox\" data-task-checkbox=\"\" disabled=\"\" checked=\"\" /> completed task</li>"),
            "unexpected task-list HTML: {html}",
        );
    }

    #[test]
    fn raw_html_checkboxes_are_not_marked_as_tasks() {
        let html = convert_markdown("- <input type=\"checkbox\" /> raw control\n");
        assert!(
            !html.contains("data-task-checkbox"),
            "raw HTML control was incorrectly marked as a task: {html}",
        );
    }

    #[test]
    fn nested_and_quoted_task_checkboxes_are_marked() {
        let html = convert_markdown("- [ ] parent\n  - [x] nested\n\n> - [ ] quoted\n");
        assert_eq!(
            html.matches("data-task-checkbox").count(),
            3,
            "unexpected task-list HTML: {html}",
        );
    }

    #[test]
    fn markdown_protocol_preserves_task_markers_for_many_source_lines() {
        let markdown = (1..=64)
            .map(|line| match line % 3 {
                0 => format!("> - [ ] quoted task {line}"),
                1 => format!("- [ ] task {line}"),
                _ => format!("  - [x] nested task {line}"),
            })
            .collect::<Vec<_>>()
            .join("\n");

        let html = convert_markdown(&markdown);
        assert_eq!(html.matches("data-task-checkbox").count(), 64, "{html}");
        assert!(html.contains("data-sourcepos=\"64:1-64:"), "{html}");
    }

    #[test]
    fn multiline_wikilinks_do_not_shift_task_source_positions() {
        let html = convert_markdown("[[#first\nsecond|alias]]\n- [ ] task\n");
        assert!(
            html.contains("data-task-checkbox"),
            "task source position was shifted by a multiline wikilink: {html}",
        );
    }

    #[test]
    fn embed_protection_survives_longer_backtick_runs_earlier_in_the_doc() {
        // A 4-backtick inline sample desynchronized the old regex pairing and
        // exposed every later code span to rewriting.
        let input = "```` ```mermaid ```` fence sample\n\ncode: `![[not-an-embed.md]]`\n";
        let out = process_internal_embeds(input);
        assert!(out.contains("`![[not-an-embed.md]]`"), "got: {out}");
        assert!(!out.contains("<img"), "got: {out}");
    }

    #[test]
    fn embeds_inside_tilde_fences_are_protected() {
        // The old pattern only knew ``` fences; ~~~ was not protected at all.
        let input = "~~~\n![[inside.md]]\n~~~\n\n![[outside.md]]\n";
        let out = process_internal_embeds(input);
        assert!(out.contains("![[inside.md]]"), "got: {out}");
        assert!(out.contains("<img src=\"outside.md\""), "got: {out}");
    }

    #[test]
    fn fence_closes_only_on_a_run_at_least_as_long() {
        let input = "````\n```\n![[still-code.md]]\n````\n![[after.md]]\n";
        let out = process_internal_embeds(input);
        assert!(out.contains("![[still-code.md]]"), "got: {out}");
        assert!(out.contains("<img src=\"after.md\""), "got: {out}");
    }

    #[test]
    fn unclosed_fence_protects_to_end_of_input() {
        let input = "```\n![[never-closed.md]]\n";
        let out = process_internal_embeds(input);
        assert!(out.contains("![[never-closed.md]]"), "got: {out}");
    }

    #[test]
    fn double_backtick_span_pairs_only_with_double_backticks() {
        // `` a ` b `` is ONE span; the inner single backtick does not close it.
        let input = "`` a ` ![[in-span.md]] `` then ![[outside.md]]\n";
        let out = process_internal_embeds(input);
        assert!(out.contains("![[in-span.md]]"), "got: {out}");
        assert!(out.contains("<img src=\"outside.md\""), "got: {out}");
    }

    #[test]
    fn embeds_outside_code_are_still_rewritten_with_sizes() {
        let out = process_internal_embeds("![[pic.png|300x200]]\n");
        assert!(out.contains("width=\"300\""), "got: {out}");
        assert!(out.contains("height=\"200\""), "got: {out}");
    }

    #[test]
    fn highlight_protection_survives_quadruple_backtick_inline_code() {
        let input = "```` ``` ```` intro\n\n`==not highlighted==` but ==this is==\n";
        let out = process_wikilinks(input);
        assert!(out.contains("`==not highlighted==`"), "got: {out}");
        assert!(out.contains("<mark>this is</mark>"), "got: {out}");
    }

    #[test]
    fn wikilinks_and_inline_footnotes_in_code_spans_stay_literal() {
        let input = "`[[#heading]]` and `^[not a footnote]` but [[#real|jump]]\n";
        let out = process_wikilinks(input);
        assert!(out.contains("`[[#heading]]`"), "got: {out}");
        assert!(out.contains("`^[not a footnote]`"), "got: {out}");
        assert!(out.contains("[jump](#real)"), "got: {out}");
    }

    #[test]
    fn multibyte_content_inside_a_fence_does_not_panic() {
        let input = "```text\n中文开头的一行\n```\n\n![[outside.png]]\n";
        let result = std::panic::catch_unwind(|| process_internal_embeds(input));

        let out = result.expect("fenced multibyte content must not panic");
        assert!(out.contains("中文开头的一行"), "got: {out}");
        assert!(out.contains("<img src=\"outside.png\""), "got: {out}");
    }

    #[test]
    fn autolink_inside_parentheses_stops_before_adjacent_text() {
        let input = "See (https://www.speedtest.net/awards/united_states/)for more information.";
        let html = convert_markdown(input);

        assert!(
            html.contains("href=\"https://www.speedtest.net/awards/united_states/\""),
            "got: {html}"
        );
        assert!(html.contains(")for more information."), "got: {html}");
        assert!(
            !html.contains("href=\"https://www.speedtest.net/awards/united_states/)for\""),
            "got: {html}"
        );
    }

    #[test]
    fn path_components_reject_traversal_separators_and_absolute_paths() {
        for invalid in ["", ".", "..", "../theme", "folder/theme", "folder\\theme", "/tmp/theme"] {
            assert!(safe_path_component(invalid, "test").is_err(), "{invalid}");
        }
        assert_eq!(safe_path_component("SynthWave '84", "test").unwrap(), "SynthWave '84");
    }

    #[cfg(unix)]
    #[test]
    fn image_directory_rejects_symlink_escape() {
        use std::os::unix::fs::symlink;

        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("markpad-path-root-{nonce}"));
        let outside = std::env::temp_dir().join(format!("markpad-path-outside-{nonce}"));
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&outside).unwrap();
        symlink(&outside, root.join("images")).unwrap();

        assert!(resolve_image_directory(root.to_str().unwrap(), "images").is_err());

        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }

    #[test]
    fn theme_slug_collapses_punctuation_runs() {
        assert_eq!(theme_slug("SynthWave '84"), "synthwave-84");
    }

    #[test]
    fn display_math_keeps_multiple_braced_subscripts_out_of_markdown_emphasis() {
        let html = convert_markdown("$$\\bar{b}_{1} + \\bar{b}_{2}$$\n");
        assert!(
            html.contains("$$\\bar{b}_{1} + \\bar{b}_{2}$$"),
            "unexpected parser output: {html}",
        );
        assert!(!html.contains("<em"), "unexpected parser output: {html}");
    }

    #[test]
    fn display_math_underscore_protection_preserves_escaped_underscores() {
        assert_eq!(
            protect_display_math_underscores("outside_a $$x\\_y_z$$ outside_b"),
            format!("outside_a $$x\\{DISPLAY_MATH_UNDERSCORE_SENTINEL}y{DISPLAY_MATH_UNDERSCORE_SENTINEL}z$$ outside_b"),
        );
    }

    #[test]
    fn a_stray_backtick_does_not_swallow_later_paragraphs() {
        // CommonMark parses inline elements per block and a blank line ends a
        // block, so the loose backtick in the first paragraph cannot pair with
        // the opening backtick of `run()` two paragraphs down.
        let input =
            "Use the ` character to start code.\n\n![[photo.png]]\n\nThen `run()` finishes.\n";

        let out = process_internal_embeds(input);
        assert!(out.contains("<img src=\"photo.png\""), "got: {out}");
        assert!(out.contains("`run()`"), "got: {out}");
    }

    #[test]
    fn a_stray_backtick_does_not_swallow_later_highlights_or_wikilinks() {
        let input = "Use the ` character.\n\n==important== and [[#Some Heading|jump]]\n\nThen `run()` finishes.\n";

        let out = process_wikilinks(input);
        assert!(out.contains("<mark>important</mark>"), "got: {out}");
        assert!(out.contains("(#some-heading)"), "got: {out}");
    }

    #[test]
    fn inline_code_spans_still_pair_across_lines_inside_one_paragraph() {
        // A code span may legitimately span several lines of the same block;
        // the blank-line reset must not break that.
        let input = "start `code\n![[inside.png]]` end\n";
        let out = process_internal_embeds(input);
        assert!(out.contains("![[inside.png]]"), "got: {out}");
        assert!(!out.contains("<img"), "got: {out}");
    }

    #[test]
    fn embed_attributes_are_html_escaped() {
        // The viewer sanitizes with DOMPurify, but the HTML export path writes
        // this markup straight to disk, so the quote has to die here.
        let out = process_internal_embeds("![[a\" onerror=\"alert(1)]]\n");
        assert!(!out.contains("onerror=\""), "attribute injection: {out}");
        assert!(out.contains("&quot;"), "got: {out}");

        let sized = process_internal_embeds("![[p.png|300\" onload=\"x]]\n");
        assert!(!sized.contains("onload=\""), "attribute injection: {sized}");

        let single = process_internal_embeds("![[p.png|64\" onload=\"y]]\n");
        assert!(!single.contains("onload=\""), "attribute injection: {single}");
    }

    #[test]
    fn embed_attribute_escaping_keeps_ordinary_paths_readable() {
        let out = process_internal_embeds("![[my photo.png]]\n");
        assert!(out.contains("src=\"my%20photo.png\""), "got: {out}");
        assert!(out.contains("alt=\"my photo.png\""), "got: {out}");
    }

    #[test]
    fn wikilink_anchors_match_the_ids_comrak_actually_renders() {
        // Asserted against comrak's real output rather than a copy of its
        // rules: if a comrak upgrade changes anchorization, this fails instead
        // of silently producing wikilinks that jump nowhere.
        for heading in [
            "1. 概述",
            "Ticks aren't in",
            "Hello, World!",
            "Setup & Teardown",
            "under_score here",
        ] {
            let html = convert_markdown(&format!("## {heading}\n"));
            let rendered_id = html
                .split("id=\"")
                .nth(1)
                .and_then(|rest| rest.split('"').next())
                .unwrap_or_else(|| panic!("no heading id rendered: {html}"));
            assert_eq!(
                heading_anchor_id(heading),
                rendered_id,
                "anchor for {heading:?} drifted from comrak: {html}",
            );
        }
    }

    #[test]
    fn wikilink_targets_survive_punctuation_in_the_heading() {
        // "1. 概述" used to become "1.-概述" while comrak rendered "1-概述",
        // so the link resolved to nothing.
        assert_eq!(heading_anchor_id("1. 概述"), "1-概述");

        let out = process_wikilinks("[[#1. 概述|Overview]]\n");
        assert!(out.contains("[Overview](#1-概述)"), "got: {out}");
    }

    #[test]
    fn multiline_wikilinks_are_left_literal() {
        // A heading id can never contain a newline, so such a target cannot
        // resolve; rewriting it would also collapse two source lines into one
        // and shift every task checkbox below it.
        let out = process_wikilinks("[[#first\nsecond|alias]]\n");
        assert!(out.contains("[[#first\nsecond|alias]]"), "got: {out}");
    }

    #[test]
    fn attribute_escaping_covers_the_html_metacharacters() {
        assert_eq!(
            escape_html_attribute("a\"b'c&d<e>f"),
            "a&quot;b&#39;c&amp;d&lt;e&gt;f",
        );
        assert_eq!(escape_html_attribute("plain.png"), "plain.png");
    }
}

mod setup;
mod tab_transfer;
mod window_runtime;
use window_runtime::{AppState, WatcherState};

#[tauri::command]
async fn show_window(window: tauri::Window) {
    window_runtime::show_window(window).await;
}

#[tauri::command]
fn save_window_state(app: AppHandle, json: String) -> Result<(), String> {
    window_runtime::save_window_state(app, json)
}

#[tauri::command]
fn load_window_state(app: AppHandle) -> Option<String> {
    window_runtime::load_window_state(app)
}

#[tauri::command]
fn clear_window_state(app: AppHandle) -> Result<(), String> {
    window_runtime::clear_window_state(app)
}

#[tauri::command]
fn set_window_meta(
    window: tauri::Window,
    state: State<'_, AppState>,
    tag_name: Option<String>,
    tag_color: Option<String>,
    active_tab_title: String,
    tab_count: usize,
) {
    window_runtime::set_window_meta(window, state, tag_name, tag_color, active_tab_title, tab_count)
}

#[tauri::command]
fn list_viewer_windows(state: State<'_, AppState>) -> Vec<window_runtime::WindowListEntry> {
    window_runtime::list_viewer_windows(state)
}

#[tauri::command]
fn offer_tab_to_window(app: AppHandle, target_label: String, token: String) -> Result<(), String> {
    window_runtime::offer_tab_to_window(app, target_label, token)
}

#[tauri::command]
fn focus_window(app: AppHandle, label: String) -> Result<(), String> {
    window_runtime::focus_window(app, label)
}

#[tauri::command]
fn list_pinned_tags(app: AppHandle) -> Vec<window_runtime::PinnedTag> {
    window_runtime::list_pinned_tags(app)
}

#[tauri::command]
fn save_pinned_tag(app: AppHandle, name: String, color: String, files: Vec<String>) -> Result<(), String> {
    window_runtime::save_pinned_tag(app, name, color, files)
}

#[tauri::command]
fn remove_pinned_tag(app: AppHandle, name: String) -> Result<(), String> {
    window_runtime::remove_pinned_tag(app, name)
}

/// Byte ranges of code regions — fenced code blocks and inline code spans —
/// paired with CommonMark's rules. The regex alternation previously used for
/// protection (```` ```.*?```|`.*?` ````) cannot express them: a fence closes
/// only on a line-leading run of the same character at least as long as the
/// opener, and a span opened by N backticks closes only on a run of exactly
/// N. One mismatched pairing (e.g. a 4-backtick inline sample, or a ~~~
/// fence, which the old pattern did not know at all) desynchronized the
/// protection for the entire rest of the document.
fn code_region_ranges(content: &str) -> Vec<(usize, usize)> {
    let len = content.len();
    let mut regions: Vec<(usize, usize)> = Vec::new();
    let mut plain_segments: Vec<(usize, usize)> = Vec::new();
    // (fence char, opener run length, region start)
    let mut fence: Option<(u8, usize, usize)> = None;
    let mut seg_start = 0usize;

    let mut line_start = 0usize;
    while line_start < len {
        let line_end = content[line_start..]
            .find('\n')
            .map(|i| line_start + i + 1)
            .unwrap_or(len);
        let line = &content[line_start..line_end];
        let trimmed = line.trim_start_matches(' ');
        let indent = line.len() - trimmed.len();
        let marker = trimmed.as_bytes().first().copied();
        let run_len = trimmed
            .as_bytes()
            .iter()
            .take_while(|&&b| Some(b) == marker)
            .count();
        let is_fence_line = indent <= 3
            && matches!(marker, Some(b'`') | Some(b'~'))
            && run_len >= 3;

        match fence {
            Some((ch, opener_len, start)) => {
                if is_fence_line
                    && marker == Some(ch)
                    && run_len >= opener_len
                    && trimmed[run_len..].trim().is_empty()
                {
                    regions.push((start, line_end));
                    fence = None;
                    seg_start = line_end;
                }
            }
            None => {
                // The info string of a backtick fence may not contain backticks.
                let info_ok = marker != Some(b'`') || !trimmed[run_len..].contains('`');
                if is_fence_line && info_ok {
                    if seg_start < line_start {
                        plain_segments.push((seg_start, line_start));
                    }
                    fence = Some((marker.unwrap(), run_len, line_start));
                }
            }
        }
        line_start = line_end;
    }
    match fence {
        // An unclosed fence runs to the end of the input.
        Some((_, _, start)) => regions.push((start, len)),
        None => {
            if seg_start < len {
                plain_segments.push((seg_start, len));
            }
        }
    }

    // Inline code spans in the text between fences. CommonMark parses inline
    // elements one block at a time and a blank line ends a block, so pairing
    // is confined to each blank-line-delimited chunk: a stray backtick in
    // prose must not open a span that runs on until the opening backtick of a
    // real code span paragraphs later, suppressing every embed, wikilink and
    // highlight in between.
    for (seg_s, seg_e) in plain_segments {
        let mut chunk_start = seg_s;
        let mut line_start = seg_s;
        while line_start < seg_e {
            let line_end = content[line_start..seg_e]
                .find('\n')
                .map(|i| line_start + i + 1)
                .unwrap_or(seg_e);
            if content[line_start..line_end].trim().is_empty() {
                pair_inline_code_runs(content, chunk_start, line_start, &mut regions);
                chunk_start = line_end;
            }
            line_start = line_end;
        }
        pair_inline_code_runs(content, chunk_start, seg_e, &mut regions);
    }

    regions.sort_unstable();
    regions
}

/// Records the inline code spans inside `content[start..end]`, which must be
/// a single block's worth of text. A run of N backticks pairs with the next
/// run of exactly N; runs that never pair are literal text.
fn pair_inline_code_runs(content: &str, start: usize, end: usize, regions: &mut Vec<(usize, usize)>) {
    let chunk = &content.as_bytes()[start..end];
    let mut runs: Vec<(usize, usize)> = Vec::new(); // (offset in chunk, len)
    let mut i = 0usize;
    while i < chunk.len() {
        if chunk[i] == b'`' {
            let run_start = i;
            while i < chunk.len() && chunk[i] == b'`' {
                i += 1;
            }
            runs.push((run_start, i - run_start));
        } else {
            i += 1;
        }
    }

    let mut r = 0usize;
    while r < runs.len() {
        let (open_start, open_len) = runs[r];
        if let Some(close) = (r + 1..runs.len()).find(|&j| runs[j].1 == open_len) {
            let (close_start, close_len) = runs[close];
            regions.push((start + open_start, start + close_start + close_len));
            r = close + 1;
        } else {
            r += 1;
        }
    }
}

fn in_code_region(regions: &[(usize, usize)], pos: usize) -> bool {
    regions
        .binary_search_by(|&(s, e)| {
            if pos < s {
                std::cmp::Ordering::Greater
            } else if pos >= e {
                std::cmp::Ordering::Less
            } else {
                std::cmp::Ordering::Equal
            }
        })
        .is_ok()
}

/// Picks the viewer window that should receive an externally opened file:
/// the focused viewer if any, else the viewer the user focused most
/// recently, else any viewer. The middle rung matters for Finder opens —
/// Finder is frontmost at that moment, so is_focused() is false for every
/// Markpad window and delivery would otherwise degrade to arbitrary map
/// order. Viewer windows are "main" and detached "window-*" windows;
/// "installer" never receives files.
fn pick_delivery_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    window_runtime::pick_delivery_window(app)
}

/// Creates the destination window for a tab transfer. The window's label
/// embeds the transfer token ("window-<token>"), so the new frontend can
/// derive which pending transfer to claim from its own label — no URL
/// query involved (the asset protocol 404s on "index.html?x=y" paths).
/// Deliberately async. `WebviewWindowBuilder::build()` deadlocks on Windows
/// when it runs inside a synchronous command: WebView2 needs the main thread
/// to pump messages while the webview is created, but a sync command IS the
/// main thread, blocked waiting for build() to return. The whole app then
/// freezes — no new window, no menus, an unresponsive close button
/// (tauri-apps/tauri#12521). An async command runs off the event loop, and
/// Tauri dispatches the actual window creation to the main thread itself, so
/// macOS's main-thread requirement is still satisfied.
#[tauri::command]
async fn create_transfer_window(app: AppHandle, token: String) -> Result<(), String> {
    window_runtime::create_transfer_window(app, token)
}

fn process_internal_embeds(content: &str) -> Cow<'_, str> {
    let regions = code_region_ranges(content);

    INTERNAL_EMBED_RE.replace_all(content, |caps: &Captures| {
        let full = caps.get(0).unwrap();
        if in_code_region(&regions, full.start()) {
            return full.as_str().to_string();
        }

        let inner = caps.get(1).map(|m| m.as_str()).unwrap_or("");
        let mut parts = inner.split('|');
        let path = parts.next().unwrap_or("");
        let size = parts.next();

        // Every interpolated value is HTML-escaped: the target comes straight
        // from the document, so a quote in it would otherwise close the
        // attribute and let the rest be read as markup.
        let src = escape_html_attribute(&path.replace(" ", "%20"));
        let alt = escape_html_attribute(path);

        if let Some(size_str) = size {
            if size_str.contains('x') {
                let mut dims = size_str.split('x');
                let width = escape_html_attribute(dims.next().unwrap_or(""));
                let height = escape_html_attribute(dims.next().unwrap_or(""));
                format!(
                    "<img src=\"{}\" width=\"{}\" height=\"{}\" alt=\"{}\" />",
                    src, width, height, alt
                )
            } else {
                format!(
                    "<img src=\"{}\" width=\"{}\" alt=\"{}\" />",
                    src,
                    escape_html_attribute(size_str),
                    alt
                )
            }
        } else {
            format!("<img src=\"{}\" alt=\"{}\" />", src, alt)
        }
    })
}

fn process_wikilinks<'a>(content: &'a str) -> Cow<'a, str> {
    let mut processed = Cow::Borrowed(content);

    // 1. Process [[#target]] or [[#target|alias]]
    if WIKILINK_RE.is_match(&processed) {
        let regions = code_region_ranges(&processed);
        let replaced = WIKILINK_RE.replace_all(&processed, |caps: &Captures| {
            let full = caps.get(0).unwrap();
            if in_code_region(&regions, full.start()) {
                return full.as_str().to_string();
            }
            // The pattern is line-agnostic, but a heading id never contains a
            // newline, so a target spanning lines can never resolve. Leaving
            // it literal also keeps the line count stable — rewriting it to a
            // single-line id would shift the source positions of every task
            // checkbox below it (see
            // `multiline_wikilinks_do_not_shift_task_source_positions`).
            if full.as_str().contains('\n') {
                return full.as_str().to_string();
            }
            let target = caps.get(1).map(|m| m.as_str()).unwrap_or("");
            let alias = caps.get(2).map(|m| m.as_str()).unwrap_or(target);
            format!("[{}](#{})", alias, heading_anchor_id(target))
        });
        processed = Cow::Owned(replaced.into_owned());
    }

    // 2. Process ^block-id at the end of lines
    // For block IDs, they are trailing. We skip code blocks but also need to be careful with inline code at EOL.
    if BLOCK_ID_RE.is_match(&processed) {
        let regions = code_region_ranges(&processed);
        let replaced = BLOCK_ID_RE.replace_all(&processed, |caps: &Captures| {
            let full = caps.get(0).unwrap();
            if in_code_region(&regions, full.start()) {
                return full.as_str().to_string();
            }
            let id = caps.get(1).map(|m| m.as_str()).unwrap_or("");
            format!(
                " <a id=\"{}\" class=\"block-id-anchor\" data-label=\"{}\"></a>",
                id, id
            )
        });
        processed = Cow::Owned(replaced.into_owned());
    }

    // 3. Convert ==highlight== to <mark>highlight</mark>
    if HIGHLIGHT_RE.is_match(&processed) {
        let regions = code_region_ranges(&processed);
        let replaced = HIGHLIGHT_RE.replace_all(&processed, |caps: &Captures| {
            let full = caps.get(0).unwrap();
            if in_code_region(&regions, full.start()) {
                return full.as_str().to_string();
            }
            format!("<mark>{}</mark>", caps.get(1).unwrap().as_str())
        });
        processed = Cow::Owned(replaced.into_owned());
    }

    // 4. Convert ^[inline footnote] to a footnote reference
    if INLINE_FOOTNOTE_RE.is_match(&processed) {
        let regions = code_region_ranges(&processed);
        let mut footnote_defs = String::new();
        let mut fn_count = 0usize;
        let replaced = INLINE_FOOTNOTE_RE.replace_all(&processed, |caps: &Captures| {
            let full = caps.get(0).unwrap();
            if in_code_region(&regions, full.start()) {
                return full.as_str().to_string();
            }
            fn_count += 1;
            let label = format!("ifn-{}", fn_count);
            footnote_defs.push_str(&format!(
                "\n[^{}]: {}\n",
                label,
                caps.get(1).unwrap().as_str()
            ));
            format!("[^{}]", label)
        });
        let mut out = replaced.into_owned();
        out.push_str(&footnote_defs);
        processed = Cow::Owned(out);
    }

    processed
}

fn process_parenthesized_autolinks(content: &str) -> Cow<'_, str> {
    let regions = code_region_ranges(content);
    let mut output = String::new();
    let mut copied_to = 0;
    let mut scan_from = 0;

    while let Some(opening_offset) = content[scan_from..].find('(') {
        let opening = scan_from + opening_offset;
        let url_start = opening + 1;
        let url_tail = &content[url_start..];
        if !(url_tail.starts_with("http://")
            || url_tail.starts_with("https://")
            || url_tail.starts_with("ftp://"))
        {
            scan_from = url_start;
            continue;
        }

        let mut depth = 1usize;
        let mut closing = None;
        for (offset, ch) in url_tail.char_indices() {
            if ch.is_whitespace() {
                break;
            }
            match ch {
                '(' => depth += 1,
                ')' => {
                    depth -= 1;
                    if depth == 0 {
                        closing = Some(url_start + offset);
                        break;
                    }
                }
                _ => {}
            }
        }

        let Some(closing) = closing else {
            scan_from = url_start;
            continue;
        };
        let after_closing = closing + ')'.len_utf8();
        let adjacent_text = content[after_closing..]
            .chars()
            .next()
            .is_some_and(char::is_alphanumeric);
        if !adjacent_text || in_code_region(&regions, opening) {
            scan_from = after_closing;
            continue;
        }

        let url = &content[url_start..closing];
        output.push_str(&content[copied_to..url_start]);
        output.push('[');
        output.push_str(url);
        output.push_str("](");
        output.push_str(url);
        output.push_str(")");
        output.push(')');
        copied_to = after_closing;
        scan_from = after_closing;
    }

    if output.is_empty() {
        Cow::Borrowed(content)
    } else {
        output.push_str(&content[copied_to..]);
        Cow::Owned(output)
    }
}

const DISPLAY_MATH_UNDERSCORE_SENTINEL: &str = "\u{E000}";

fn protect_display_math_underscores(content: &str) -> String {
    content
        .split("$$")
        .enumerate()
        .map(|(index, segment)| {
            if index % 2 == 1 {
                segment.replace('_', DISPLAY_MATH_UNDERSCORE_SENTINEL)
            } else {
                segment.to_owned()
            }
        })
        .collect::<Vec<_>>()
        .join("$$")
}

#[tauri::command]
fn convert_markdown(content: &str) -> String {
    let processed_autolinks = process_parenthesized_autolinks(content);
    let processed_embeds = process_internal_embeds(&processed_autolinks);
    let processed_links = process_wikilinks(&processed_embeds);
    let protected_math = protect_display_math_underscores(&processed_links);

    let mut options = ComrakOptions {
        extension: ComrakExtensionOptions {
            strikethrough: true,
            table: true,
            autolink: true,
            tasklist: true,
            superscript: false,
            footnotes: true,
            description_lists: true,
            header_ids: Some(String::new()),
            ..ComrakExtensionOptions::default()
        },
        ..ComrakOptions::default()
    };
    options.render.unsafe_ = true;
    options.render.hardbreaks = true;
    options.render.sourcepos = true;

    let html = markdown_to_html(&protected_math, &options)
        .replace(DISPLAY_MATH_UNDERSCORE_SENTINEL, "_");
    annotate_task_checkboxes(html, content)
}

fn annotate_task_checkboxes(html: String, markdown: &str) -> String {
    let markdown_lines = markdown.lines().collect::<Vec<_>>();

    TASK_ITEM_RE
        .replace_all(&html, |captures: &Captures| {
            let line = captures["line"].parse::<usize>().unwrap_or_default();
            let source_line = markdown_lines.get(line.saturating_sub(1));
            if !source_line.is_some_and(|line| TASK_SOURCE_RE.is_match(line)) {
                return captures[0].to_string();
            }

            let input = captures["input"].replacen(
                " disabled=\"\"",
                " data-task-checkbox=\"\" disabled=\"\"",
                1,
            );
            format!(
                "<li data-sourcepos=\"{}\">{}",
                &captures["sourcepos"],
                input,
            )
        })
        .into_owned()
}

#[tauri::command]
async fn open_markdown(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
        Ok(convert_markdown(&content))
    })
    .await
    .unwrap_or_else(|e| Err(e.to_string()))
}

#[tauri::command]
async fn open_markdown_preview(path: String, max_bytes: usize) -> Result<(String, String, bool), String> {
    tauri::async_runtime::spawn_blocking(move || {
        use std::io::Read;
        let mut f = fs::File::open(&path).map_err(|e| e.to_string())?;
        
        let metadata = f.metadata().map_err(|e| e.to_string())?;
        if metadata.len() <= max_bytes as u64 {
            let content = read_to_string_lossy(&path).map_err(|e| e.to_string())?;
            let html = convert_markdown(&content);
            return Ok((html, content, true));
        }

        // `Read::read` only guarantees *at most* `buf.len()` bytes and may
        // return a short read for reasons that have nothing to do with EOF,
        // truncating the preview well below the requested budget.
        // `take(..).read_to_end(..)` keeps reading to the limit or EOF.
        let mut vec_buf = Vec::new();
        Read::by_ref(&mut f)
            .take(max_bytes as u64)
            .read_to_end(&mut vec_buf)
            .map_err(|e| e.to_string())?;
        // The cut lands on a raw byte offset, which can slice a multi-byte
        // character in half; drop the partial tail instead of rendering it as
        // a replacement character.
        vec_buf.truncate(utf8_truncation_boundary(&vec_buf));

        let preview_content = decode_utf8_lossy(vec_buf);

        let html = convert_markdown(&preview_content);
        Ok((html, preview_content, false))
    })
    .await
    .unwrap_or_else(|e| Err(e.to_string()))
}

#[tauri::command]
async fn render_markdown(content: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        Ok(convert_markdown(&content))
    })
    .await
    .unwrap_or_else(|e| Err(e.to_string()))
}

/// Deliberately async, like every other file-touching command here. A
/// synchronous `#[tauri::command]` runs on the main thread, so a read from a
/// slow volume (SMB, iCloud, a failing USB stick) freezes the whole
/// application — every window, its menus and its scrolling — until the I/O
/// returns. `spawn_blocking` moves the wait onto the blocking pool, which is
/// what `tauri::async_runtime` provides it for.
#[tauri::command]
async fn read_file_content(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        read_to_string_lossy(&path).map_err(|e| e.to_string())
    })
    .await
    .unwrap_or_else(|e| Err(e.to_string()))
}

fn mime_type_for_export_path(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        Some("bmp") => "image/bmp",
        Some("ico") => "image/x-icon",
        Some("avif") => "image/avif",
        _ => "application/octet-stream",
    }
}

fn file_bytes_to_data_url(mime_type: &str, bytes: &[u8]) -> String {
    use base64::{engine::general_purpose, Engine as _};
    format!(
        "data:{};base64,{}",
        mime_type,
        general_purpose::STANDARD.encode(bytes)
    )
}

#[tauri::command]
async fn read_file_as_data_url(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = fs::read(&path).map_err(|e| e.to_string())?;
        let mime_type = mime_type_for_export_path(Path::new(&path));
        Ok(file_bytes_to_data_url(mime_type, &bytes))
    })
    .await
    .unwrap_or_else(|e| Err(e.to_string()))
}

/// Async because `atomic_write` fsyncs twice (the file, then its directory).
/// On a network or removable volume that is seconds of blocking I/O, and on
/// the main thread it would stall every window until the save completes.
#[tauri::command]
async fn save_file_content(path: String, content: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        atomic_write(Path::new(&path), content.as_bytes()).map_err(|e| e.to_string())
    })
    .await
    .unwrap_or_else(|e| Err(e.to_string()))
}

#[tauri::command]
fn print_pdf(window: tauri::WebviewWindow) -> Result<(), String> {
    window.print().map_err(|error| error.to_string())
}

#[tauri::command]
async fn export_pdf_windows(window: tauri::WebviewWindow, path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::sync::mpsc::sync_channel;
        use std::time::Duration;
        use webview2_com::{
            PrintToPdfCompletedHandler,
            Microsoft::Web::WebView2::Win32::{ICoreWebView2Environment6, ICoreWebView2_7},
        };
        use windows::core::{Interface, HSTRING};

        let (sender, receiver) = sync_channel(1);
        window
            .with_webview(move |platform_webview| unsafe {
                let result = (|| -> Result<(), String> {
                    let controller = platform_webview.controller();
                    let webview = controller
                        .CoreWebView2()
                        .map_err(|error| format!("failed to access WebView2: {error}"))?
                        .cast::<ICoreWebView2_7>()
                        .map_err(|error| {
                            format!("WebView2 runtime does not support PDF export: {error}")
                        })?;
                    let settings = platform_webview
                        .environment()
                        .cast::<ICoreWebView2Environment6>()
                        .map_err(|error| {
                            format!("WebView2 runtime does not support print settings: {error}")
                        })?
                        .CreatePrintSettings()
                        .map_err(|error| format!("failed to create PDF print settings: {error}"))?;

                    settings
                        .SetShouldPrintHeaderAndFooter(false)
                        .map_err(|error| {
                            format!("failed to disable PDF headers and footers: {error}")
                        })?;
                    settings
                        .SetShouldPrintBackgrounds(true)
                        .map_err(|error| format!("failed to enable PDF backgrounds: {error}"))?;

                    let callback_sender = sender.clone();
                    let completion =
                        PrintToPdfCompletedHandler::create(Box::new(move |status, succeeded| {
                            let result = status
                                .map_err(|error| format!("WebView2 PDF export failed: {error}"))
                                .and_then(|_| {
                                    succeeded.then_some(()).ok_or_else(|| {
                                        "WebView2 did not create the PDF file".to_string()
                                    })
                                });
                            let _ = callback_sender.send(result);
                            Ok(())
                        }));

                    webview
                        .PrintToPdf(&HSTRING::from(path), &settings, &completion)
                        .map_err(|error| format!("could not start PDF export: {error}"))
                })();

                if let Err(error) = result {
                    let _ = sender.send(Err(error));
                }
            })
            .map_err(|error| format!("failed to schedule PDF export: {error}"))?;

        tauri::async_runtime::spawn_blocking(move || receiver.recv_timeout(Duration::from_secs(60)))
            .await
            .map_err(|error| format!("PDF export task failed: {error}"))?
            .map_err(|error| format!("PDF export callback failed or timed out: {error}"))?
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (window, path);
        Err("controlled PDF export is only available on Windows".to_string())
    }
}

#[tauri::command]
async fn save_file_binary(path: String, data: Vec<u8>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        atomic_write(Path::new(&path), &data).map_err(|e| e.to_string())
    })
    .await
    .unwrap_or_else(|e| Err(e.to_string()))
}

#[tauri::command]
fn open_file_folder(path: String) -> Result<(), String> {
    opener::reveal(path).map_err(|e| e.to_string())
}

#[tauri::command]
fn rename_file(old_path: String, new_path: String) -> Result<(), String> {
    fs::rename(old_path, new_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn watch_file(
    window: tauri::Window,
    handle: AppHandle,
    state: State<'_, WatcherState>,
    path: String,
) -> Result<(), String> {
    window_runtime::watch_file(window, handle, state, path)
}

#[tauri::command]
fn unwatch_file(window: tauri::Window, state: State<'_, WatcherState>) -> Result<(), String> {
    window_runtime::unwatch_file(window, state)
}

#[tauri::command]
fn send_markdown_path(state: State<'_, AppState>) -> Vec<String> {
    window_runtime::send_markdown_path(state)
}

#[tauri::command]
fn save_theme(app: AppHandle, theme: String) -> Result<(), String> {
    let config_dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
    let theme_path = config_dir.join("theme.txt");
    atomic_write(&theme_path, theme.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_app_mode() -> String {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|arg| arg == "--uninstall") {
        return "uninstall".to_string();
    }

    let current_exe = std::env::current_exe().unwrap_or_default();
    let exe_name = current_exe
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_lowercase();

    let is_installer_mode =
        args.iter().any(|arg| arg == "--install") || exe_name.contains("installer");

    if setup::is_installed() {
        "app".to_string()
    } else {
        if is_installer_mode {
            "installer".to_string()
        } else {
            "app".to_string()
        }
    }
}

fn theme_slug(value: &str) -> String {
    let lowercase = value.to_lowercase();
    lowercase
        .split(|c: char| !c.is_alphanumeric())
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

#[tauri::command]
async fn fetch_vscode_theme(app: AppHandle, url: String) -> Result<String, String> {
    use std::io::Cursor;
    // Parse URL: e.g. https://vscodethemes.com/e/teabyii.ayu/ayu-dark-bordered
    let parts: Vec<&str> = url.split('/').collect();
    if parts.len() < 5 || parts[3] != "e" {
        return Err("Invalid vscodethemes.com URL".to_string());
    }
    let pub_ext = parts[4];
    let theme_name = parts
        .get(5)
        .unwrap_or(&"")
        .split('?')
        .next()
        .unwrap_or("")
        .to_string();
    let pe_parts: Vec<&str> = pub_ext.split('.').collect();
    if pe_parts.len() != 2 {
        return Err("Invalid extension format in URL".to_string());
    }
    let publisher = pe_parts[0];
    let extension = pe_parts[1];

    let vsix_url = format!("https://{publisher}.gallery.vsassets.io/_apis/public/gallery/publisher/{publisher}/extension/{extension}/latest/assetbyname/Microsoft.VisualStudio.Services.VSIXPackage");

    // Bound the request explicitly. `reqwest::get` has no timeout at all, so
    // a marketplace host that accepts the connection and then stalls leaves
    // the theme import pending for the rest of the session.
    let client = reqwest::Client::builder()
        .connect_timeout(VSIX_CONNECT_TIMEOUT)
        .timeout(VSIX_REQUEST_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?;
    let mut response = client.get(&vsix_url).send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("VSIX download failed with HTTP {}", response.status()));
    }
    if response.content_length().is_some_and(|length| length > MAX_VSIX_DOWNLOAD_BYTES as u64) {
        return Err("VSIX download exceeds the allowed size".to_string());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        if bytes.len() + chunk.len() > MAX_VSIX_DOWNLOAD_BYTES {
            return Err("VSIX download exceeds the allowed size".to_string());
        }
        bytes.extend_from_slice(&chunk);
    }

    let reader = Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(reader).map_err(|e| e.to_string())?;
    validate_vsix_archive_limits(&mut archive)?;

    let package_json_data = if let Ok(file) = archive.by_name("extension/package.json") {
        if file.size() > MAX_THEME_JSON_BYTES {
            return Err("VSIX package manifest exceeds the allowed size".to_string());
        }
        read_zip_entry_to_string(file, MAX_THEME_JSON_BYTES)?
    } else {
        return Err("No package.json found in VSIX".to_string());
    };

    let package_json: serde_json::Value =
        serde_json::from_str(&package_json_data).map_err(|e| e.to_string())?;
    let themes = package_json
        .get("contributes")
        .and_then(|c| c.get("themes"))
        .and_then(|t| t.as_array())
        .ok_or("No themes found in extension")?;

    let mut theme_path = None;
    let mut matched_name_str = theme_name.clone();

    for t in themes {
        let label = t
            .get("label")
            .or(t.get("id"))
            .and_then(|l| l.as_str())
            .unwrap_or("");
        let path = t.get("path").and_then(|p| p.as_str()).unwrap_or("");

        let label_slug = theme_slug(label);

        // If theme_name is empty, just take the first one
        if theme_name.is_empty()
            || label_slug == theme_name.to_lowercase()
            || path.to_lowercase().contains(&theme_name.to_lowercase())
        {
            theme_path = Some(path.to_string());
            if theme_name.is_empty() {
                matched_name_str = label_slug;
            }
            break;
        }
    }

    if let Some(mut path) = theme_path {
        if path.starts_with("./") {
            path = path[2..].to_string();
        }
        let full_path = format!("extension/{}", path).replace("\\", "/");
        let theme_file = archive.by_name(&full_path).map_err(|e| e.to_string())?;
        if theme_file.size() > MAX_THEME_JSON_BYTES {
            return Err("VSIX theme file exceeds the allowed size".to_string());
        }
        let theme_json = read_zip_entry_to_string(theme_file, MAX_THEME_JSON_BYTES)?;

        let config_dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
        let themes_dir = config_dir.join("themes");
        fs::create_dir_all(&themes_dir).map_err(|e| e.to_string())?;

        let dest_name = if matched_name_str.is_empty() {
            "downloaded_theme".to_string()
        } else {
            matched_name_str.clone()
        };
        let dest_name = safe_path_component(&dest_name, "theme name")?;
        let theme_file_path = themes_dir.join(format!("{}.json", dest_name));
        atomic_write(&theme_file_path, theme_json.as_bytes()).map_err(|e| e.to_string())?;

        return Ok(dest_name.to_string());
    }

    Err("Theme name not found in extension".to_string())
}

#[tauri::command]
fn get_saved_vscode_themes(app: AppHandle) -> Result<Vec<String>, String> {
    let config_dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let themes_dir = config_dir.join("themes");
    let mut themes = Vec::new();
    if let Ok(entries) = fs::read_dir(themes_dir) {
        for entry in entries.flatten() {
            if let Some(ext) = entry.path().extension() {
                if ext == "json" {
                    if let Some(name) = entry.path().file_stem().and_then(|n| n.to_str()) {
                        themes.push(name.to_string());
                    }
                }
            }
        }
    }
    Ok(themes)
}

#[tauri::command]
fn read_vscode_theme(app: AppHandle, name: String) -> Result<String, String> {
    let config_dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let name = safe_path_component(&name, "theme name")?;
    let theme_file_path = config_dir.join("themes").join(format!("{}.json", name));
    fs::read_to_string(theme_file_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_vscode_theme(app: AppHandle, name: String) -> Result<(), String> {
    let config_dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let name = safe_path_component(&name, "theme name")?;
    let theme_file_path = config_dir.join("themes").join(format!("{}.json", name));
    fs::remove_file(theme_file_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn is_win11() -> bool {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;

        let hklim = RegKey::predef(HKEY_LOCAL_MACHINE);
        if let Ok(current_version) =
            hklim.open_subkey("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion")
        {
            if let Ok(current_build) = current_version.get_value::<String, _>("CurrentBuild") {
                if let Ok(build_num) = current_build.parse::<u32>() {
                    return build_num >= 22000;
                }
            }
        }
    }
    false
}

/// Async because enumerating every installed font family is a slow,
/// filesystem-heavy call (fontconfig on Linux, DirectWrite on Windows,
/// CoreText on macOS) and the settings dialog invokes it on open. On the main
/// thread it stalls every window for the duration.
#[tauri::command]
async fn get_system_fonts() -> Vec<String> {
    tauri::async_runtime::spawn_blocking(|| {
        use font_kit::source::SystemSource;
        let source = SystemSource::new();
        let mut families = source.all_families().unwrap_or_default();
        families.sort();
        families.dedup();
        families
    })
    .await
    .unwrap_or_default()
}

#[tauri::command]
fn get_os_type() -> String {
    #[cfg(target_os = "macos")]
    {
        "macos".to_string()
    }
    #[cfg(target_os = "windows")]
    {
        "windows".to_string()
    }
    #[cfg(target_os = "linux")]
    {
        "linux".to_string()
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        "unknown".to_string()
    }
}


#[tauri::command]
fn clipboard_write_text(text: String) -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.set_text(text).map_err(|e| e.to_string())
}

#[tauri::command]
fn clipboard_read_text() -> Result<String, String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.get_text().map_err(|e| e.to_string())
}

#[tauri::command]
fn clipboard_read_image(macos_image_scaling: bool) -> Result<String, String> {
    #[cfg(not(target_os = "macos"))]
    let _ = macos_image_scaling;

    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    let image = clipboard.get_image().map_err(|e| e.to_string())?;

    // encode as png
    let mut png_data = Vec::new();
    {
        let encoder = image::codecs::png::PngEncoder::new(&mut png_data);
        use image::ImageEncoder;
        
        // Check if running on macOS and scale image if needed
        #[cfg(target_os = "macos")]
        {
            if macos_image_scaling {
                // Use image crate for high-quality scaling
                use image::{DynamicImage, ImageBuffer, Rgba};
                
                // Convert arboard Image to ImageBuffer
                let mut img_buffer = ImageBuffer::new(image.width as u32, image.height as u32);
                for (x, y, pixel) in img_buffer.enumerate_pixels_mut() {
                    let idx = (y * image.width as u32 + x) as usize * 4;
                    if idx + 3 < image.bytes.len() {
                        *pixel = Rgba([
                            image.bytes[idx],
                            image.bytes[idx + 1],
                            image.bytes[idx + 2],
                            image.bytes[idx + 3]
                        ]);
                    }
                }
                
                // Create DynamicImage
                let dynamic_image = DynamicImage::ImageRgba8(img_buffer);
                
                // Resize with high-quality Lanczos3 filter
                let resized = dynamic_image.resize(
                    (image.width / 2) as u32,
                    (image.height / 2) as u32,
                    image::imageops::FilterType::Lanczos3
                );
                
                // Write the resized image
                let resized_rgba = resized.to_rgba8();
                encoder
                    .write_image(
                        resized_rgba.as_raw(),
                        (image.width / 2) as u32,
                        (image.height / 2) as u32,
                        image::ExtendedColorType::Rgba8,
                    )
                    .map_err(|e| e.to_string())?;
            } else {
                // Use original image if scaling is disabled
                encoder
                    .write_image(
                        image.bytes.as_ref(),
                        image.width as u32,
                        image.height as u32,
                        image::ExtendedColorType::Rgba8,
                    )
                    .map_err(|e| e.to_string())?;
            }
        }
        
        #[cfg(not(target_os = "macos"))]
        {
            // For other platforms, use the original image
            encoder
                .write_image(
                    image.bytes.as_ref(),
                    image.width as u32,
                    image.height as u32,
                    image::ExtendedColorType::Rgba8,
                )
                .map_err(|e| e.to_string())?;
        }
    }

    use base64::{engine::general_purpose, Engine as _};
    Ok(general_purpose::STANDARD.encode(&png_data))
}

#[tauri::command]
async fn save_image(
    parent_dir: String,
    filename: String,
    base64_data: String,
    image_directory: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        save_image_blocking(&parent_dir, &filename, &base64_data, &image_directory)
    })
    .await
    .unwrap_or_else(|e| Err(e.to_string()))
}

fn save_image_blocking(
    parent_dir: &str,
    filename: &str,
    base64_data: &str,
    image_directory: &str,
) -> Result<String, String> {
    let filename = safe_path_component(filename, "image filename")?;
    let (root, img_dir) = resolve_image_directory(parent_dir, image_directory)?;
    let file_path = img_dir.join(filename);
    ensure_path_within_root(&root, &file_path)?;

    // remove potential data:image/png;base64, prefix
    let b64 = if let Some(pos) = base64_data.find("base64,") {
        &base64_data[pos + 7..]
    } else {
        base64_data
    };

    use base64::{engine::general_purpose, Engine as _};
    let bytes = general_purpose::STANDARD
        .decode(b64)
        .map_err(|e: base64::DecodeError| e.to_string())?;

    atomic_write(&file_path, &bytes).map_err(|e| e.to_string())?;

    let rel_path = if image_directory.is_empty() {
        filename.to_string()
    } else {
        format!("{}/{}", image_directory, filename)
    };

    Ok(rel_path)
}

#[tauri::command]
async fn copy_file_to_img(
    src_path: String,
    parent_dir: String,
    image_directory: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        copy_file_to_img_blocking(&src_path, &parent_dir, &image_directory)
    })
    .await
    .unwrap_or_else(|e| Err(e.to_string()))
}

fn copy_file_to_img_blocking(
    src_path: &str,
    parent_dir: &str,
    image_directory: &str,
) -> Result<String, String> {
    let (root, img_dir) = resolve_image_directory(parent_dir, image_directory)?;

    let src = Path::new(src_path);
    if !src.exists() {
        return Err("Source file does not exist".to_string());
    }

    let file_name = src
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "Invalid source filename".to_string())?;

    // Handle name conflicts by appending timestamp if exists
    let mut dest_name = file_name.to_string();
    let dest_path = img_dir.join(&dest_name);
    if dest_path.exists() {
        let stem = src.file_stem().and_then(|s| s.to_str()).unwrap_or("image");
        let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("");
        dest_name = format!("{}_{}.{}", stem, chrono::Local::now().timestamp(), ext);
    }

    let final_dest = img_dir.join(&dest_name);
    ensure_path_within_root(&root, &final_dest)?;
    fs::copy(src, &final_dest).map_err(|e| e.to_string())?;

    let rel_path = if image_directory.is_empty() {
        dest_name
    } else {
        format!("{}/{}", image_directory, dest_name)
    };

    Ok(rel_path)
}

#[tauri::command]
fn delete_file(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.exists() {
        fs::remove_file(p).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn copy_file(src: String, dest: String) -> Result<(), String> {
    fs::copy(src, dest).map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
fn cleanup_empty_img_dir(parent_dir: String, image_directory: String) -> Result<(), String> {
    let img_dir = Path::new(&parent_dir).join(&image_directory);
    if img_dir.exists() && img_dir.is_dir() {
        if fs::read_dir(&img_dir)
            .map_err(|e| e.to_string())?
            .next()
            .is_none()
        {
            fs::remove_dir(img_dir).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
async fn list_directory_contents(path: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = Path::new(&path);
        if !dir.exists() || !dir.is_dir() {
            return Err("Not a directory".to_string());
        }

        let mut entries = Vec::new();
        for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let name = entry.file_name().to_string_lossy().to_string();
            let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
            if is_dir {
                entries.push(format!("{}/", name));
            } else {
                entries.push(name);
            }
        }
        Ok(entries)
    })
    .await
    .unwrap_or_else(|e| Err(e.to_string()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "linux")]
    {
        std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    #[cfg(target_os = "windows")]
    {
        std::env::set_var(
            "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
            "--enable-features=SmoothScrolling",
        );
    }

    tauri::Builder::default()
        .manage(AppState::new())
        .manage(WatcherState::new())
        .manage(tab_transfer::TabTransferBroker::new())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            window_runtime::handle_single_instance(app, args, cwd);
        }))
        .plugin(tauri_plugin_prevent_default::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED
                        | tauri_plugin_window_state::StateFlags::VISIBLE
                        | tauri_plugin_window_state::StateFlags::FULLSCREEN,
                )
                // Detached tab windows share one saved state instead of
                // accumulating a state entry per generated label.
                .map_label(|label| {
                    if label.starts_with("window-") {
                        "secondary"
                    } else {
                        label
                    }
                })
                .build(),
        )
        .setup(|app| {
            let args: Vec<String> = std::env::args().collect();
            println!("Setup Args: {:?}", args);

            let current_exe = std::env::current_exe().unwrap_or_default();
            let exe_name = current_exe
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_lowercase();
            let is_installer_mode =
                args.iter().any(|arg| arg == "--install") || exe_name.contains("installer");

            let label = if is_installer_mode {
                "installer"
            } else {
                "main"
            };

            let mut window_builder = tauri::WebviewWindowBuilder::new(
                app,
                label,
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("Markpad")
            .inner_size(900.0, 650.0)
            .min_inner_size(400.0, 300.0)
            .visible(false)
            .resizable(true)
            .shadow(false)
            .center();

            #[cfg(target_os = "macos")]
            {
                window_builder = window_builder
                    .decorations(true)
                    .title_bar_style(tauri::TitleBarStyle::Overlay)
                    .hidden_title(true);
            }

            #[cfg(not(target_os = "macos"))]
            {
                window_builder = window_builder.decorations(false);
            }

            let window = window_builder.build()?;

            #[cfg(target_os = "macos")]
            {
                use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};

                let app_name = app.package_info().name.clone();

                let check_item =
                    MenuItemBuilder::with_id("check-updates", "Check for Updates…").build(app)?;
                let settings_item = MenuItemBuilder::with_id("menu-app-settings", "Settings…")
                    .accelerator("CmdOrCtrl+,")
                    .build(app)?;

                let app_submenu = SubmenuBuilder::new(app, &app_name)
                    .item(&PredefinedMenuItem::about(
                        app,
                        Some(&format!("About {}", app_name)),
                        None,
                    )?)
                    .separator()
                    .item(&settings_item)
                    .item(&check_item)
                    .separator()
                    .item(&PredefinedMenuItem::services(app, None)?)
                    .separator()
                    .item(&PredefinedMenuItem::hide(app, None)?)
                    .separator()
                    .item(
                        &MenuItemBuilder::with_id(
                            "menu-app-quit",
                            format!("Quit {}", app_name),
                        )
                        .accelerator("CmdOrCtrl+Q")
                        .build(app)?,
                    )
                    .build()?;

                let menu = MenuBuilder::new(app)
                    .items(&[&app_submenu])
                    .build()?;

                app.set_menu(menu)?;
            }

            let config_dir = app.path().app_config_dir()?;
            let theme_path = config_dir.join("theme.txt");
            let theme_pref =
                fs::read_to_string(theme_path).unwrap_or_else(|_| "system".to_string());

            let bg_color = match theme_pref.as_str() {
                "dark" => Some(tauri::window::Color(24, 24, 24, 255)),
                "light" => Some(tauri::window::Color(253, 253, 253, 255)),
                _ => {
                    if let Ok(t) = window.theme() {
                        match t {
                            tauri::Theme::Dark => Some(tauri::window::Color(24, 24, 24, 255)),
                            _ => Some(tauri::window::Color(253, 253, 253, 255)),
                        }
                    } else {
                        Some(tauri::window::Color(253, 253, 253, 255))
                    }
                }
            };

            let _ = window.set_background_color(bg_color);

            let _ = window.set_shadow(true);

            let file_path = args.iter().skip(1).find(|arg| !arg.starts_with("-"));

            if let Some(path) = file_path {
                let _ = window.emit("file-path", path.as_str());
                window_runtime::bring_to_front(&window);
            }

            // If installer, force size (this will be saved to installer-state, not main-state)
            if is_installer_mode {
                let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
                    width: 450.0,
                    height: 650.0,
                }));
                let _ = window.center();
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            clipboard_write_text,
            clipboard_read_text,
            clipboard_read_image,
            open_markdown,
            open_markdown_preview,
            render_markdown,
            send_markdown_path,
            read_file_content,
            read_file_as_data_url,
            save_file_content,
            export_pdf_windows,
            print_pdf,
            save_file_binary,
            get_app_mode,
            setup::install_app,
            setup::uninstall_app,
            setup::check_install_status,
            is_win11,
            open_file_folder,
            rename_file,
            watch_file,
            unwatch_file,
            show_window,
            save_theme,
            get_system_fonts,
            get_os_type,
            fetch_vscode_theme,
            get_saved_vscode_themes,
            read_vscode_theme,
            delete_vscode_theme,
            save_image,
            copy_file_to_img,
            delete_file,
            copy_file,
            cleanup_empty_img_dir,
            list_directory_contents,
            tab_transfer::stage_detached_tab,
            tab_transfer::claim_detached_tab,
            tab_transfer::complete_detached_tab,
            tab_transfer::cancel_detached_tab,
            create_transfer_window,
            set_window_meta,
            list_viewer_windows,
            offer_tab_to_window,
            focus_window,
            list_pinned_tags,
            save_pinned_tag,
            remove_pinned_tag,
            save_window_state,
            load_window_state,
            clear_window_state
        ])
        .on_window_event(window_runtime::handle_window_event)
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            // Emit to the focused webview window's label rather than
            // `window.emit(...)`, which broadcasts to every webview and
            // would fire menu actions (New/Close/Save…) in all windows at
            // once. Falls back to "main" if no window is focused (e.g. menu
            // fired while the app is in the background).
            let target = app
                .webview_windows()
                .into_values()
                .find(|w| w.is_focused().unwrap_or(false))
                .or_else(|| app.get_webview_window("main"));
            let Some(window) = target else { return };

            if id == "menu-app-settings" {
                let _ = app.emit_to(window.label(), "menu-app-settings", ());
            } else if id == "check-updates" {
                let _ = app.emit_to(window.label(), "menu-check-updates", ());
            } else if id == "menu-app-quit" {
                let _ = app.emit_to(window.label(), id, ());
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, _event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = _event {
                for url in urls {
                    if let Ok(path_buf) = url.to_file_path() {
                        let path_str = path_buf.to_string_lossy().to_string();

                        let state = _app_handle.state::<AppState>();
                        window_runtime::lock_recover(&state.startup_files)
                            .push(path_str.clone());

                        if let Some(window) = pick_delivery_window(_app_handle) {
                            let _ = _app_handle.emit_to(window.label(), "file-path", path_str);
                            window_runtime::bring_to_front(&window);
                        }
                    }
                }
            }
        });
}
