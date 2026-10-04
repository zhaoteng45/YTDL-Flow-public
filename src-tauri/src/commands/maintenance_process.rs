//! Bounded, direct maintenance subprocesses. Call from a blocking worker.
use std::io::{Read, Seek, SeekFrom};
use std::process::{Command, Output, Stdio};
use std::time::{Duration, Instant};

// Interactive version/health checks may wait at most 15 seconds. Archive
// extraction has a separate two-minute budget. These are responsiveness limits,
// not measured performance claims; callers report timeout instead of success.
pub(super) const INSPECTION_TIMEOUT: Duration = Duration::from_secs(15);
pub(super) const EXTRACTION_TIMEOUT: Duration = Duration::from_secs(120);

pub(super) fn bounded_output(command: &mut Command, timeout: Duration) -> std::io::Result<Output> {
    // File-backed output avoids filling a pipe while waiting for process exit.
    let mut stdout = tempfile::tempfile()?;
    let mut stderr = tempfile::tempfile()?;
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        use windows_sys::Win32::System::Threading::{CREATE_NO_WINDOW, CREATE_SUSPENDED};
        // Contain the process before any user code or launcher child can run.
        command.creation_flags(CREATE_NO_WINDOW | CREATE_SUSPENDED);
    }
    let mut child = command
        .stdout(Stdio::from(stdout.try_clone()?))
        .stderr(Stdio::from(stderr.try_clone()?))
        .spawn()?;
    #[cfg(windows)]
    let job = {
        use std::os::windows::io::AsRawHandle;
        match crate::release_smoke_job::contain_process(child.as_raw_handle()) {
            Ok(job) => {
                if let Err(error) = resume_owned_process(child.id()) {
                    cleanup_until_confirmed(|| stop_job(&job).map_err(|error| error.to_string()));
                    child.wait()?;
                    return Err(error);
                }
                job
            }
            Err(error) => {
                child.kill()?;
                child.wait()?;
                return Err(error);
            }
        }
    };
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() < timeout => {
                std::thread::sleep(Duration::from_millis(20));
            }
            result => {
                // Keep the PID and activity guard until the owned process tree
                // is stopped. A cleanup error must not silently unlock tools.
                #[cfg(windows)]
                cleanup_until_confirmed(|| stop_job(&job).map_err(|error| error.to_string()));
                #[cfg(not(windows))]
                child.kill()?;
                child.wait()?;
                return Err(match result {
                    Err(error) => error,
                    _ => std::io::Error::new(
                        std::io::ErrorKind::TimedOut,
                        format!(
                            "Maintenance command exceeded {} ms (elapsed {} ms); process stopped",
                            timeout.as_millis(),
                            started.elapsed().as_millis()
                        ),
                    ),
                });
            }
        }
    };
    #[cfg(windows)]
    cleanup_until_confirmed(|| stop_job(&job).map_err(|error| error.to_string()));
    stdout.seek(SeekFrom::Start(0))?;
    stderr.seek(SeekFrom::Start(0))?;
    let mut out = Vec::new();
    let mut err = Vec::new();
    stdout.read_to_end(&mut out)?;
    stderr.read_to_end(&mut err)?;
    Ok(Output {
        status,
        stdout: out,
        stderr: err,
    })
}

#[cfg(windows)]
fn resume_owned_process(pid: u32) -> std::io::Result<()> {
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
    use windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE;
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Thread32First, Thread32Next, TH32CS_SNAPTHREAD, THREADENTRY32,
    };
    use windows_sys::Win32::System::Threading::{OpenThread, ResumeThread, THREAD_SUSPEND_RESUME};
    // std::process retains the process handle, but not the initial thread handle.
    // A suspended new process has only its initial thread; select it by owned PID.
    unsafe {
        let raw = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
        if raw == INVALID_HANDLE_VALUE {
            return Err(std::io::Error::last_os_error());
        }
        let snapshot = OwnedHandle::from_raw_handle(raw);
        let mut entry: THREADENTRY32 = std::mem::zeroed();
        entry.dwSize = std::mem::size_of_val(&entry) as u32;
        let mut has_entry = Thread32First(snapshot.as_raw_handle(), &mut entry) != 0;
        while has_entry {
            if entry.th32OwnerProcessID == pid {
                let raw_thread = OpenThread(THREAD_SUSPEND_RESUME, 0, entry.th32ThreadID);
                if raw_thread.is_null() {
                    return Err(std::io::Error::last_os_error());
                }
                let thread = OwnedHandle::from_raw_handle(raw_thread);
                if ResumeThread(thread.as_raw_handle()) == u32::MAX {
                    return Err(std::io::Error::last_os_error());
                }
                return Ok(());
            }
            has_entry = Thread32Next(snapshot.as_raw_handle(), &mut entry) != 0;
        }
        Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "Owned maintenance process thread was not found",
        ))
    }
}

