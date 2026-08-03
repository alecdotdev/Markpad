use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex,
};
use tauri::{AppHandle, Emitter, Manager, State};

pub struct WatcherState {
    pub(crate) watchers: Mutex<HashMap<String, RecommendedWatcher>>,
}

impl WatcherState {
    pub fn new() -> Self {
        Self {
            watchers: Mutex::new(HashMap::new()),
        }
    }
}

pub struct AppState {
    pub(crate) startup_files: Mutex<Vec<String>>,
    pub(crate) last_focused_viewer: Mutex<Option<String>>,
    window_registry: Mutex<HashMap<String, WindowMeta>>,
    window_counter: AtomicU64,
    /// Serialises the read-modify-write cycle over `pinned-tags.json`. Guards
    /// a critical section rather than a value, so the payload is `()` — see
    /// `update_pinned_tags` for why the whole cycle has to be inside it.
    pinned_tags: Mutex<()>,
}

/// Locks `mutex`, recovering the guarded value if a previous holder panicked.
///
/// These mutexes guard plain bookkeeping — the window registry, pending
/// startup paths, the watcher map — none of which is left in a torn state by
/// a panic elsewhere. Propagating poisoning instead would turn one panic into
/// a permanently unusable registry: every later `set_window_meta`,
/// `list_viewer_windows` and window-destroyed handler would panic in turn.
///
/// `pinned_tags` is recovered on the same grounds even though it guards a
/// file: the only thing a panic inside the cycle can leave behind is the
/// pre-existing `pinned-tags.json`, because `atomic_write` publishes by
/// rename and a panic before it simply never publishes. There is no
/// half-applied state for the next holder to inherit, and propagating the
/// poison would instead make pinning fail for the rest of the session.
pub(crate) fn lock_recover<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|error| error.into_inner())
}

impl AppState {
    pub fn new() -> Self {
        Self {
            startup_files: Mutex::new(Vec::new()),
            last_focused_viewer: Mutex::new(None),
            window_registry: Mutex::new(HashMap::new()),
            window_counter: AtomicU64::new(0),
            pinned_tags: Mutex::new(()),
        }
    }
}

#[derive(Clone, serde::Serialize)]
struct WindowMeta {
    number: u64,
    tag_name: Option<String>,
    tag_color: Option<String>,
    active_tab_title: String,
    tab_count: usize,
}

#[derive(Clone, serde::Serialize)]
pub struct WindowListEntry {
    label: String,
    #[serde(flatten)]
    meta: WindowMeta,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct PinnedTag {
    pub name: String,
    pub color: String,
    pub files: Vec<String>,
}

fn pinned_tags_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir.join("pinned-tags.json"))
}

/// Reads the pin list, treating an unreadable or unparseable file as empty.
///
/// Under `update_pinned_tags`'s lock the empty fallback can only be reached by
/// a file that is genuinely damaged from outside Markpad, never by a write in
/// progress: `atomic_write` publishes by rename, so a concurrent reader opens
/// either the whole old file or the whole new one.
fn read_pinned_tags_at(path: &Path) -> Vec<PinnedTag> {
    fs::read_to_string(path)
        .ok()
        .and_then(|json| serde_json::from_str(&json).ok())
        .unwrap_or_default()
}

/// Reads the pin list without taking the lock.
///
/// A plain read needs no lock. The file is only ever replaced by
/// `atomic_write`'s rename, so a reader racing a writer sees either the whole
/// previous list or the whole next one, and both are lists that Markpad
/// actually wrote. What is unsafe is not the read but the *cycle* — read,
/// mutate, write back — which is why only `update_pinned_tags` locks.
fn read_pinned_tags(app: &AppHandle) -> Vec<PinnedTag> {
    pinned_tags_path(app)
        .map(|path| read_pinned_tags_at(&path))
        .unwrap_or_default()
}

