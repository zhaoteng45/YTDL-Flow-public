use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri_plugin_shell::process::CommandChild;

/// How an accepted execution is tracked for cancellation.
///
/// `Child` keeps the shell-plugin handle (pasted-URL path). `ProcessId` is used
/// by the captured path, which must close the child's stdin after writing the
/// raw URL to `--batch-file -`; dropping the plugin handle closes stdin without
/// disturbing the plugin's own stdout/stderr/exit plumbing, so the pid remains
/// the cancellation and tree-kill anchor.
enum AttachedProcess {
    Child(CommandChild),
    ProcessId(u32),
    #[cfg(test)]
    TestCleanup(Arc<Mutex<Result<(), String>>>),
}

impl AttachedProcess {
    fn kill_tree(&self) -> Result<(), String> {
        match self {
            AttachedProcess::Child(child) => DownloadState::kill_tree(child),
            AttachedProcess::ProcessId(pid) => crate::utils::kill_process_tree(*pid),
            #[cfg(test)]
            AttachedProcess::TestCleanup(result) => result.lock().expect("cleanup fixture").clone(),
        }
    }
}

/// One accepted execution. The control exists before the child process is
/// attached so cancellation can win the start/child-registration race.
struct ExecutionEntry {
    process: Option<AttachedProcess>,
    cancel_requested: bool,
    cancel_confirmed: bool,
}

#[derive(Default)]
struct ToolActivityRegistry {
    active_users: usize,
    mutation_active: bool,
}

#[derive(Clone, Copy)]
enum ToolActivityKind {
    Use,
    Mutation,
}

pub struct ToolActivityGuard {
    registry: Arc<Mutex<ToolActivityRegistry>>,
    kind: ToolActivityKind,
}

impl Drop for ToolActivityGuard {
    fn drop(&mut self) {
        let Ok(mut registry) = self.registry.lock() else {
            tracing::error!("Failed to release media tool activity guard");
            return;
        };

        match self.kind {
            ToolActivityKind::Use => {
                registry.active_users = registry.active_users.saturating_sub(1);
            }
            ToolActivityKind::Mutation => {
                registry.mutation_active = false;
            }
        }
    }
}

#[derive(Default, Clone)]
pub struct DownloadState {
    // 使用 std::sync::Mutex 以便在同步上下文（如 ExitRequested）中使用。
    // 不跨越 .await 点持有锁。
    inner: Arc<Mutex<HashMap<String, ExecutionEntry>>>,
    tool_activity: Arc<Mutex<ToolActivityRegistry>>,
}

