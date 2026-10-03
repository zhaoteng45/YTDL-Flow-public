use crate::error::AppResult;
use reqwest::header::USER_AGENT;
use serde::{Deserialize, Serialize};
use tauri::{command, AppHandle};

const BILI_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

#[derive(Debug, Serialize, Deserialize)]
pub struct BiliQrCodeData {
    pub url: String,
    pub qrcode_key: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct BiliResponse<T> {
    code: i32,
    message: String,
    ttl: i32,
    data: Option<T>,
}

#[command]
pub async fn get_bilibili_qrcode() -> AppResult<BiliQrCodeData> {
    let client = reqwest::Client::new();
    let resp = client
        .get("https://passport.bilibili.com/x/passport-login/web/qrcode/generate")
        .header(USER_AGENT, BILI_USER_AGENT)
        .send()
        .await
        .map_err(crate::error::AppError::Network)?;

    let json: BiliResponse<BiliQrCodeData> =
        resp.json().await.map_err(crate::error::AppError::Network)?;

    if json.code != 0 {
        return Err(crate::error::AppError::ExternalCommand(format!(
            "Bilibili API Error: {}",
            json.message
        )));
    }

    json.data.ok_or_else(|| {
        crate::error::AppError::ExternalCommand("Empty data from Bilibili API".to_string())
    })
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BiliPollData {
    pub url: String,
    pub refresh_token: String,
    pub timestamp: i64,
    pub code: i32,
    pub message: String,
}

#[derive(Debug, Serialize)]
pub struct BiliLoginResult {
    pub status: String, // "success", "scanned", "waiting", "expired", "error"
    pub message: String,
    pub cookies: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BiliUserInfo {
    pub uname: String,
    pub face: String,
    pub is_login: bool,
}

#[command]
pub async fn get_bilibili_user_info(cookie_str: String) -> AppResult<BiliUserInfo> {
    let client = reqwest::Client::new();

    // Construct Cookie header
    // cookie_str is "key=value; key=value"

    let resp = client
        .get("https://api.bilibili.com/x/web-interface/nav")
        .header(USER_AGENT, BILI_USER_AGENT)
        .header("Cookie", cookie_str)
        .send()
        .await
        .map_err(crate::error::AppError::Network)?;

    let json_val: serde_json::Value = resp.json().await.map_err(crate::error::AppError::Network)?;

    let code = json_val["code"].as_i64().unwrap_or(-1);
    if code != 0 {
        return Err(crate::error::AppError::ExternalCommand(format!(
            "Bilibili API Error: {}",
            json_val["message"].as_str().unwrap_or("Unknown error")
        )));
    }

    let data = &json_val["data"];
    let is_login = data["isLogin"].as_bool().unwrap_or(false);
    let uname = data["uname"].as_str().unwrap_or("Unknown").to_string();
    let face = data["face"].as_str().unwrap_or("").to_string();

    Ok(BiliUserInfo {
        uname,
        face,
        is_login,
    })
}

#[command]
pub async fn poll_bilibili_qrcode(qrcode_key: String) -> AppResult<BiliLoginResult> {
    let client = reqwest::Client::new();
    let resp = client
        .get(format!(
            "https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key={}",
            qrcode_key
        ))
        .header(USER_AGENT, BILI_USER_AGENT)
        .send()
        .await
        .map_err(crate::error::AppError::Network)?;

    // Extract cookies if successful
    let headers = resp.headers().clone();

    // Parse JSON body
    let json_val: serde_json::Value = resp.json().await.map_err(crate::error::AppError::Network)?;

    let code = json_val["data"]["code"].as_i64().unwrap_or(-1);
    let msg = json_val["data"]["message"]
        .as_str()
        .unwrap_or("")
        .to_string();

    match code {
        0 => {
            // Success
            // Extract Set-Cookie headers
            let mut cookies_vec = Vec::new();

            for (key, value) in headers.iter() {
                if key == reqwest::header::SET_COOKIE {
                    if let Ok(val_str) = value.to_str() {
                        // Value looks like "SESSDATA=xxx; Path=/; Domain=bilibili.com; ..."
                        // We just need key=value part
                        if let Some(part) = val_str.split(';').next() {
                            cookies_vec.push(part.to_string());
                        }
                    }
                }
            }

            // Format as Netscape cookies (simplified) or just key=value string for yt-dlp?
            // yt-dlp --cookies-from-browser works best.
            // If passing via --add-header "Cookie: ...", it might work.
            // But yt-dlp usually takes a file.
            // Wait, we can construct a Netscape cookie file content.

            // For now, let's return the raw cookie string "key=value; key=value"
            // yt-dlp --cookies option takes a FILE.
            // However, we can write this to a temp file in frontend/store logic.

            // Actually, we can return the cookies string and let the frontend save it to a file.
            // Or we can return "SESSDATA=...; bili_jct=..." string.

            let cookie_str = cookies_vec.join("; ");

            Ok(BiliLoginResult {
                status: "success".to_string(),
                message: "登录成功".to_string(),
                cookies: Some(cookie_str),
            })
        }
        86090 => Ok(BiliLoginResult {
            status: "scanned".to_string(),
            message: "已扫码，请在手机上确认".to_string(),
            cookies: None,
        }),
        86101 => Ok(BiliLoginResult {
            status: "waiting".to_string(),
            message: "等待扫码".to_string(),
            cookies: None,
        }),
        86038 => Ok(BiliLoginResult {
            status: "expired".to_string(),
            message: "二维码已过期".to_string(),
            cookies: None,
        }),
        _ => Ok(BiliLoginResult {
            status: "error".to_string(),
            message: format!("未知状态: {}", msg),
            cookies: None,
        }),
    }
}

#[command]
pub async fn save_bilibili_cookies(app: AppHandle, cookie_str: String) -> AppResult<String> {
    use std::io::Write;
    use tauri::Manager;

    let app_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| crate::error::AppError::ExternalCommand(e.to_string()))?;
    if !app_dir.exists() {
        std::fs::create_dir_all(&app_dir)
            .map_err(|e| crate::error::AppError::ExternalCommand(e.to_string()))?;
    }

    let cookie_path = app_dir.join("bilibili_cookies.txt");

    let mut file = std::fs::File::create(&cookie_path)
        .map_err(|e| crate::error::AppError::ExternalCommand(e.to_string()))?;

    writeln!(file, "# Netscape HTTP Cookie File")
        .map_err(|e| crate::error::AppError::ExternalCommand(e.to_string()))?;
    writeln!(file, "# This file is generated by YTDL-Flow")
        .map_err(|e| crate::error::AppError::ExternalCommand(e.to_string()))?;

    for pair in cookie_str.split("; ") {
        if let Some((key, value)) = pair.split_once('=') {
            // domain flag path secure expiration name value
            // 2147483647 is roughly 2038
            writeln!(
                file,
                ".bilibili.com\tTRUE\t/\tFALSE\t2147483647\t{}\t{}",
                key, value
            )
            .map_err(|e| crate::error::AppError::ExternalCommand(e.to_string()))?;
        }
    }

    Ok(cookie_path.to_string_lossy().to_string())
}
