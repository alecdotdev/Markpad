use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use serde::Serialize;
use tauri::AppHandle;

#[cfg(target_os = "windows")]
use mslnk::ShellLink;
#[cfg(target_os = "windows")]
use winreg::enums::*;
#[cfg(target_os = "windows")]
use winreg::RegKey;

const APP_NAME: &str = "Markpad";
#[cfg(target_os = "windows")]
const EXE_NAME: &str = "Markpad.exe";

#[derive(Serialize)]
pub struct InstallStatus {
    pub is_installed: bool,
    pub all_users: bool,
    pub version: String,
}

#[cfg(target_os = "windows")]
pub fn get_install_path(all_users: bool) -> PathBuf {
    if all_users {
        // Program Files
        let program_files = env::var("ProgramFiles").unwrap_or_else(|_| "C:\\Program Files".to_string());
        PathBuf::from(program_files).join(APP_NAME)
    } else {
        // AppData/Local/Markpad
        let local_app_data = env::var("LOCALAPPDATA").unwrap_or_else(|_| {
            let user_profile = env::var("USERPROFILE").unwrap_or_else(|_| "C:\\Users\\Default".to_string());
            format!("{}\\AppData\\Local", user_profile)
        });
        PathBuf::from(local_app_data).join(APP_NAME)
    }
}

#[cfg(target_os = "windows")]
pub fn is_installed() -> bool {
    let Ok(current_exe) = env::current_exe() else { return false; };
    
    // Check both potential locations
    let user_path = get_install_path(false).join(EXE_NAME);
    let machine_path = get_install_path(true).join(EXE_NAME);

    let current_str = current_exe.to_string_lossy().to_lowercase();
    let user_str = user_path.to_string_lossy().to_lowercase();
    let machine_str = machine_path.to_string_lossy().to_lowercase();

    // Direct comparison first
    if current_str == user_str || current_str == machine_str {
        return true;
    }

    // Try canonicalize if they exist
    if let Ok(c_exe) = fs::canonicalize(&current_exe) {
        let c_str = c_exe.to_string_lossy().to_lowercase();
        
        if user_path.exists() {
            if let Ok(i_exe) = fs::canonicalize(&user_path) {
                if c_str == i_exe.to_string_lossy().to_lowercase() { return true; }
            }
        }
        
        if machine_path.exists() {
            if let Ok(i_exe) = fs::canonicalize(&machine_path) {
                if c_str == i_exe.to_string_lossy().to_lowercase() { return true; }
            }
        }
    }

    false
}

#[cfg(not(target_os = "windows"))]
pub fn is_installed() -> bool {
    // On macOS/Linux, assume installed or running from bundle
    true
}

#[tauri::command]
#[cfg(target_os = "windows")]
pub async fn check_install_status() -> InstallStatus {
    println!("Checking install status...");
    
    // Check HKCU
    println!("Checking HKCU...");
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    if let Ok(key) = hkcu.open_subkey_with_flags(format!("Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{}", APP_NAME), KEY_READ) {
        if let Ok(version) = key.get_value::<String, _>("DisplayVersion") {
            println!("Found in HKCU: {}", version);
            return InstallStatus {
                is_installed: true,
                all_users: false,
                version,
            };
        }
    }

    // Check HKLM
    println!("Checking HKLM...");
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    if let Ok(key) = hklm.open_subkey_with_flags(format!("Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{}", APP_NAME), KEY_READ) {
        if let Ok(version) = key.get_value::<String, _>("DisplayVersion") {
            println!("Found in HKLM: {}", version);
            return InstallStatus {
                is_installed: true,
                all_users: true,
                version,
            };
        }
    }
    
    println!("Not found.");

    InstallStatus {
        is_installed: false,
        all_users: false,
        version: String::new(),
    }
}

#[tauri::command]
#[cfg(not(target_os = "windows"))]
#[tauri::command]
#[cfg(not(target_os = "windows"))]
pub async fn check_install_status() -> InstallStatus {
    InstallStatus {
        is_installed: true,
        all_users: false,
        version: "0.0.0".to_string(),
    }
}

