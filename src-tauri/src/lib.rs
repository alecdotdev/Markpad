use comrak::{markdown_to_html, ComrakExtensionOptions, ComrakOptions};
use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use std::fs;
use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri::menu::ContextMenu;
use regex::{Regex, Captures};
use std::borrow::Cow;


struct WatcherState {
    watcher: Mutex<Option<RecommendedWatcher>>,
}


mod setup;



#[tauri::command]
async fn show_window(window: tauri::Window) {
    window.show().unwrap();
}

fn process_obsidian_embeds(content: &str) -> Cow<'_, str> {
    let re = Regex::new(r"!\[\[(.*?)\]\]").unwrap();
    
    re.replace_all(content, |caps: &Captures| {
        let inner = &caps[1];
        let mut parts = inner.split('|');
        let path = parts.next().unwrap_or("");
        let size = parts.next();
        
        let path_escaped = path.replace(" ", "%20");
        
        if let Some(size_str) = size {
            if size_str.contains('x') {
                let mut dims = size_str.split('x');
                let width = dims.next().unwrap_or("");
                let height = dims.next().unwrap_or("");
                format!("<img src=\"{}\" width=\"{}\" height=\"{}\" alt=\"{}\" />", path_escaped, width, height, path)
            } else {
                format!("<img src=\"{}\" width=\"{}\" alt=\"{}\" />", path_escaped, size_str, path)
            }
        } else {
             format!("<img src=\"{}\" alt=\"{}\" />", path_escaped, path)
        }
    })
}

#[tauri::command]
fn convert_markdown(content: &str) -> String {
    let processed = process_obsidian_embeds(content);
    
    let mut options = ComrakOptions {
        extension: ComrakExtensionOptions {
            strikethrough: true,
            table: true,
            autolink: true,
            tasklist: true,
            superscript: false,
            footnotes: true,
            description_lists: true,
            ..ComrakExtensionOptions::default()
        },
        ..ComrakOptions::default()
    };
    options.render.unsafe_ = true;
    options.render.hardbreaks = true;
    options.render.sourcepos = true;

    markdown_to_html(&processed, &options)
}

#[tauri::command]
fn open_markdown(path: String) -> Result<String, String> {
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    Ok(convert_markdown(&content))
}

#[tauri::command]
fn render_markdown(content: String) -> String {
    convert_markdown(&content)
}

