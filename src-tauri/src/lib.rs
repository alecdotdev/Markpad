use comrak::{markdown_to_html, ComrakExtensionOptions, ComrakOptions};

use std::fs;
use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri::menu::ContextMenu;

mod setup;



#[tauri::command]
async fn show_window(window: tauri::Window) {
    window.show().unwrap();
}

#[tauri::command]
fn open_markdown(path: String) -> Result<String, String> {
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;

    let options = ComrakOptions {
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

    let html_output = markdown_to_html(&content, &options);

    Ok(html_output)
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
fn send_markdown_path() -> Vec<String> {
    let args: Vec<String> = std::env::args().collect();
    args.into_iter()
        .skip(1)
        .filter(|arg| !arg.starts_with("-"))
        .collect()
}

#[tauri::command]
fn get_app_mode() -> String {
    // In debug mode (tauri dev), always run in "app" mode to bypass installer
    if cfg!(debug_assertions) {
        return "app".to_string();
    }

    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|arg| arg == "--uninstall") {
        return "uninstall".to_string();
    }
    
    if setup::is_installed() {
        "app".to_string()
    } else {
        // If we are not installed, but we are opening a file, just run in "app" mode (portable)
        if args.len() > 1 && !args[1].starts_with('-') {
            "app".to_string()
        } else {
            "installer".to_string()
        }
    }
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

        .manage(ContextMenuState {
            active_path: Mutex::new(None),
            active_tab_id: Mutex::new(None),
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            println!("Single Instance Args: {:?}", args);
            
            // Allow for robust finding of the file argument
            let path = args.iter().skip(1).find(|a| !a.starts_with("-")).map(|a| a.as_str()).unwrap_or("");
            
            let _ = app.get_webview_window("main").expect("no main window").emit("file-path", path);
            let _ = app.get_webview_window("main").expect("no main window").set_focus();
        }))
        .plugin(tauri_plugin_prevent_default::init())
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
            let window = app.get_webview_window("main").unwrap();

            // Find the first argument that doesn't start with '-'
            // This handles macOS adding -psn_... args and other flags
            let file_path = args.iter().skip(1).find(|arg| !arg.starts_with("-"));

            if let Some(path) = file_path {
                let _ = window.emit("file-path", path.as_str());
            }



            // Resize if installer
            let args: Vec<String> = std::env::args().collect();
            let is_uninstall = args.iter().any(|arg| arg == "--uninstall");
            if !setup::is_installed() || is_uninstall {
                // If it's not opening a file, resize to a nice installer size
                if args.len() <= 1 || args[1].starts_with('-') {
                   let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize { width: 450.0, height: 550.0 }));
                   let _ = window.center();
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_markdown,
            send_markdown_path,
            read_file_content,
            save_file_content,

            get_app_mode,
            setup::install_app,
            setup::uninstall_app,
            setup::check_install_status,
            open_file_folder,
            rename_file,

            show_context_menu,
            show_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
