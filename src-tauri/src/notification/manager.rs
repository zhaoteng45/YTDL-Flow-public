// src-tauri/src/notification/manager.rs
use std::collections::HashMap;
use std::path::Path;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;
use tauri::Manager;
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_store::StoreExt;
use tokio::sync::{mpsc, RwLock};
use tokio::time::Sleep;

use super::{NotificationI18n, NotificationSettings, TaskCompleteSignal};
use crate::models::DownloadOutcome;

/// 通知队列管理器（深模块：内聚设置状态、过滤规则、去抖汇聚与 OS 通知发射）
pub struct NotificationManager {
    sender: mpsc::Sender<TaskCompleteSignal>,
    settings: Arc<RwLock<NotificationSettings>>,
}

impl NotificationManager {
    const DEBOUNCE_WINDOW: Duration = Duration::from_secs(2);
    const MAX_BATCH_SIZE: usize = 50;

    pub fn new(app_handle: tauri::AppHandle) -> Self {
        let (tx, mut rx) = mpsc::channel::<TaskCompleteSignal>(100);

        let initial_settings = if let Ok(store) = app_handle.store("settings.json") {
            store
                .get("notificationSettings")
                .and_then(|v| serde_json::from_value::<NotificationSettings>(v).ok())
                .unwrap_or_default()
        } else {
            NotificationSettings::default()
        };
        let settings = Arc::new(RwLock::new(initial_settings));
        let settings_clone = settings.clone();

        let app_handle_clone = app_handle.clone();
        tauri::async_runtime::spawn(async move {
            let mut pending: HashMap<String, Vec<TaskCompleteSignal>> = HashMap::new();
            let mut debounce_timer: Option<Pin<Box<Sleep>>> = None;

            loop {
                tokio::select! {
                    signal = rx.recv() => {
                        match signal {
                            Some(signal) => {
                                let is_enabled = {
                                    let s = settings_clone.read().await;
                                    Self::is_signal_enabled(&s, &signal.status)
                                };

                                if !is_enabled {
                                    continue;
                                }

                                let queue = pending
                                    .entry(signal.status.clone())
                                    .or_default();
                                queue.push(signal.clone());

                                if queue.len() >= Self::MAX_BATCH_SIZE {
                                    Self::flush_status(&app_handle_clone, &mut pending, &signal.status);
                                    debounce_timer = None;
                                    continue;
                                }

                                if debounce_timer.is_none() {
                                    debounce_timer = Some(Box::pin(tokio::time::sleep(Self::DEBOUNCE_WINDOW)));
                                }
                            }
                            None => break,
                        }
                    }

                    _timer = async {
                        if let Some(ref mut timer) = debounce_timer {
                            timer.as_mut().await;
                        } else {
                            std::future::pending::<()>().await;
                        }
                    }, if debounce_timer.is_some() => {
                        for status in pending.keys().cloned().collect::<Vec<_>>() {
                            Self::flush_status(&app_handle_clone, &mut pending, &status);
                        }
                        debounce_timer = None;
                    }
                }
            }
        });

        Self {
            sender: tx,
            settings,
        }
    }

    /// 将 DownloadOutcome 映射为内部信号（取消时不发送；成功与失败映射为对应的文件名和状态）
    pub(crate) fn map_outcome_to_signal(outcome: &DownloadOutcome) -> Option<TaskCompleteSignal> {
        match outcome {
            DownloadOutcome::Completed { file_path } => {
                let filename = file_path
                    .as_deref()
                    .map(Path::new)
                    .and_then(|path| path.file_name())
                    .map(|name| name.to_string_lossy().to_string())
                    .unwrap_or_else(|| "下载完成".to_string());
                Some(TaskCompleteSignal {
                    status: "completed".to_string(),
                    filename,
                })
            }
            DownloadOutcome::Failed(_) => Some(TaskCompleteSignal {
                status: "error".to_string(),
                filename: "下载失败".to_string(),
            }),
            DownloadOutcome::Cancelled => None,
        }
    }

    /// 判定指定状态在当前设置下是否开启通知
    pub(crate) fn is_signal_enabled(settings: &NotificationSettings, status: &str) -> bool {
        if !settings.enabled {
            return false;
        }
        match status {
            "completed" => settings.on_success,
            "error" => settings.on_error,
            "cancelled" => settings.on_cancel,
            _ => false,
        }
    }

    /// 领域级通知接口：根据下载结果触发通知（非阻塞、不持有调用线程锁）
    pub fn notify_outcome(&self, outcome: &DownloadOutcome) {
        if let Some(signal) = Self::map_outcome_to_signal(outcome) {
            let _ = self.sender.try_send(signal);
        }
    }

    /// 领域级通知接口：取消下载时触发通知
    pub fn notify_cancelled(&self, task_id: &str) {
        let _ = self.sender.try_send(TaskCompleteSignal {
            status: "cancelled".to_string(),
            filename: task_id.to_string(),
        });
    }

    /// 读取通知设置（内存只读镜像）
    pub async fn get_settings(&self) -> NotificationSettings {
        self.settings.read().await.clone()
    }