impl DownloadState {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(HashMap::new())),
            tool_activity: Arc::new(Mutex::new(ToolActivityRegistry::default())),
        }
    }

    pub fn begin_tool_activity(&self) -> Result<ToolActivityGuard, String> {
        let mut registry = self
            .tool_activity
            .lock()
            .map_err(|e| format!("Failed to lock media tool activity registry: {e}"))?;

        if registry.mutation_active {
            return Err(
                "Media tools are being updated or maintained; retry when that finishes".into(),
            );
        }

        registry.active_users += 1;
        Ok(ToolActivityGuard {
            registry: self.tool_activity.clone(),
            kind: ToolActivityKind::Use,
        })
    }

    pub fn begin_tool_mutation(&self) -> Result<ToolActivityGuard, String> {
        let mut registry = self
            .tool_activity
            .lock()
            .map_err(|e| format!("Failed to lock media tool activity registry: {e}"))?;

        if registry.mutation_active {
            return Err("Media tool maintenance is already running".into());
        }
        if registry.active_users > 0 {
            return Err(format!(
                "Media tools are busy with {} active operation(s); retry after they finish",
                registry.active_users
            ));
        }

        registry.mutation_active = true;
        Ok(ToolActivityGuard {
            registry: self.tool_activity.clone(),
            kind: ToolActivityKind::Mutation,
        })
    }

    /// Atomically reserve inspection or report normal occupancy; registry errors
    /// remain errors. Shares the existing maintenance exclusion and RAII guard.
    pub fn try_begin_tool_inspection(&self) -> Result<Result<ToolActivityGuard, usize>, String> {
        let mut registry = self
            .tool_activity
            .lock()
            .map_err(|e| format!("Failed to inspect media tool activity registry: {e}"))?;
        if registry.active_users > 0 || registry.mutation_active {
            return Ok(Err(
                registry.active_users + usize::from(registry.mutation_active)
            ));
        }
        registry.mutation_active = true;
        Ok(Ok(ToolActivityGuard {
            registry: self.tool_activity.clone(),
            kind: ToolActivityKind::Mutation,
        }))
    }

    pub fn active_tool_activity_count(&self) -> usize {
        match self.tool_activity.lock() {
            Ok(registry) => registry.active_users,
            Err(error) => {
                tracing::error!("Failed to inspect media tool activity registry: {}", error);
                usize::MAX
            }
        }
    }

    pub fn has_active_tool_activity(&self) -> bool {
        self.active_tool_activity_count() > 0
    }

    // Helper to clone self for async tasks.
    pub fn inner(&self) -> Self {
        self.clone()
    }

    /// Register execution control before start_download reports acceptance.
    pub fn begin_execution(&self, id: String) -> Result<(), String> {
        let mut map = self
            .inner
            .lock()
            .map_err(|e| format!("Failed to lock active_downloads for begin: {e}"))?;

        if map.contains_key(&id) {
            return Err(format!("Execution already exists: {id}"));
        }

        map.insert(
            id,
            ExecutionEntry {
                process: None,
                cancel_requested: false,
                cancel_confirmed: false,
            },
        );
        Ok(())
    }

    pub fn is_cancel_requested(&self, id: &str) -> bool {
        match self.inner.lock() {
            Ok(map) => map.get(id).is_some_and(|entry| entry.cancel_requested),
            Err(e) => {
                tracing::error!(
                    "Failed to lock active_downloads for cancellation-request check: {}",
                    e
                );
                false
            }
        }
    }

    /// True only when this execution can be settled as Cancelled.
    pub fn is_cancelled(&self, id: &str) -> bool {
        match self.inner.lock() {
            Ok(map) => map.get(id).is_some_and(|entry| entry.cancel_confirmed),
            Err(e) => {
                tracing::error!(
                    "Failed to lock active_downloads for cancellation check: {}",
                    e
                );
                false
            }
        }
    }

    /// If cancellation was requested before child creation, atomically confirm
    /// the cancellation so the caller can skip spawning the process.
    pub fn confirm_cancel_before_spawn(&self, id: &str) -> Result<bool, String> {
        let mut map = self
            .inner
            .lock()
            .map_err(|e| format!("Failed to lock active_downloads before spawn: {e}"))?;

        let Some(entry) = map.get_mut(id) else {
            return Ok(false);
        };

        if entry.cancel_requested && entry.process.is_none() {
            entry.cancel_confirmed = true;
            return Ok(true);
        }

        Ok(false)
    }

    fn confirm_cancel_after_cleanup(
        entry: &mut ExecutionEntry,
        cleanup_result: Result<(), String>,
    ) -> Result<(), String> {
        cleanup_result?;
        entry.cancel_confirmed = true;
        Ok(())
    }

    /// Attach a child to the existing execution control.
    ///
    /// If cancellation won the race after the pre-spawn check, kill the newly
    /// attached child immediately. Cleanup failure is returned and the control
    /// remains registered; cancellation is not confirmed on failure.
    pub fn attach_child(
        &self,
        id: &str,
        child: CommandChild,
    ) -> Result<(), (String, Option<CommandChild>)> {
        let mut process = Some(AttachedProcess::Child(child));
        self.attach_process_retaining(id, &mut process)
            .map_err(|error| {
                let child = match process {
                    Some(AttachedProcess::Child(child)) => Some(child),
                    _ => None,
                };
                (error, child)
            })
    }

    /// Attach a spawned child by pid only. Used by the captured execution path,
    /// which closes the plugin's stdin writer after writing the raw URL.
    pub fn attach_process_id(&self, id: &str, pid: u32) -> Result<(), String> {
        self.attach_process(id, AttachedProcess::ProcessId(pid))
    }

    #[cfg(test)]
    pub(crate) fn attach_test_process(
        &self,
        id: &str,
        cleanup: Arc<Mutex<Result<(), String>>>,
    ) -> Result<(), String> {
        self.attach_process(id, AttachedProcess::TestCleanup(cleanup))
    }

    fn attach_process(&self, id: &str, process: AttachedProcess) -> Result<(), String> {
        self.attach_process_retaining(id, &mut Some(process))
    }

    fn attach_process_retaining(
        &self,
        id: &str,
        process: &mut Option<AttachedProcess>,
    ) -> Result<(), String> {
        let mut map = self
            .inner
            .lock()
            .map_err(|e| format!("Failed to lock active_downloads for child attach: {e}"))?;

        let entry = map
            .get_mut(id)
            .ok_or_else(|| format!("Execution control missing for child attach: {id}"))?;

        entry.process = process.take();

        if entry.cancel_requested {
            let process = entry
                .process
                .as_ref()
                .expect("a process was attached immediately above");
            let cleanup_result = process.kill_tree();
            Self::confirm_cancel_after_cleanup(entry, cleanup_result)?;
            entry.process = None;
        }

        Ok(())
    }

    /// Record exit only after Terminated or successful tree cleanup. Pending
    /// cancellation is now confirmed by that same proof, even if kill failed.
    pub fn confirm_process_exit(&self, id: &str) {
        match self.inner.lock() {
            Ok(mut map) => {
                if let Some(entry) = map.get_mut(id) {
                    entry.process = None;
                    if entry.cancel_requested {
                        entry.cancel_confirmed = true;
                    }
                }
            }
            Err(e) => {
                tracing::error!(
                    "Failed to lock active_downloads for exit confirmation: {}",
                    e
                );
            }
        }
    }

    /// Request user cancellation. This records intent immediately, but does not
    /// confirm Cancelled until either no child will be spawned or tree-kill
    /// succeeds.
    pub fn request_cancel(&self, id: &str) -> Result<bool, String> {
        let mut map = self
            .inner
            .lock()
            .map_err(|e| format!("Failed to lock active_downloads for cancellation: {e}"))?;

        let Some(entry) = map.get_mut(id) else {
            return Ok(false);
        };

        entry.cancel_requested = true;

        if let Some(process) = entry.process.as_ref() {
            let cleanup_result = process.kill_tree();
            Self::confirm_cancel_after_cleanup(entry, cleanup_result)?;
            entry.process = None;
        }

        Ok(true)
    }

    /// Stop an execution because the execution itself failed (for example the
    /// watchdog fired). This must never turn the execution into Cancelled.
    pub fn stop_for_failure(&self, id: &str) -> Result<bool, String> {
        let mut map = self
            .inner
            .lock()
            .map_err(|e| format!("Failed to lock active_downloads for failure stop: {e}"))?;

        let Some(entry) = map.get_mut(id) else {
            return Ok(false);
        };

        if let Some(process) = entry.process.as_ref() {
            process.kill_tree()?;
            entry.process = None;
            return Ok(true);
        }

        // An execution entry alone says nothing about a spawned process. The
        // caller must use its local pid if attachment did not acquire an anchor.
        Ok(false)
    }

    /// Remove the execution control after one terminal settlement.
    pub fn finish_execution(&self, id: &str) -> bool {
        match self.inner.lock() {
            Ok(mut map) => {
                if map.get(id).is_some_and(|entry| entry.process.is_some()) {
                    return false;
                }
                map.remove(id).is_some()
            }
            Err(e) => {
                tracing::error!("Failed to lock active_downloads for finish: {}", e);
                false
            }
        }
    }

    /// Kills a process and its children (Windows Tree Kill).
    fn kill_tree(child: &CommandChild) -> Result<(), String> {
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            use std::process::Command;

            let pid = child.pid();
            let output = Command::new("taskkill")
                .args(["/F", "/T", "/PID", &pid.to_string()])
                .creation_flags(0x08000000)
                .output()
                .map_err(|e| e.to_string())?;

            if !output.status.success() {
                let err = String::from_utf8_lossy(&output.stderr);
                if !err.to_ascii_lowercase().contains("not found") {
                    return Err(format!("Taskkill failed: {}", err));
                }
            }
            Ok(())
        }
        #[cfg(not(target_os = "windows"))]
        {
            child.kill().map_err(|e| e.to_string())
        }
    }

    pub fn kill_all(&self) {
        let entries = match self.inner.lock() {
            Ok(mut map) => map.drain().collect::<Vec<_>>(),
            Err(e) => {
                tracing::error!("Failed to lock active_downloads for kill_all");
                tracing::error!("{}", e);
                return;
            }
        };

        for (_, entry) in entries {
            if let Some(process) = entry.process.as_ref() {
                if let Err(e) = process.kill_tree() {
                    tracing::error!("Failed to kill process tree on exit: {}", e);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancellation_is_recorded_before_child_attach() {
        let state = DownloadState::new();

        state
            .begin_execution("task-before-child".to_string())
            .expect("execution control should be registered");

        assert_eq!(state.request_cancel("task-before-child"), Ok(true));
        assert!(state.is_cancel_requested("task-before-child"));
        assert!(!state.is_cancelled("task-before-child"));

        assert_eq!(
            state.confirm_cancel_before_spawn("task-before-child"),
            Ok(true)
        );
        assert!(state.is_cancelled("task-before-child"));
    }

    #[test]
    fn cancel_intent_survives_attempt_boundary_and_blocks_fallback_spawn() {
        let state = DownloadState::new();

        state
            .begin_execution("fallback-cancel".to_string())
            .expect("execution control should be registered");

        assert_eq!(state.request_cancel("fallback-cancel"), Ok(true));
        state.confirm_process_exit("fallback-cancel");

        assert!(state.is_cancel_requested("fallback-cancel"));
        assert_eq!(
            state.confirm_cancel_before_spawn("fallback-cancel"),
            Ok(true)
        );
        assert!(state.is_cancelled("fallback-cancel"));
    }

    #[test]
    fn cleanup_failure_keeps_control_and_does_not_confirm_cancelled() {
        let state = DownloadState::new();

        state
            .begin_execution("cleanup-failure".to_string())
            .expect("execution control should be registered");
        assert_eq!(state.request_cancel("cleanup-failure"), Ok(true));

        {
            let mut map = state
                .inner
                .lock()
                .expect("execution control lock should remain available");
            let entry = map
                .get_mut("cleanup-failure")
                .expect("execution control must still be registered");

            let error = DownloadState::confirm_cancel_after_cleanup(
                entry,
                Err("simulated tree-kill failure".to_string()),
            )
            .expect_err("cleanup failure must remain observable");

            assert!(error.contains("simulated tree-kill failure"));
            assert!(entry.cancel_requested);
            assert!(!entry.cancel_confirmed);
            assert!(map.contains_key("cleanup-failure"));
        }

        assert!(state.is_cancel_requested("cleanup-failure"));
        assert!(!state.is_cancelled("cleanup-failure"));
    }

    #[test]
    fn cancelled_before_pid_attachment_is_killed_and_confirmed_on_attach() {
        let state = DownloadState::new();
        state
            .begin_execution("captured-pre-cancel".to_string())
            .expect("execution control should be registered");

        assert_eq!(state.request_cancel("captured-pre-cancel"), Ok(true));
        assert!(!state.is_cancelled("captured-pre-cancel"));

        // A nonexistent pid keeps the test deterministic: taskkill reports
        // "not found", which the tree-kill path treats as already gone.
        state
            .attach_process_id("captured-pre-cancel", 999_999)
            .expect("pid attachment must not fail for an already-dead process");

        assert!(state.is_cancelled("captured-pre-cancel"));
    }

    #[test]
    fn cancelling_a_pid_attached_execution_confirms_cancellation() {
        let state = DownloadState::new();
        state
            .begin_execution("captured-cancel".to_string())
            .expect("execution control should be registered");
        state
            .attach_process_id("captured-cancel", 999_999)
            .expect("pid attach");

        assert_eq!(state.request_cancel("captured-cancel"), Ok(true));
        assert!(state.is_cancelled("captured-cancel"));
    }

    #[test]
    fn failure_stop_does_not_become_user_cancellation() {
        let state = DownloadState::new();

        state
            .begin_execution("watchdog-task".to_string())
            .expect("execution control should be registered");
        state
            .attach_test_process("watchdog-task", Arc::new(Mutex::new(Ok(()))))
            .expect("attach watchdog process");

        assert_eq!(state.stop_for_failure("watchdog-task"), Ok(true));
        assert!(!state.is_cancel_requested("watchdog-task"));
        assert!(!state.is_cancelled("watchdog-task"));
    }

    #[test]
    fn missing_process_anchor_is_not_cleanup_proof() {
        let state = DownloadState::new();
        state.begin_execution("not-attached".into()).expect("begin");
        assert_eq!(state.stop_for_failure("not-attached"), Ok(false));
        assert!(!state.is_cancelled("not-attached"));
    }

    #[test]
    fn missing_execution_control_leaves_process_with_the_caller() {
        let state = DownloadState::new();
        let cleanup = Arc::new(Mutex::new(Err("tree-kill denied".into())));
        let retained = Arc::downgrade(&cleanup);
        let mut process = Some(AttachedProcess::TestCleanup(cleanup));
        assert!(state
            .attach_process_retaining("missing-control", &mut process)
            .is_err());
        assert!(
            process.is_some(),
            "failed attachment must return the process anchor"
        );
        assert!(retained.upgrade().is_some());
        drop(process);
        assert!(retained.upgrade().is_none());
    }

    #[test]
    fn failed_cleanup_preserves_anchor_then_retry_allows_exactly_one_settlement() {
        let state = DownloadState::new();
        state
            .begin_execution("cleanup-retry".into())
            .expect("begin");
        let cleanup = Arc::new(Mutex::new(Err("tree-kill denied".into())));
        state
            .attach_test_process("cleanup-retry", cleanup.clone())
            .expect("attach");

        assert!(state.stop_for_failure("cleanup-retry").is_err());
        assert!(!state.finish_execution("cleanup-retry"));
        assert!(
            state.request_cancel("cleanup-retry").is_err(),
            "the failed process remains cancellable"
        );
        assert!(!state.is_cancelled("cleanup-retry"));

        *cleanup.lock().expect("fixture") = Ok(());
        assert_eq!(state.stop_for_failure("cleanup-retry"), Ok(true));
        assert!(!state.is_cancelled("cleanup-retry"));
        assert!(state.finish_execution("cleanup-retry"));
        assert!(!state.finish_execution("cleanup-retry"));
    }

    #[test]
    fn live_process_cannot_release_execution_without_cleanup_proof() {
        let state = DownloadState::new();
        state.begin_execution("pipe-error".into()).expect("begin");
        state
            .attach_process_id("pipe-error", 999_999)
            .expect("attach");

        assert!(
            !state.finish_execution("pipe-error"),
            "a pipe Error is not termination proof"
        );
        assert!(state.begin_execution("pipe-error".into()).is_err());
    }

    #[test]
    fn attach_cleanup_failure_keeps_anchor_until_user_cancel_retry_succeeds() {
        let state = DownloadState::new();
        state
            .begin_execution("attach-failure".into())
            .expect("begin");
        assert_eq!(state.request_cancel("attach-failure"), Ok(true));
        let cleanup = Arc::new(Mutex::new(Err("tree-kill denied".into())));
        assert!(state
            .attach_test_process("attach-failure", cleanup.clone())
            .is_err());
        assert!(!state.finish_execution("attach-failure"));
        assert!(!state.is_cancelled("attach-failure"));
        *cleanup.lock().expect("fixture") = Ok(());
        assert_eq!(state.request_cancel("attach-failure"), Ok(true));
        assert!(state.is_cancelled("attach-failure"));
        assert!(state.finish_execution("attach-failure"));
        assert!(!state.finish_execution("attach-failure"));
    }

    #[test]
    fn finish_removes_execution_control_once() {
        let state = DownloadState::new();

        state
            .begin_execution("finish-once".to_string())
            .expect("execution control should be registered");

        assert!(state.finish_execution("finish-once"));
        assert!(!state.finish_execution("finish-once"));
    }

    #[test]
    fn tool_activity_blocks_mutation_until_the_activity_guard_drops() {
        let state = DownloadState::new();
        let activity = state
            .begin_tool_activity()
            .expect("ordinary media activity should start when idle");

        assert_eq!(state.active_tool_activity_count(), 1);
        assert!(state.begin_tool_mutation().is_err());

        drop(activity);

        assert_eq!(state.active_tool_activity_count(), 0);
        let mutation = state
            .begin_tool_mutation()
            .expect("tool mutation should start after media activity ends");
        drop(mutation);
    }

    #[test]
    fn tool_mutation_blocks_new_media_activity_until_the_mutation_guard_drops() {
        let state = DownloadState::new();
        let mutation = state
            .begin_tool_mutation()
            .expect("tool mutation should start when idle");

        assert!(state.begin_tool_activity().is_err());

        drop(mutation);

        let activity = state
            .begin_tool_activity()
            .expect("media activity should resume after mutation ends");
        assert_eq!(state.active_tool_activity_count(), 1);
        drop(activity);
    }
}
