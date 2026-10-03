use crate::error::{AppError, AppResult};
use crate::state::DownloadState;
use regex::Regex;
use std::collections::HashSet;
use tauri::{command, AppHandle, State};
use tauri_plugin_shell::ShellExt;

#[cfg(target_os = "windows")]
use winreg::enums::*;
#[cfg(target_os = "windows")]
use winreg::RegKey;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CookieCheckKind {
    Ok,
    InvalidBrowser,
    Locked,
    PermissionDenied,
    NotFound,
    DecryptFailed,
    ExecutionFailed,
}

#[derive(serde::Serialize)]
pub struct CookieCheckResult {
    pub success: bool,
    pub kind: CookieCheckKind,
    pub message: String,
    pub details: Option<String>,
}

fn cookie_check_result(
    success: bool,
    kind: CookieCheckKind,
    message: impl Into<String>,
    details: Option<String>,
) -> CookieCheckResult {
    CookieCheckResult {
        success,
        kind,
        message: message.into(),
        details,
    }
}

fn classify_cookie_check_output(_status_success: bool, combined_output: &str) -> CookieCheckResult {
    let lower = combined_output.to_ascii_lowercase();

    if lower.contains("database is locked")
        || lower.contains("could not copy chrome cookie database")
        || lower.contains("resource temporarily unavailable")
        || lower.contains("the process cannot access the file")
    {
        return cookie_check_result(
            false,
            CookieCheckKind::Locked,
            "浏览器文件被锁定：请彻底关闭浏览器（包括任务栏右下角托盘图标）",
            Some(combined_output.to_string()),
        );
    }

    if lower.contains("permission denied") {
        return cookie_check_result(
            false,
            CookieCheckKind::PermissionDenied,
            "无权读取文件：请尝试以管理员身份运行本程序",
            Some(combined_output.to_string()),
        );
    }

    if lower.contains("failed to decrypt") {
        return cookie_check_result(
            false,
            CookieCheckKind::DecryptFailed,
            "解密失败：可能是密钥不匹配或浏览器仍在后台运行 (DPAPI/App-Bound 加密限制)",
            Some(combined_output.to_string()),
        );
    }

    if lower.contains("could not find") || lower.contains("unsupported") {
        return cookie_check_result(
            false,
            CookieCheckKind::NotFound,
            "未找到 Cookies 或浏览器不受支持",
            Some(combined_output.to_string()),
        );
    }

    let extracted = Regex::new(r"(?i)extracted\s+(\d+)\s+cookies?\s+from")
        .expect("static cookie extraction regex");
    if let Some(captures) = extracted.captures(combined_output) {
        let count = captures
            .get(1)
            .and_then(|value| value.as_str().parse::<u64>().ok())
            .unwrap_or(0);
        if count > 0 {
            return cookie_check_result(
                true,
                CookieCheckKind::Ok,
                format!("验证成功（已读取 {} 个 Cookies）", count),
                None,
            );
        }
        return cookie_check_result(
            false,
            CookieCheckKind::NotFound,
            "浏览器中没有可用 Cookies",
            Some(combined_output.to_string()),
        );
    }

    cookie_check_result(
        false,
        CookieCheckKind::ExecutionFailed,
        "无法确认浏览器 Cookies 可用，请查看检测详情或改用 Cookies 文件",
        Some(combined_output.to_string()),
    )
}

#[command]
pub async fn check_browser_cookies(
    app: AppHandle,
    state: State<'_, DownloadState>,
    browser: String,
) -> AppResult<CookieCheckResult> {
    let _activity_guard = state
        .begin_tool_activity()
        .map_err(AppError::ExternalCommand)?;
    check_browser_cookies_internal(app, browser).await
}

async fn check_browser_cookies_internal(
    app: AppHandle,
    browser: String,
) -> AppResult<CookieCheckResult> {
    // Security: Prevent argument injection
    if browser.starts_with('-') {
        return Ok(cookie_check_result(
            false,
            CookieCheckKind::InvalidBrowser,
            "无效的浏览器名称",
            None,
        ));
    }

    // Run yt-dlp to check if we can extract cookies (avoids DB locked errors)
    // We use a dummy URL because newer yt-dlp requires a URL even for cookie checks
    // We expect this command to FAIL (exit code 1) usually (due to DNS error on dummy URL),
    // but we only care if it fails due to COOKIE errors.
    let output = app
        .shell()
        .sidecar("yt-dlp")
        .map_err(|e| {
            crate::error::AppError::ExternalCommand(format!("Failed to create sidecar: {}", e))
        })?
        .env("PATH", crate::utils::get_enhanced_path(&app))
        .args([
            "--cookies-from-browser",
            &browser,
            "--simulate",
            "http://check.cookies.local.test", // Dummy URL to force execution past arg parsing
        ])
        .output()
        .await
        .map_err(|e| {
            crate::error::AppError::ExternalCommand(format!("Failed to execute yt-dlp: {}", e))
        })?;

    let decode = |bytes: &[u8]| -> String {
        if let Ok(s) = std::str::from_utf8(bytes) {
            return s.to_string();
        }
        #[cfg(target_os = "windows")]
        {
            let (cow, _, _) = encoding_rs::GBK.decode(bytes);
            cow.to_string()
        }
        #[cfg(not(target_os = "windows"))]
        String::from_utf8_lossy(bytes).to_string()
    };

    let stderr = decode(&output.stderr);
    let stdout = decode(&output.stdout);
    let combined_output = format!("{}\n{}", stdout, stderr);

    Ok(classify_cookie_check_output(
        output.status.success(),
        &combined_output,
    ))
}

