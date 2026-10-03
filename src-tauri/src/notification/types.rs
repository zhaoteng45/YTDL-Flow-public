// src-tauri/src/notification/types.rs
use serde::{Deserialize, Serialize};

/// 任务完成信号（模块内部使用，不暴露给外部调用方）
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TaskCompleteSignal {
    pub status: String, // "completed" | "error" | "cancelled"
    pub filename: String,
}

/// 通知设置
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NotificationSettings {
    pub enabled: bool,
    pub on_success: bool,
    pub on_error: bool,
    pub on_cancel: bool,
}

/// 国际化模板（前端初始化时传入）
#[derive(Debug, Clone, Default)]
pub struct NotificationI18n(pub NotificationI18nInner);

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationI18nInner {
    pub success_title: String,
    pub error_title: String,
    pub cancel_title: String,
    pub batch_success_title: String,
    pub batch_error_title: String,
    pub batch_cancel_title: String,
    pub tasks_completed: String,
    pub open_folder: String,
}