/// Applies `edit` to the pin list and writes the result back, with the whole
/// read-modify-write cycle held under `lock`.
///
/// `atomic_write` is not enough on its own, and the difference is easy to miss.
/// It rules out a *torn* file: the rename publishes the new list in one step,
/// so no reader ever sees half a JSON document. It says nothing about a *lost
/// update*, where both writers produce a whole, valid file and the second one
/// is built from a list it read before the first one landed:
///
/// ```text
/// window A: read [x] ─── add "a" ─────────── write [x, a]
/// window B:      read [x] ─── add "b" ─────────────────── write [x, b]
/// on disk:  [x]                             [x, a]        [x, b]   ← "a" gone
/// ```
///
/// Tauri dispatches commands on a thread pool and every window can call these,
/// so the interleaving is reachable whenever two windows persist their pins at
/// once — which is exactly what quitting with ⌘Q does, since each window saves
/// its pinned tag from its own close handler.
///
/// This is the same defect the frontend fixed in #405 for the recent-files
/// list, where a re-read alone was enough. The previous revision of this
/// comment — written here, by #424, the change that added this lock —
/// explained why by saying that `localStorage` is per-document and
/// single-threaded,
/// "making an RMW cycle atomic by construction". That is false, and it is
/// corrected here rather than softened, because someone reasoning from it
/// about some other shared `localStorage` key would conclude they need no
/// synchronisation at all. Each *document* is single-threaded; two Markpad
/// windows are two documents sharing one origin's storage area. The storage
/// mutex the HTML standard describes for exactly this case is not implemented
/// by any shipping engine, WebKit and WebView2 included, so a `getItem` …
/// `setItem` pair in one window can interleave with the other window's and
/// lose precisely the update drawn above.
///
/// What the re-read buys is a narrower window, not atomicity:
///
/// - Before it, the exposure was the whole lifetime of a window's in-memory
///   copy — from the last time that window looked at the list until it next
///   wrote, which is minutes. After it, the cycle is one synchronous turn of
///   the event loop containing no `await`: `getItem`, a `JSON.parse` of at
///   most nine short strings, `setItem`.
/// - The writes happen on discrete user actions (open a file, remove an
///   entry, rename), so colliding means two windows landing inside those
///   microseconds.
/// - What a collision costs is one entry of a recent-file list, which the
///   next open puts back.
///
/// It is a residual race, accepted on those three grounds — not a guarantee.
/// None of the three holds here. This cycle is a file read, a parse, a
/// serialize and an `atomic_write`: milliseconds of I/O on a preemptively
/// scheduled thread pool, not microseconds of straight-line JS. The collision
/// is not a coincidence but the ordinary shape of quitting, since ⌘Q makes
/// every window write from its own close handler at once. And a dropped pin is
/// a thing the user made, with nothing to recreate it from. Unlocked, this
/// cycle was measured losing updates; hence the lock.
///
/// Serialising also keeps two `atomic_write` calls off the same target at
/// once, which is not something `atomic_write` handles either: its temp file
/// is named from the target name, the pid and a nanosecond clock reading, so
/// two threads of one process that land on the same reading collide on
/// `create_new` — and the loser's cleanup then deletes the temp file the
/// winner was about to rename. Both spellings of that failure showed up in the
/// unlocked measurements (`File exists`, `No such file or directory`).
fn update_pinned_tags(
    lock: &Mutex<()>,
    path: &Path,
    edit: impl FnOnce(&mut Vec<PinnedTag>),
) -> Result<(), String> {
    let _guard = lock_recover(lock);
    let mut tags = read_pinned_tags_at(path);
    edit(&mut tags);
    let json = serde_json::to_string(&tags).map_err(|error| error.to_string())?;
    crate::atomic_write(path, json.as_bytes()).map_err(|error| error.to_string())
}

fn save_pinned_tag_at(
    lock: &Mutex<()>,
    path: &Path,
    name: String,
    color: String,
    files: Vec<String>,
) -> Result<(), String> {
    update_pinned_tags(lock, path, move |tags| {
        if let Some(tag) = tags.iter_mut().find(|tag| tag.name == name) {
            tag.color = color;
            tag.files = files;
        } else {
            tags.push(PinnedTag { name, color, files });
        }
    })
}

fn remove_pinned_tag_at(lock: &Mutex<()>, path: &Path, name: String) -> Result<(), String> {
    update_pinned_tags(lock, path, move |tags| {
        tags.retain(|tag| tag.name != name);
    })
}

pub fn list_pinned_tags(app: AppHandle) -> Vec<PinnedTag> {
    read_pinned_tags(&app)
}

pub fn save_pinned_tag(
    app: AppHandle,
    name: String,
    color: String,
    files: Vec<String>,
) -> Result<(), String> {
    let path = pinned_tags_path(&app)?;
    let state = app.state::<AppState>();
    save_pinned_tag_at(&state.pinned_tags, &path, name, color, files)
}