#[tauri::command]
fn read_file_content(path: String) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_file_content(path: String, content: String) -> Result<(), String> {
    fs::write(path, content).map_err(|e| e.to_string())
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
fn watch_file(handle: AppHandle, state: State<'_, WatcherState>, path: String) -> Result<(), String> {
    let mut watcher_lock = state.watcher.lock().unwrap();

    *watcher_lock = None;

    let path_to_watch = path.clone();
    let app_handle = handle.clone();

    let mut watcher = RecommendedWatcher::new(
        move |res: Result<notify::Event, notify::Error>| {
            if let Ok(_) = res {
                let _ = app_handle.emit("file-changed", ());
            }
        },
        Config::default(),
    )
    .map_err(|e| e.to_string())?;

    watcher
        .watch(Path::new(&path_to_watch), RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;

    *watcher_lock = Some(watcher);

    Ok(())
}

#[tauri::command]
fn unwatch_file(state: State<'_, WatcherState>) -> Result<(), String> {
    let mut watcher_lock = state.watcher.lock().unwrap();
    *watcher_lock = None;
    Ok(())
}

struct AppState {
    startup_file: Mutex<Option<String>>,
}

#[tauri::command]
fn send_markdown_path(state: State<'_, AppState>) -> Vec<String> {
    let mut files: Vec<String> = std::env::args()
        .skip(1)
        .filter(|arg| !arg.starts_with("-"))
        .collect();

    if let Some(startup_path) = state.startup_file.lock().unwrap().as_ref() {
        if !files.contains(startup_path) {
            files.insert(0, startup_path.clone());
        }
    }
    
    files
}

#[tauri::command]
async fn get_app_mode() -> String {

    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|arg| arg == "--uninstall") {
        return "uninstall".to_string();
    }

    let current_exe = std::env::current_exe().unwrap_or_default();
    let exe_name = current_exe.file_name().unwrap_or_default().to_string_lossy().to_lowercase();
    
    let is_installer_mode = args.iter().any(|arg| arg == "--install") || exe_name.contains("installer");
    
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

#[tauri::command]
fn is_win11() -> bool {
    #[cfg(target_os = "windows")]
    {
        use winreg::RegKey;
        use winreg::enums::*;

        let hklim = RegKey::predef(HKEY_LOCAL_MACHINE);
        if let Ok(current_version) = hklim.open_subkey("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion") {
            if let Ok(current_build) = current_version.get_value::<String, _>("CurrentBuild") {
                if let Ok(build_num) = current_build.parse::<u32>() {
                    return build_num >= 22000;
                }
            }
        }
    }
    false
}

#[tauri::command]
fn show_context_menu(
    app: AppHandle,
    state: State<'_, ContextMenuState>,
    window: tauri::Window,
    menu_type: String, // 'document', 'tab', 'tab_bar'
    path: Option<String>,
    tab_id: Option<String>,
    has_selection: bool,
) -> Result<(), String> {
    {
        let mut path_lock = state.active_path.lock().unwrap();
        *path_lock = path.clone();
        let mut tab_lock = state.active_tab_id.lock().unwrap();
        *tab_lock = tab_id.clone();
    }

    let menu = tauri::menu::Menu::new(&app).map_err(|e| e.to_string())?;

    match menu_type.as_str() {
        "tab" => {
            let new_tab = tauri::menu::MenuItem::with_id(&app, "ctx_tab_new", "New Tab", true, Some("Ctrl+T")).map_err(|e| e.to_string())?;
            menu.append(&new_tab).map_err(|e| e.to_string())?;

            let undo = tauri::menu::MenuItem::with_id(&app, "ctx_tab_undo", "Undo Close Tab", true, Some("Ctrl+Shift+T")).map_err(|e| e.to_string())?;
            menu.append(&undo).map_err(|e| e.to_string())?;

            let rename = tauri::menu::MenuItem::with_id(&app, "ctx_tab_rename", "Rename", true, None::<&str>).map_err(|e| e.to_string())?;
            menu.append(&rename).map_err(|e| e.to_string())?;

            let sep = tauri::menu::PredefinedMenuItem::separator(&app).map_err(|e| e.to_string())?;
            menu.append(&sep).map_err(|e| e.to_string())?;

            let close = tauri::menu::MenuItem::with_id(&app, "ctx_tab_close", "Close Tab", true, Some("Ctrl+W")).map_err(|e| e.to_string())?;
            menu.append(&close).map_err(|e| e.to_string())?;

            let close_others = tauri::menu::MenuItem::with_id(&app, "ctx_tab_close_others", "Close Other Tabs", true, None::<&str>).map_err(|e| e.to_string())?;
            menu.append(&close_others).map_err(|e| e.to_string())?;

            let close_right = tauri::menu::MenuItem::with_id(&app, "ctx_tab_close_right", "Close Tabs to Right", true, None::<&str>).map_err(|e| e.to_string())?;
            menu.append(&close_right).map_err(|e| e.to_string())?;
        },
        "tab_bar" => {
            let new_tab = tauri::menu::MenuItem::with_id(&app, "ctx_tab_new", "New Tab", true, Some("Ctrl+T")).map_err(|e| e.to_string())?;
            menu.append(&new_tab).map_err(|e| e.to_string())?;

            let undo = tauri::menu::MenuItem::with_id(&app, "ctx_tab_undo", "Undo Close Tab", true, Some("Ctrl+Shift+T")).map_err(|e| e.to_string())?;
            menu.append(&undo).map_err(|e| e.to_string())?;
        },
        _ => {
            // Document / Default
            if has_selection {
                let copy = tauri::menu::PredefinedMenuItem::copy(&app, Some("Copy")).map_err(|e| e.to_string())?;
                menu.append(&copy).map_err(|e| e.to_string())?;
            }

            let select_all = tauri::menu::PredefinedMenuItem::select_all(&app, Some("Select All")).map_err(|e| e.to_string())?;
            menu.append(&select_all).map_err(|e| e.to_string())?;

            if let Some(_) = path {
                let sep = tauri::menu::PredefinedMenuItem::separator(&app).map_err(|e| e.to_string())?;
                menu.append(&sep).map_err(|e| e.to_string())?;

                let open_folder = tauri::menu::MenuItem::with_id(&app, "ctx_open_folder", "Open File Location", true, None::<&str>).map_err(|e| e.to_string())?;
                menu.append(&open_folder).map_err(|e| e.to_string())?;

                let edit = tauri::menu::MenuItem::with_id(&app, "ctx_edit", "Edit", true, None::<&str>).map_err(|e| e.to_string())?;
                menu.append(&edit).map_err(|e| e.to_string())?;
                
                // Add separator before close
                let sep2 = tauri::menu::PredefinedMenuItem::separator(&app).map_err(|e| e.to_string())?;
                menu.append(&sep2).map_err(|e| e.to_string())?;

                let close = tauri::menu::MenuItem::with_id(&app, "ctx_close", "Close File", true, None::<&str>).map_err(|e| e.to_string())?;
                menu.append(&close).map_err(|e| e.to_string())?;
            }
        }
    }

    menu.popup(window).map_err(|e| e.to_string())?;
    Ok(())
}

struct ContextMenuState {
    active_path: Mutex<Option<String>>,
    active_tab_id: Mutex<Option<String>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "windows")]
    {
        std::env::set_var(
            "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
            "--enable-features=SmoothScrolling",
        );
    }

    tauri::Builder::default()

        .manage(AppState {
            startup_file: Mutex::new(None),
        })
        .manage(WatcherState {
            watcher: Mutex::new(None),
        })
        .manage(ContextMenuState {
            active_path: Mutex::new(None),
            active_tab_id: Mutex::new(None),
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            println!("Single Instance Args: {:?}", args);
            
            let path_str = args.iter().skip(1).find(|a| !a.starts_with("-")).map(|a| a.as_str()).unwrap_or("");
            
            if !path_str.is_empty() {
                let path = std::path::Path::new(path_str);
                let resolved_path = if path.is_absolute() {
                    path_str.to_string()
                } else {
                    let cwd_path = std::path::Path::new(&cwd);
                    cwd_path.join(path).display().to_string()
                };
                
                let _ = app.get_webview_window("main").expect("no main window").emit("file-path", resolved_path);
            }
            let _ = app.get_webview_window("main").expect("no main window").set_focus();
        }))
        .plugin(tauri_plugin_prevent_default::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .on_menu_event(|app, event| {
             let id = event.id().as_ref();
             let state = app.state::<ContextMenuState>();

             match id {
                 "ctx_open_folder" | "ctx_edit" | "ctx_close" => {
                    let path_lock = state.active_path.lock().unwrap();
                    if let Some(path) = path_lock.as_ref() {
                        match id {
                            "ctx_open_folder" => { let _ = open_file_folder(path.clone()); }
                            "ctx_edit" => {
                                if let Some(window) = app.get_webview_window("main") {
                                    let _ = window.emit("menu-edit-file", ());
                                }
                            }
                            "ctx_close" => {
                                if let Some(window) = app.get_webview_window("main") {
                                    let _ = window.emit("menu-close-file", ());
                                }
                            }
                            _ => {}
                        }
                    }
                 }
                 "ctx_tab_rename" => {
                    let tab_lock = state.active_tab_id.lock().unwrap();
                    if let Some(tab_id) = tab_lock.as_ref() {
                       if let Some(window) = app.get_webview_window("main") {
                           let _ = window.emit("menu-tab-rename", tab_id);
                       }
                    }
                 }
                 "ctx_tab_new" => {
                     if let Some(window) = app.get_webview_window("main") {
                         let _ = window.emit("menu-tab-new", ());
                     }
                 }
                 "ctx_tab_undo" => {
                     if let Some(window) = app.get_webview_window("main") {
                         let _ = window.emit("menu-tab-undo", ());
                     }
                 }
                 "ctx_tab_close" => {
                     let tab_lock = state.active_tab_id.lock().unwrap();
                     if let Some(tab_id) = tab_lock.as_ref() {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.emit("menu-tab-close", tab_id);
                        }
                     }
                 }
                 "ctx_tab_close_others" => {
                    let tab_lock = state.active_tab_id.lock().unwrap();
                    if let Some(tab_id) = tab_lock.as_ref() {
                       if let Some(window) = app.get_webview_window("main") {
                           let _ = window.emit("menu-tab-close-others", tab_id);
                       }
                    }
                 }
                 "ctx_tab_close_right" => {
                    let tab_lock = state.active_tab_id.lock().unwrap();
                    if let Some(tab_id) = tab_lock.as_ref() {
                       if let Some(window) = app.get_webview_window("main") {
                           let _ = window.emit("menu-tab-close-right", tab_id);
                       }
                    }
                 }
                 _ => {}
             }
        })
        .setup(|app| {
            let args: Vec<String> = std::env::args().collect();
            println!("Setup Args: {:?}", args);

            let current_exe = std::env::current_exe().unwrap_or_default();
            let exe_name = current_exe.file_name().unwrap_or_default().to_string_lossy().to_lowercase();
            let is_installer_mode = args.iter().any(|arg| arg == "--install") || exe_name.contains("installer");

            let label = if is_installer_mode { "installer" } else { "main" };

            let _window = tauri::WebviewWindowBuilder::new(app, label, tauri::WebviewUrl::App("index.html".into()))
                .title("Markpad")
                .inner_size(850.0, 650.0)
                .min_inner_size(400.0, 300.0)
                .visible(false)
                .resizable(true)
                .decorations(false)
                .shadow(false)
                .center()
                .visible(false)
                .build()?;
                
            #[cfg(target_os = "windows")]
            {
               use tauri::window::Color;
               let _ = _window.set_background_color(Some(Color(18, 18, 18, 255)));
            }

            let _ = _window.set_shadow(true);


            let window = app.get_webview_window(label).unwrap();

            let file_path = args.iter().skip(1).find(|arg| !arg.starts_with("-"));

            if let Some(path) = file_path {
                let _ = window.emit("file-path", path.as_str());
            }

            // If installer, force size (this will be saved to installer-state, not main-state)
            if is_installer_mode {
                let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize { width: 450.0, height: 550.0 }));
                let _ = window.center();
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_markdown,
            render_markdown,
            send_markdown_path,
            read_file_content,
            save_file_content,

            get_app_mode,
            setup::install_app,
            setup::uninstall_app,
            setup::check_install_status,
            is_win11,
            open_file_folder,
            open_file_folder,
            rename_file,
            watch_file,
            unwatch_file,

            show_context_menu,
            show_window
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, _event| {
#[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = _event {
                if let Some(url) = urls.first() {
                    if let Ok(path_buf) = url.to_file_path() {
                         let path_str = path_buf.to_string_lossy().to_string();
                         
                         let state = _app_handle.state::<AppState>();
                         *state.startup_file.lock().unwrap() = Some(path_str.clone());
                         
                         if let Some(window) = _app_handle.get_webview_window("main") {
                             let _ = window.emit("file-path", path_str);
                             let _ = window.set_focus();
                         }
                    }
                }
            }
        });
}
