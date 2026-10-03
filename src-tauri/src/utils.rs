use crate::error::{AppError, AppResult};
use std::path::PathBuf;
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};

pub fn get_binary_path(app: &AppHandle, name: &str) -> AppResult<PathBuf> {
    #[cfg(target_os = "windows")]
    let bin_name = format!("bin/{}.exe", name);
    #[cfg(not(target_os = "windows"))]
    let bin_name = format!("bin/{}", name);

    let path = app
        .path()
        .resolve(&bin_name, BaseDirectory::Resource)
        .map_err(|e| AppError::Io(std::io::Error::new(std::io::ErrorKind::NotFound, e)))?;

    Ok(path)
}

pub fn kill_process_tree(pid: u32) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let output = std::process::Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .creation_flags(0x08000000)
            .output()
            .map_err(|error| error.to_string())?;

        if !output.status.success() {
            let error = String::from_utf8_lossy(&output.stderr);
            if !error.to_ascii_lowercase().contains("not found") {
                return Err(format!("Taskkill failed: {}", error));
            }
        }
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let status = std::process::Command::new("kill")
            .args(["-9", &pid.to_string()])
            .status()
            .map_err(|error| error.to_string())?;
        if !status.success() {
            return Err(format!("kill -9 {pid} failed"));
        }
        Ok(())
    }
}

pub fn get_enhanced_path(app: &AppHandle) -> String {
    // Try both PATH and Path to ensure we capture the system environment on Windows
    let system_path = std::env::var("PATH")
        .or_else(|_| std::env::var("Path"))
        .unwrap_or_default();

    // Resolve the "bin" directory in resources
    // We try to resolve a known file "ffmpeg.exe" (Windows) or "ffmpeg" (Unix) to find the dir
    #[cfg(target_os = "windows")]
    let dummy_bin = "bin/ffmpeg.exe";
    #[cfg(not(target_os = "windows"))]
    let dummy_bin = "bin/ffmpeg";

    if let Ok(path) = app.path().resolve(dummy_bin, BaseDirectory::Resource) {
        if let Some(parent) = path.parent() {
            let mut bin_dir = parent.to_string_lossy().to_string();

            // Fix Windows UNC path prefix (\\?\) which can confuse some tools
            #[cfg(target_os = "windows")]
            if bin_dir.starts_with(r"\\?\") {
                bin_dir = bin_dir[4..].to_string();
            }

            println!("[Debug] Enhanced PATH via Resource: {}", bin_dir);

            #[cfg(target_os = "windows")]
            return format!("{};{}", bin_dir, system_path);

            #[cfg(not(target_os = "windows"))]
            return format!("{}:{}", bin_dir, system_path);
        }
    }

    // Fallback for Dev environment: Try to find "src-tauri/bin" or "bin" relative to CWD
    // This handles cases where Resource resolution might fail in Dev
    let dev_candidates = vec!["src-tauri/bin", "bin", "../bin"];
    for candidate in dev_candidates {
        if let Ok(abs_path) = std::fs::canonicalize(candidate) {
            if abs_path.join("bun.exe").exists() || abs_path.join("bun").exists() {
                let bin_dir = abs_path.to_string_lossy().to_string();
                println!("[Debug] Enhanced PATH via Dev Fallback: {}", bin_dir);

                #[cfg(target_os = "windows")]
                return format!("{};{}", bin_dir, system_path);

                #[cfg(not(target_os = "windows"))]
                return format!("{}:{}", bin_dir, system_path);
            }
        }
    }

    println!("[Debug] Enhanced PATH: Could not resolve bin dir, using system path only");
    system_path
}