pub fn remove_pinned_tag(app: AppHandle, name: String) -> Result<(), String> {
    let path = pinned_tags_path(&app)?;
    let state = app.state::<AppState>();
    remove_pinned_tag_at(&state.pinned_tags, &path, name)
}

pub fn set_window_meta(
    window: tauri::Window,
    state: State<'_, AppState>,
    tag_name: Option<String>,
    tag_color: Option<String>,
    active_tab_title: String,
    tab_count: usize,
) {
    let label = window.label().to_string();
    if label != "main" && !label.starts_with("window-") {
        return;
    }
    let mut registry = lock_recover(&state.window_registry);
    let entry = registry.entry(label).or_insert_with(|| WindowMeta {
        number: state.window_counter.fetch_add(1, Ordering::SeqCst) + 1,
        tag_name: None,
        tag_color: None,
        active_tab_title: String::new(),
        tab_count: 0,
    });
    entry.tag_name = tag_name;
    entry.tag_color = tag_color;
    entry.active_tab_title = active_tab_title;
    entry.tab_count = tab_count;
}

pub fn list_viewer_windows(state: State<'_, AppState>) -> Vec<WindowListEntry> {
    let registry = lock_recover(&state.window_registry);
    let mut list: Vec<WindowListEntry> = registry
        .iter()
        .map(|(label, meta)| WindowListEntry {
            label: label.clone(),
            meta: meta.clone(),
        })
        .collect();
    list.sort_by_key(|entry| entry.meta.number);
    list
}

pub fn offer_tab_to_window(
    app: AppHandle,
    target_label: String,
    token: String,
) -> Result<(), String> {
    if app.get_webview_window(&target_label).is_none() {
        return Err(format!("no such window: {target_label}"));
    }
    app.emit_to(target_label.as_str(), "tab-transfer-offer", token)
        .map_err(|error| error.to_string())
}

pub fn focus_window(app: AppHandle, label: String) -> Result<(), String> {
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| format!("no such window: {label}"))?;
    bring_to_front(&window);
    Ok(())
}

pub async fn show_window(window: tauri::Window) {
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
}

fn window_state_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("window-state-v2.json"))
}

/// Persists the session snapshot atomically.
///
/// This runs while the last window is closing — the moment the WebKit storage
/// process is already tearing down — so a partial write is a realistic
/// outcome, not a theoretical one. `fs::write` truncates first and then
/// streams, so a crash mid-write leaves behind half a JSON document, and the
/// next launch restores no tabs at all. `atomic_write` publishes the new
/// snapshot with a rename: the file on disk is either entirely the old
/// session or entirely the new one.
pub fn save_window_state(app: AppHandle, json: String) -> Result<(), String> {
    crate::atomic_write(&window_state_path(&app)?, json.as_bytes()).map_err(|e| e.to_string())
}

pub fn load_window_state(app: AppHandle) -> Option<String> {
    fs::read_to_string(window_state_path(&app).ok()?).ok()
}

pub fn clear_window_state(app: AppHandle) -> Result<(), String> {
    let path = window_state_path(&app)?;
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn bring_to_front(window: &tauri::WebviewWindow) {
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
}

pub fn pick_delivery_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    let viewers: Vec<tauri::WebviewWindow> = app
        .webview_windows()
        .into_iter()
        .filter(|(label, _)| label == "main" || label.starts_with("window-"))
        .map(|(_, window)| window)
        .collect();

    if let Some(focused) = viewers
        .iter()
        .find(|window| window.is_focused().unwrap_or(false))
    {
        return Some(focused.clone());
    }

    let state = app.state::<AppState>();
    let last = lock_recover(&state.last_focused_viewer).clone();
    if let Some(label) = last {
        if let Some(window) = viewers.iter().find(|window| window.label() == label) {
            return Some(window.clone());
        }
    }

    viewers.into_iter().next()
}

pub fn handle_single_instance(app: &AppHandle, args: Vec<String>, cwd: String) {
    let Some(window) = pick_delivery_window(app) else {
        return;
    };
    let path_str = args
        .iter()
        .skip(1)
        .find(|arg| !arg.starts_with('-'))
        .map(String::as_str)
        .unwrap_or("");
    if !path_str.is_empty() {
        let path = Path::new(path_str);
        let resolved_path = if path.is_absolute() {
            path_str.to_string()
        } else {
            Path::new(&cwd).join(path).display().to_string()
        };
        let _ = app.emit_to(window.label(), "file-path", resolved_path);
    }
    bring_to_front(&window);
}