#[tauri::command]
#[cfg(target_os = "windows")]
pub async fn install_app(
    handle: AppHandle,
    all_users: bool,
    register_md: bool,
    desktop_shortcut: bool,
    start_menu: bool,
    launch_after: bool
) -> Result<(), String> {
    let current_exe = env::current_exe().map_err(|e| e.to_string())?;
    let install_dir = get_install_path(all_users);
    let target_exe = install_dir.join(EXE_NAME);

    println!("Installing to: {}", install_dir.display());

    // 1. Create directory
    if !install_dir.exists() {
        fs::create_dir_all(&install_dir).map_err(|e| e.to_string())?;
    }

    // 2. Copy executable
    println!("Copying executable...");
    // Retry loop in case the app is closing slowly during update
    let mut retries = 0;
    while retries < 5 {
        match fs::copy(&current_exe, &target_exe) {
            Ok(_) => {
                println!("Copy success.");
                break;
            }
            Err(e) => {
                println!("Copy failed (attempt {}): {}", retries, e);
                if retries == 4 {
                    return Err(format!("Failed to copy executable: {}", e));
                }
                std::thread::sleep(std::time::Duration::from_millis(500));
                retries += 1;
            }
        }
    }

    // 3. Shortcuts
    println!("Creating shortcuts...");
    if desktop_shortcut {
        let desktop = if all_users {
            env::var("PUBLIC").unwrap_or_else(|_| "C:\\Users\\Public".to_string()) + "\\Desktop"
        } else {
            env::var("USERPROFILE").unwrap() + "\\Desktop"
        };
        let lnk = PathBuf::from(desktop).join(format!("{}.lnk", APP_NAME));
        let sl = ShellLink::new(&target_exe).map_err(|e| e.to_string())?;
        sl.create_lnk(&lnk).map_err(|e| e.to_string())?;
    }

    if start_menu {
        let start_menu_path = if all_users {
            env::var("ProgramData").unwrap_or_else(|_| "C:\\ProgramData".to_string()) + "\\Microsoft\\Windows\\Start Menu\\Programs"
        } else {
            env::var("APPDATA").unwrap() + "\\Microsoft\\Windows\\Start Menu\\Programs"
        };
        let lnk = PathBuf::from(start_menu_path).join(format!("{}.lnk", APP_NAME));
        let sl = ShellLink::new(&target_exe).map_err(|e| e.to_string())?;
        sl.create_lnk(&lnk).map_err(|e| e.to_string())?;
    }

    // 4. Registry - Uninstaller
    println!("Updating registry...");
    let root_h = if all_users { HKEY_LOCAL_MACHINE } else { HKEY_CURRENT_USER };
    
    // If we are installing for all users (Admin), try to clean up old NSIS key from HKLM first
    if all_users {
        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        let _ = hklm.delete_subkey(format!("Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{}", APP_NAME));
    }

    let hk = RegKey::predef(root_h);
    let (key, _) = hk.create_subkey(format!("Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{}", APP_NAME)).map_err(|e| e.to_string())?;
    
    key.set_value("DisplayName", &APP_NAME).map_err(|e| e.to_string())?;
    key.set_value("UninstallString", &format!("\"{}\" --uninstall", target_exe.display())).map_err(|e| e.to_string())?;
    key.set_value("QuietUninstallString", &format!("\"{}\" --uninstall", target_exe.display())).map_err(|e| e.to_string())?;
    key.set_value("DisplayIcon", &target_exe.to_str().unwrap()).map_err(|e| e.to_string())?;
    key.set_value("Publisher", &"alecdotdev").map_err(|e| e.to_string())?;
    
    let version = handle.package_info().version.to_string();
    key.set_value("DisplayVersion", &version).map_err(|e| e.to_string())?;
    
    key.set_value("InstallLocation", &install_dir.to_str().unwrap()).map_err(|e| e.to_string())?;
    key.set_value("NoModify", &1u32).map_err(|e| e.to_string())?;
    key.set_value("NoRepair", &1u32).map_err(|e| e.to_string())?;
    
    // Install Date (YYYYMMDD)
    let date = chrono::Local::now().format("%Y%m%d").to_string();
    key.set_value("InstallDate", &date).map_err(|e| e.to_string())?;
    
    // Estimated Size (KB)
    if let Ok(meta) = fs::metadata(&target_exe) {
        let size_kb = (meta.len() / 1024) as u32;
        key.set_value("EstimatedSize", &size_kb).map_err(|e| e.to_string())?;
    }

    // 5. File Associations
    println!("Registering file associations...");
    if register_md {
        register_file_association(&target_exe, all_users).map_err(|e| e.to_string())?;
    }

    // 6. Launch and Exit
    println!("Launching app...");
    if launch_after {
        std::process::Command::new(target_exe).spawn().map_err(|e| e.to_string())?;
    }
    handle.exit(0);

    Ok(())
}