    /// 更新通知设置（内存写入）
    pub async fn update_settings(&self, settings: NotificationSettings) {
        let mut cached = self.settings.write().await;
        *cached = settings;
    }

    fn flush_status(
        app_handle: &tauri::AppHandle,
        pending: &mut HashMap<String, Vec<TaskCompleteSignal>>,
        status: &str,
    ) {
        if let Some(signals) = pending.remove(status) {
            Self::send_batch_notification(app_handle, status, signals);
        }
    }

    fn send_batch_notification(
        app_handle: &tauri::AppHandle,
        status: &str,
        signals: Vec<TaskCompleteSignal>,
    ) {
        let i18n = app_handle
            .try_state::<NotificationI18n>()
            .map(|s| s.0.clone())
            .unwrap_or_default();

        let (title, body) = if signals.len() == 1 {
            let signal = &signals[0];
            let title = match status {
                "completed" => &i18n.success_title,
                "error" => &i18n.error_title,
                "cancelled" => &i18n.cancel_title,
                _ => return,
            };
            (title.clone(), signal.filename.clone())
        } else {
            let title = match status {
                "completed" => &i18n.batch_success_title,
                "error" => &i18n.batch_error_title,
                "cancelled" => &i18n.batch_cancel_title,
                _ => return,
            };
            (
                title.clone(),
                format!("{} {}", signals.len(), i18n.tasks_completed),
            )
        };

        let _ = app_handle
            .notification()
            .builder()
            .title(title)
            .body(&body)
            .show();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn outcome_mapping_extracts_completed_filename() {
        let outcome = DownloadOutcome::Completed {
            file_path: Some("C:\\downloads\\sample.mp4".to_string()),
        };
        let signal = NotificationManager::map_outcome_to_signal(&outcome).unwrap();
        assert_eq!(signal.status, "completed");
        assert_eq!(signal.filename, "sample.mp4");
    }

    #[test]
    fn outcome_mapping_handles_completed_without_path() {
        let outcome = DownloadOutcome::Completed { file_path: None };
        let signal = NotificationManager::map_outcome_to_signal(&outcome).unwrap();
        assert_eq!(signal.status, "completed");
        assert_eq!(signal.filename, "下载完成");
    }

    #[test]
    fn outcome_mapping_handles_failed() {
        let outcome = DownloadOutcome::Failed("network timeout".to_string());
        let signal = NotificationManager::map_outcome_to_signal(&outcome).unwrap();
        assert_eq!(signal.status, "error");
        assert_eq!(signal.filename, "下载失败");
    }

    #[test]
    fn outcome_mapping_skips_cancelled() {
        let outcome = DownloadOutcome::Cancelled;
        assert!(NotificationManager::map_outcome_to_signal(&outcome).is_none());
    }

    #[test]
    fn signal_enabled_checks_master_and_granular_switches() {
        let disabled_master = NotificationSettings {
            enabled: false,
            on_success: true,
            on_error: true,
            on_cancel: true,
        };
        assert!(!NotificationManager::is_signal_enabled(
            &disabled_master,
            "completed"
        ));
        assert!(!NotificationManager::is_signal_enabled(
            &disabled_master,
            "error"
        ));
        assert!(!NotificationManager::is_signal_enabled(
            &disabled_master,
            "cancelled"
        ));

        let partial = NotificationSettings {
            enabled: true,
            on_success: true,
            on_error: false,
            on_cancel: true,
        };
        assert!(NotificationManager::is_signal_enabled(
            &partial,
            "completed"
        ));
        assert!(!NotificationManager::is_signal_enabled(&partial, "error"));
        assert!(NotificationManager::is_signal_enabled(
            &partial,
            "cancelled"
        ));
        assert!(!NotificationManager::is_signal_enabled(&partial, "other"));
    }

    #[tokio::test]
    async fn notification_manager_channel_and_settings_mutation() {
        let (tx, mut rx) = mpsc::channel(10);
        let settings = NotificationSettings {
            enabled: true,
            on_success: true,
            on_error: true,
            on_cancel: false,
        };
        let manager = NotificationManager {
            sender: tx,
            settings: Arc::new(RwLock::new(settings)),
        };

        // Test notify_outcome
        manager.notify_outcome(&DownloadOutcome::Completed {
            file_path: Some("/tmp/test.mkv".to_string()),
        });
        let received = rx.recv().await.unwrap();
        assert_eq!(received.status, "completed");
        assert_eq!(received.filename, "test.mkv");

        // Test notify_cancelled
        manager.notify_cancelled("task-999");
        let received = rx.recv().await.unwrap();
        assert_eq!(received.status, "cancelled");
        assert_eq!(received.filename, "task-999");

        // Test update_settings & get_settings
        let new_settings = NotificationSettings {
            enabled: false,
            on_success: false,
            on_error: false,
            on_cancel: false,
        };
        manager.update_settings(new_settings).await;
        let current = manager.get_settings().await;
        assert!(!current.enabled);
    }
}