#[command]
pub async fn get_installed_browsers() -> AppResult<Vec<String>> {
    let mut browsers = HashSet::new();

    #[cfg(target_os = "windows")]
    {
        let roots = [HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER];

        for root in roots {
            let hk = RegKey::predef(root);
            if let Ok(clients) = hk.open_subkey("SOFTWARE\\Clients\\StartMenuInternet") {
                for key in clients.enum_keys().filter_map(|x| x.ok()) {
                    let lower = key.to_lowercase();
                    if lower.contains("chrome") {
                        browsers.insert("chrome".to_string());
                    } else if lower.contains("firefox") {
                        browsers.insert("firefox".to_string());
                    } else if lower.contains("edge") {
                        browsers.insert("edge".to_string());
                    } else if lower.contains("brave") {
                        browsers.insert("brave".to_string());
                    } else if lower.contains("opera") {
                        browsers.insert("opera".to_string());
                    } else if lower.contains("vivaldi") {
                        browsers.insert("vivaldi".to_string());
                    } else if lower.contains("chromium") {
                        browsers.insert("chromium".to_string());
                    }
                }
            }
        }
    }

    // MacOS / Linux placeholders
    #[cfg(target_os = "macos")]
    {
        // Simple existence check for common paths
        let paths = [
            ("/Applications/Google Chrome.app", "chrome"),
            ("/Applications/Firefox.app", "firefox"),
            ("/Applications/Brave Browser.app", "brave"),
            ("/Applications/Microsoft Edge.app", "edge"),
            ("/Applications/Safari.app", "safari"),
            ("/Applications/Opera.app", "opera"),
        ];

        for (path, name) in paths {
            if std::path::Path::new(path).exists() {
                browsers.insert(name.to_string());
            }
        }
    }

    let mut result: Vec<String> = browsers.into_iter().collect();
    result.sort();

    Ok(result)
}

#[derive(serde::Serialize)]
pub struct BrowserAndPotStatus {
    pub success: bool,
    pub browser: String,
    pub cookies_ok: bool,
    pub pot_ok: bool,
    pub pot_info: Option<String>,
    pub message: String,
    pub details: Option<String>,
}

#[command]
pub async fn check_browser_and_pot(
    app: AppHandle,
    state: State<'_, DownloadState>,
    browser: Option<String>,
) -> AppResult<BrowserAndPotStatus> {
    let _activity_guard = state
        .begin_tool_activity()
        .map_err(AppError::ExternalCommand)?;
    let chosen_browser = browser.unwrap_or_else(|| "edge".to_string());
    let cookie_res = check_browser_cookies_internal(app.clone(), chosen_browser.clone()).await?;

    let pot_res = crate::services::download::DownloadService::test_pot_provider();
    let pot_ok = pot_res.is_ok();
    let pot_info = pot_res.ok();

    let success = cookie_res.success;
    let message = if cookie_res.success {
        if pot_ok {
            format!(
                "已成功连接 {} 浏览器登录态，PO Token 引擎正常就绪",
                chosen_browser
            )
        } else {
            format!(
                "已连接 {} 浏览器登录态（PO Token 引擎未就绪）",
                chosen_browser
            )
        }
    } else {
        cookie_res.message
    };

    Ok(BrowserAndPotStatus {
        success,
        browser: chosen_browser,
        cookies_ok: cookie_res.success,
        pot_ok,
        pot_info,
        message,
        details: cookie_res.details,
    })
}

#[cfg(test)]
mod cookie_check_tests {
    use super::{classify_cookie_check_output, CookieCheckKind};

    #[test]
    fn requires_positive_cookie_extraction_evidence() {
        let result = classify_cookie_check_output(
            false,
            "ERROR: Unable to download webpage: Temporary failure in name resolution",
        );
        assert!(!result.success);
        assert_eq!(result.kind, CookieCheckKind::ExecutionFailed);
    }

    #[test]
    fn rejects_zero_extracted_cookies() {
        let result = classify_cookie_check_output(
            false,
            "Extracting cookies from edge\nExtracted 0 cookies from edge",
        );
        assert!(!result.success);
        assert_eq!(result.kind, CookieCheckKind::NotFound);
    }

    #[test]
    fn accepts_completed_positive_cookie_extraction_even_if_dummy_url_fails_afterward() {
        let result = classify_cookie_check_output(
            false,
            "Extracting cookies from edge\nExtracted 42 cookies from edge\nERROR: [generic] Unable to download webpage",
        );
        assert!(result.success);
        assert_eq!(result.kind, CookieCheckKind::Ok);
    }

    #[test]
    fn classifies_lock_and_decrypt_failures_structurally() {
        let locked = classify_cookie_check_output(
            false,
            "ERROR: Could not copy Chrome cookie database: database is locked",
        );
        assert_eq!(locked.kind, CookieCheckKind::Locked);

        let decrypt = classify_cookie_check_output(false, "ERROR: Failed to decrypt with DPAPI");
        assert_eq!(decrypt.kind, CookieCheckKind::DecryptFailed);
    }
}
