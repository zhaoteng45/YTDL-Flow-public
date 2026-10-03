// src-tauri/src/notification/commands.rs
use tauri::Manager;
use tauri_plugin_store::StoreExt;

use super::{NotificationI18n, NotificationI18nInner, NotificationManager, NotificationSettings};

/// 初始化国际化模板
#[tauri::command]
pub fn init_notification_i18n(
    i18n: NotificationI18nInner,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    app_handle.manage(NotificationI18n(i18n));
    Ok(())
}

/// 更新通知设置
#[tauri::command]
pub async fn update_notification_settings(
    settings: NotificationSettings,
    manager: tauri::State<'_, NotificationManager>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    // 1. 持久化到 Store
    let store = app_handle
        .store("settings.json")
        .map_err(|e| e.to_string())?;
    store.set(
        "notificationSettings",
        serde_json::to_value(&settings).map_err(|e| e.to_string())?,
    );
    store.save().map_err(|e| e.to_string())?;

    // 2. 同步更新内存缓存
    manager.update_settings(settings).await;

    Ok(())
}

/// 获取通知设置
#[tauri::command]
pub async fn get_notification_settings(
    manager: tauri::State<'_, NotificationManager>,
) -> Result<NotificationSettings, String> {
    Ok(manager.get_settings().await)
}