pub fn create_transfer_window(app: AppHandle, token: String) -> Result<(), String> {
    let label = format!("window-{token}");
    #[allow(unused_mut)]
    let mut builder =
        tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::App("index.html".into()))
            .title("Markpad")
            .inner_size(1000.0, 800.0)
            .min_inner_size(400.0, 300.0)
            .visible(false)
            .resizable(true);

    #[cfg(target_os = "macos")]
    {
        builder = builder
            .decorations(true)
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true)
            .shadow(true);
    }
    #[cfg(not(target_os = "macos"))]
    {
        builder = builder.decorations(false).shadow(false);
    }
    builder.build().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn watch_file(
    window: tauri::Window,
    handle: AppHandle,
    state: State<'_, WatcherState>,
    path: String,
) -> Result<(), String> {
    let label = window.label().to_string();
    let event_label = label.clone();
    let watched_path = path.clone();

    // Build and arm the replacement *before* touching the watcher already
    // registered for this window. Dropping the old one first meant a failure
    // in either step below left the window with no watcher at all: the
    // frontend only logs the error, so external edits would silently stop
    // being reported for the rest of the session. Inserting last swaps them
    // in one step — the map drops the previous watcher, which unregisters it.
    let mut watcher = RecommendedWatcher::new(
        move |result: Result<notify::Event, notify::Error>| {
            if result.is_ok() {
                let _ = handle.emit_to(event_label.as_str(), "file-changed", watched_path.clone());
            }
        },
        Config::default(),
    )
    .map_err(|e| e.to_string())?;
    watcher
        .watch(Path::new(&path), RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;

    lock_recover(&state.watchers).insert(label, watcher);
    Ok(())
}

pub fn unwatch_file(window: tauri::Window, state: State<'_, WatcherState>) -> Result<(), String> {
    lock_recover(&state.watchers).remove(window.label());
    Ok(())
}

pub fn send_markdown_path(state: State<'_, AppState>) -> Vec<String> {
    let mut files: Vec<String> = std::env::args()
        .skip(1)
        .filter(|arg| !arg.starts_with('-'))
        .collect();
    let startup_files: Vec<String> = lock_recover(&state.startup_files).drain(..).collect();
    for path in startup_files.into_iter().rev() {
        if !files.contains(&path) {
            files.insert(0, path);
        }
    }
    files
}

pub fn handle_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    match event {
        tauri::WindowEvent::Focused(true) => {
            let label = window.label();
            if label == "main" || label.starts_with("window-") {
                let state = window.state::<AppState>();
                *lock_recover(&state.last_focused_viewer) = Some(label.to_string());
            }
        }
        tauri::WindowEvent::Destroyed => {
            let state = window.state::<WatcherState>();
            lock_recover(&state.watchers).remove(window.label());
            let app_state = window.state::<AppState>();
            lock_recover(&app_state.window_registry).remove(window.label());
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;
    use std::time::{SystemTime, UNIX_EPOCH};

    /// A private directory to keep the pin file in, so a test never touches the
    /// real `app_config_dir` and two runs cannot collide.
    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("markpad-{tag}-{nonce}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn names(tags: &[PinnedTag]) -> HashSet<String> {
        tags.iter().map(|tag| tag.name.clone()).collect()
    }

    /// Every concurrent edit has to survive.
    ///
    /// Deliberately asserts the PROPERTY — the final file contains exactly the
    /// tags the writers between them asked for — rather than any mechanism. A
    /// test that watched for a particular interleaving, or for a specific error,
    /// would pass on whichever platform happens not to produce it; the set of
    /// surviving names is the thing the user actually loses when this breaks,
    /// and it is checked identically everywhere.
    ///
    /// Without the lock in `update_pinned_tags` this fails on every run: writers
    /// read the same list and each writes back a full copy, so most of the
    /// `keep-*` additions are overwritten and most of the `doomed-*` removals
    /// come back from under a stale snapshot. Measured on master's shape, 1-4
    /// of 8 pins survived and 3-7 of 8 unpins were resurrected.
    #[test]
    fn concurrent_edits_do_not_overwrite_one_another() {
        const WRITERS: usize = 8;
        const ROUNDS: usize = 4;

        let dir = temp_dir("pinned-tags-race");
        let path = dir.join("pinned-tags.json");
        let lock = Mutex::new(());

        // Seed the file with the tags the removers will delete, plus bystanders
        // nobody touches. The bystanders are a control: they are in every
        // writer's snapshot, so a lost update does NOT drop them, and they stay
        // green either way. If they ever go missing the file was truncated or
        // clobbered outright, which is a different failure from this one.
        let seeded: Vec<PinnedTag> = (0..WRITERS)
            .flat_map(|writer| {
                [
                    PinnedTag {
                        name: format!("doomed-{writer}"),
                        color: "#000000".to_string(),
                        files: vec![],
                    },
                    PinnedTag {
                        name: format!("bystander-{writer}"),
                        color: "#111111".to_string(),
                        files: vec![],
                    },
                ]
            })
            .collect();
        fs::write(&path, serde_json::to_string(&seeded).unwrap()).unwrap();

        std::thread::scope(|scope| {
            for writer in 0..WRITERS {
                let path = path.as_path();
                let lock = &lock;
                scope.spawn(move || {
                    for round in 0..ROUNDS {
                        save_pinned_tag_at(
                            lock,
                            path,
                            format!("keep-{writer}"),
                            "#222222".to_string(),
                            vec![format!("/tmp/{writer}-{round}.md")],
                        )
                        .unwrap();
                    }
                });
                scope.spawn(move || {
                    for _ in 0..ROUNDS {
                        remove_pinned_tag_at(lock, path, format!("doomed-{writer}")).unwrap();
                    }
                });
            }
        });

        let survivors = read_pinned_tags_at(&path);
        let found = names(&survivors);

        let expected: HashSet<String> = (0..WRITERS)
            .flat_map(|writer| [format!("keep-{writer}"), format!("bystander-{writer}")])
            .collect();
        assert_eq!(
            found, expected,
            "every pin written concurrently must survive and every unpin must stick"
        );
        // One entry per name: a writer that re-ran its own save must have found
        // its earlier entry rather than appending a duplicate.
        assert_eq!(survivors.len(), expected.len());

        fs::remove_dir_all(&dir).unwrap();
    }

    /// Re-pinning a tag replaces its color and file list in place.
    #[test]
    fn saving_an_existing_tag_updates_it_rather_than_duplicating_it() {
        let dir = temp_dir("pinned-tags-update");
        let path = dir.join("pinned-tags.json");
        let lock = Mutex::new(());

        save_pinned_tag_at(
            &lock,
            &path,
            "work".to_string(),
            "#1a73e8".to_string(),
            vec!["/tmp/a.md".to_string()],
        )
        .unwrap();
        save_pinned_tag_at(
            &lock,
            &path,
            "work".to_string(),
            "#d93025".to_string(),
            vec!["/tmp/b.md".to_string()],
        )
        .unwrap();

        let tags = read_pinned_tags_at(&path);
        assert_eq!(tags.len(), 1);
        assert_eq!(tags[0].color, "#d93025");
        assert_eq!(tags[0].files, vec!["/tmp/b.md".to_string()]);

        remove_pinned_tag_at(&lock, &path, "work".to_string()).unwrap();
        assert!(read_pinned_tags_at(&path).is_empty());

        fs::remove_dir_all(&dir).unwrap();
    }

    /// A poisoned lock must not disable pinning for the rest of the session.
    #[test]
    fn a_panicking_writer_does_not_lock_out_the_next_one() {
        let dir = temp_dir("pinned-tags-poison");
        let path = dir.join("pinned-tags.json");
        let lock = Mutex::new(());

        let panicked = std::thread::scope(|scope| {
            scope
                .spawn(|| {
                    update_pinned_tags(&lock, &path, |_| panic!("edit blew up")).unwrap();
                })
                .join()
        });
        assert!(panicked.is_err());
        assert!(lock.is_poisoned());

        // The panic happened before `atomic_write`, so nothing was published;
        // the next writer must both acquire the lock and see an intact file.
        save_pinned_tag_at(
            &lock,
            &path,
            "after".to_string(),
            "#188038".to_string(),
            vec![],
        )
        .unwrap();
        let tags = read_pinned_tags_at(&path);
        assert_eq!(names(&tags), HashSet::from(["after".to_string()]));

        fs::remove_dir_all(&dir).unwrap();
    }
}
