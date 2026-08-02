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
}

/// Locks `mutex`, recovering the guarded value if a previous holder panicked.
///
/// These mutexes guard plain bookkeeping — the window registry, pending
/// startup paths, the watcher map — none of which is left in a torn state by
/// a panic elsewhere. Propagating poisoning instead would turn one panic into
/// a permanently unusable registry: every later `set_window_meta`,
/// `list_viewer_windows` and window-destroyed handler would panic in turn.
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

fn read_pinned_tags(app: &AppHandle) -> Vec<PinnedTag> {
    pinned_tags_path(app)
        .ok()
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|json| serde_json::from_str(&json).ok())
        .unwrap_or_default()
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
    let mut tags = read_pinned_tags(&app);
    if let Some(tag) = tags.iter_mut().find(|tag| tag.name == name) {
        tag.color = color;
        tag.files = files;
    } else {
        tags.push(PinnedTag { name, color, files });
    }
    let json = serde_json::to_string(&tags).map_err(|error| error.to_string())?;
    crate::atomic_write(&pinned_tags_path(&app)?, json.as_bytes())
        .map_err(|error| error.to_string())
}

pub fn remove_pinned_tag(app: AppHandle, name: String) -> Result<(), String> {
    let mut tags = read_pinned_tags(&app);
    tags.retain(|tag| tag.name != name);
    let json = serde_json::to_string(&tags).map_err(|error| error.to_string())?;
    crate::atomic_write(&pinned_tags_path(&app)?, json.as_bytes())
        .map_err(|error| error.to_string())
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