#[cfg(windows)]
fn stop_job(job: &std::os::windows::io::OwnedHandle) -> std::io::Result<()> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::System::JobObjects::{
        JobObjectBasicAccountingInformation, QueryInformationJobObject, TerminateJobObject,
        JOBOBJECT_BASIC_ACCOUNTING_INFORMATION,
    };
    // Check structured job membership, including descendants after root exit.
    // An empty job is success regardless of localized taskkill diagnostics.
    unsafe {
        let mut info: JOBOBJECT_BASIC_ACCOUNTING_INFORMATION = std::mem::zeroed();
        if QueryInformationJobObject(
            job.as_raw_handle(),
            JobObjectBasicAccountingInformation,
            &mut info as *mut _ as *mut _,
            std::mem::size_of_val(&info) as u32,
            std::ptr::null_mut(),
        ) == 0
        {
            return Err(std::io::Error::last_os_error());
        }
        if info.ActiveProcesses == 0 {
            return Ok(());
        }
        if TerminateJobObject(job.as_raw_handle(), 1) == 0 {
            return Err(std::io::Error::last_os_error());
        }
        Err(std::io::Error::new(
            std::io::ErrorKind::WouldBlock,
            "Waiting for maintenance process tree to stop",
        ))
    }
}

fn cleanup_until_confirmed(mut cleanup: impl FnMut() -> Result<(), String>) {
    let mut reported_failure = false;
    loop {
        match cleanup() {
            Ok(()) => return,
            Err(error) => {
                if !reported_failure {
                    tracing::warn!("Maintenance cleanup failed; retaining tool ownership: {error}");
                    reported_failure = true;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
        }
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::os::windows::process::CommandExt;

    #[test]
    fn immediately_spawned_descendant_is_stopped_before_returning() {
        use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
        use windows_sys::Win32::Foundation::WAIT_OBJECT_0;
        use windows_sys::Win32::System::Threading::{
            OpenProcess, WaitForSingleObject, SYNCHRONIZE,
        };
        let output = bounded_output(Command::new("powershell").args([
            "-NoProfile", "-NonInteractive", "-Command",
            "$p=Start-Process powershell -WindowStyle Hidden -PassThru -ArgumentList '-NoProfile','-Command','Start-Sleep -Seconds 60'; Write-Output $p.Id",
        ]), INSPECTION_TIMEOUT).unwrap();
        assert!(output.status.success());
        let pid = String::from_utf8_lossy(&output.stdout)
            .trim()
            .parse::<u32>()
            .unwrap();
        unsafe {
            let raw = OpenProcess(SYNCHRONIZE, 0, pid);
            if !raw.is_null() {
                let process = OwnedHandle::from_raw_handle(raw);
                assert_eq!(
                    WaitForSingleObject(process.as_raw_handle(), 5000),
                    WAIT_OBJECT_0
                );
            }
        }
    }

    #[test]
    fn cleanup_failure_is_retried_before_returning() {
        let mut attempts = 0;
        cleanup_until_confirmed(|| {
            attempts += 1;
            if attempts < 3 {
                Err("synthetic cleanup denied".into())
            } else {
                Ok(())
            }
        });
        assert_eq!(attempts, 3);
    }

    #[test]
    fn job_cleanup_recovers_after_root_exits_during_a_failed_attempt() {
        use std::os::windows::io::AsRawHandle;
        let mut child = Command::new("powershell")
            .creation_flags(0x08000000)
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "Start-Sleep -Milliseconds 200",
            ])
            .spawn()
            .unwrap();
        let job = crate::release_smoke_job::contain_process(child.as_raw_handle()).unwrap();
        let mut attempts = 0;
        cleanup_until_confirmed(|| {
            attempts += 1;
            if attempts == 1 {
                child.wait().unwrap();
                Err("synthetic initial cleanup failure".into())
            } else {
                stop_job(&job).map_err(|error| error.to_string())
            }
        });
        assert_eq!(attempts, 2);
    }

    #[test]
    fn failed_exit_and_output_are_preserved() {
        let output = bounded_output(
            Command::new("powershell").creation_flags(0x08000000).args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "Write-Output fixture; exit 7",
            ]),
            INSPECTION_TIMEOUT,
        )
        .unwrap();
        assert_eq!(output.status.code(), Some(7));
        assert!(String::from_utf8_lossy(&output.stdout).contains("fixture"));
    }

    #[test]
    fn hung_inspection_is_stopped_and_reported_as_timeout() {
        let start = Instant::now();
        let result = bounded_output(
            Command::new("powershell").creation_flags(0x08000000).args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "Start-Sleep -Seconds 60",
            ]),
            Duration::from_millis(100),
        );
        assert_eq!(result.unwrap_err().kind(), std::io::ErrorKind::TimedOut);
        assert!(start.elapsed() < Duration::from_secs(5));
    }
}