#[tauri::command]
#[cfg(not(target_os = "windows"))]
pub async fn install_app(
    _handle: AppHandle,
    _all_users: bool,
    _register_md: bool,
    _desktop_shortcut: bool,
    _start_menu: bool,
    _launch_after: bool
) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
#[cfg(target_os = "windows")]
pub async fn uninstall_app(handle: AppHandle, target_all_users: Option<bool>) -> Result<(), String> {
    let current_exe = env::current_exe().map_err(|e| e.to_string())?;
    
    let install_dir = if let Some(all_users) = target_all_users {
        get_install_path(all_users)
    } else {
        // Auto-detect based on running location
        let machine_path = get_install_path(true);
        let current_str = current_exe.to_string_lossy().to_lowercase();
        let machine_str = machine_path.to_string_lossy().to_lowercase();
        
        if current_str.starts_with(&machine_str) {
            machine_path
        } else {
            get_install_path(false)
        }
    };
    
    // 1. Delete shortcuts
    let desktop_user = env::var("USERPROFILE").unwrap() + "\\Desktop";
    let desktop_public = env::var("PUBLIC").unwrap_or_else(|_| "C:\\Users\\Public".to_string()) + "\\Desktop";
    let _ = fs::remove_file(PathBuf::from(desktop_user).join(format!("{}.lnk", APP_NAME)));
    let _ = fs::remove_file(PathBuf::from(desktop_public).join(format!("{}.lnk", APP_NAME)));
    
    let start_user = env::var("APPDATA").unwrap() + "\\Microsoft\\Windows\\Start Menu\\Programs";
    let start_machine = env::var("ProgramData").unwrap_or_else(|_| "C:\\ProgramData".to_string()) + "\\Microsoft\\Windows\\Start Menu\\Programs";
    let _ = fs::remove_file(PathBuf::from(start_user).join(format!("{}.lnk", APP_NAME)));
    let _ = fs::remove_file(PathBuf::from(start_machine).join(format!("{}.lnk", APP_NAME)));

    // 2. Delete Registry Keys (try both just in case)
    for root_h in [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE] {
        let root = RegKey::predef(root_h);
        let _ = root.delete_subkey(format!("Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{}", APP_NAME));
        let _ = root.delete_subkey_all("Software\\Classes\\.md");
        let _ = root.delete_subkey_all("Software\\Classes\\.markdown");
        let _ = root.delete_subkey_all("Software\\Classes\\Markpad.File");
    }

    // 3. Self-destruction
    // We create a batch file to delete the app, but run it via VBScript to keep it invisible
    let batch_content = format!(
        "@echo off\r\n\
        set /a retries=0\r\n\
        :loop\r\n\
        taskkill /F /IM {} > nul 2>&1\r\n\
        timeout /t 1 /nobreak > nul\r\n\
        del /f /q \"{}\" > nul 2>&1\r\n\
        if exist \"{}\" (\r\n\
            set /a retries+=1\r\n\
            if %retries% geq 20 goto cleanup\r\n\
            goto loop\r\n\
        )\r\n\
        rmdir /s /q \"{}\" > nul 2>&1\r\n\
        :cleanup\r\n\
        del \"%~f0\" > nul 2>&1",
        EXE_NAME,
        install_dir.join(EXE_NAME).display(),
        install_dir.join(EXE_NAME).display(),
        install_dir.display()
    );
    
    let temp_dir = env::temp_dir();
    let batch_path = temp_dir.join("uninstall_markdown_viewer.bat");
    let vbs_path = temp_dir.join("uninstall_markdown_viewer.vbs");

    fs::write(&batch_path, batch_content).map_err(|e| e.to_string())?;

    // VBScript to run the batch file invisibly
    let vbs_content = format!(
        "CreateObject(\"Wscript.Shell\").Run \"\"\"{}\"\"\", 0, False\r\n\
        Set fso = CreateObject(\"Scripting.FileSystemObject\")\r\n\
        fso.DeleteFile WScript.ScriptFullName",
        batch_path.display()
    );
    
    fs::write(&vbs_path, vbs_content).map_err(|e| e.to_string())?;
    
    std::process::Command::new("wscript")
        .arg(&vbs_path)
        .spawn()
        .map_err(|e| e.to_string())?;

    handle.exit(0);
    Ok(())
}

#[tauri::command]
#[cfg(not(target_os = "windows"))]
pub async fn uninstall_app(_handle: AppHandle, _target_all_users: Option<bool>) -> Result<(), String> {
     Ok(())
}

#[cfg(target_os = "windows")]
fn register_file_association(exe_path: &Path, all_users: bool) -> Result<(), std::io::Error> {
    let root_h = if all_users { HKEY_LOCAL_MACHINE } else { HKEY_CURRENT_USER };
    let root = RegKey::predef(root_h);
    
    // .md
    let (md_key, _) = root.create_subkey("Software\\Classes\\.md")?;
    md_key.set_value("", &"Markpad.File")?;
    
    // .markdown
    let (markdown_key, _) = root.create_subkey("Software\\Classes\\.markdown")?;
    markdown_key.set_value("", &"Markpad.File")?;

    // Markpad.File
    let (file_key, _) = root.create_subkey("Software\\Classes\\Markpad.File")?;
    file_key.set_value("", &"Markpad File")?;
    
    let (icon_key, _) = file_key.create_subkey("DefaultIcon")?;
    icon_key.set_value("", &format!("\"{}\",0", exe_path.display()))?;

    let (shell_key, _) = file_key.create_subkey("shell\\open\\command")?;
    shell_key.set_value("", &format!("\"{}\" \"%1\"", exe_path.display()))?;

    Ok(())
}
