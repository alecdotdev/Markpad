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
    pub(crate) startup_file: Mutex<Option<String>>,
    pub(crate) last_focused_viewer: Mutex<Option<String>>,
    window_registry: Mutex<HashMap<String, WindowMeta>>,
    window_counter: AtomicU64,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            startup_file: Mutex::new(None),
            last_focused_viewer: Mutex::new(None),
            window_registry: Mutex::new(HashMap::new()),
            window_counter: AtomicU64::new(0),
        }
    }
}

#[derive(Clone, serde::Serialize)]
struct WindowMeta {
    number: u64,
    active_tab_title: String,
    tab_count: usize,
}

#[derive(Clone, serde::Serialize)]
pub struct WindowListEntry {
    label: String,
    #[serde(flatten)]
    meta: WindowMeta,
}

pub fn set_window_meta(
    window: tauri::Window,
    state: State<'_, AppState>,
    active_tab_title: String,
    tab_count: usize,
) {
    let label = window.label().to_string();
    if label != "main" && !label.starts_with("window-") {
        return;
    }
    let mut registry = state.window_registry.lock().unwrap();
    let entry = registry.entry(label).or_insert_with(|| WindowMeta {
        number: state.window_counter.fetch_add(1, Ordering::SeqCst) + 1,
        active_tab_title: String::new(),
        tab_count: 0,
    });
    entry.active_tab_title = active_tab_title;
    entry.tab_count = tab_count;
}

pub fn list_viewer_windows(state: State<'_, AppState>) -> Vec<WindowListEntry> {
    let registry = state.window_registry.lock().unwrap();
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

pub fn save_window_state(app: AppHandle, json: String) -> Result<(), String> {
    fs::write(window_state_path(&app)?, json).map_err(|e| e.to_string())
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

    let last = app
        .state::<AppState>()
        .last_focused_viewer
        .lock()
        .unwrap()
        .clone();
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
    let mut watchers = state.watchers.lock().unwrap();
    watchers.remove(&label);
    let event_label = label.clone();
    let mut watcher = RecommendedWatcher::new(
        move |result: Result<notify::Event, notify::Error>| {
            if result.is_ok() {
                let _ = handle.emit_to(event_label.as_str(), "file-changed", ());
            }
        },
        Config::default(),
    )
    .map_err(|e| e.to_string())?;
    watcher
        .watch(Path::new(&path), RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;
    watchers.insert(label, watcher);
    Ok(())
}

pub fn unwatch_file(window: tauri::Window, state: State<'_, WatcherState>) -> Result<(), String> {
    state.watchers.lock().unwrap().remove(window.label());
    Ok(())
}

pub fn send_markdown_path(state: State<'_, AppState>) -> Vec<String> {
    let mut files: Vec<String> = std::env::args()
        .skip(1)
        .filter(|arg| !arg.starts_with('-'))
        .collect();
    if let Some(path) = state.startup_file.lock().unwrap().take() {
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
                *state.last_focused_viewer.lock().unwrap() = Some(label.to_string());
            }
        }
        tauri::WindowEvent::Destroyed => {
            let state = window.state::<WatcherState>();
            state.watchers.lock().unwrap().remove(window.label());
            let app_state = window.state::<AppState>();
            app_state
                .window_registry
                .lock()
                .unwrap()
                .remove(window.label());
        }
        _ => {}
    }
}
