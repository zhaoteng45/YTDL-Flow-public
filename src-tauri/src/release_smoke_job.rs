//! Windows process ownership used only by explicit release smoke checks.

use std::os::windows::io::{FromRawHandle, OwnedHandle, RawHandle};
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};

fn contain_process(process: RawHandle) -> std::io::Result<OwnedHandle> {
    // No breakaway flags: all subsequent analysis/download descendants inherit
    // the job. The OS closes it at process exit, including abrupt termination.
    unsafe {
        let raw = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if raw.is_null() {
            return Err(std::io::Error::last_os_error());
        }
        let job = OwnedHandle::from_raw_handle(raw);
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if SetInformationJobObject(
            raw,
            JobObjectExtendedLimitInformation,
            &limits as *const _ as *const _,
            std::mem::size_of_val(&limits) as u32,
        ) == 0
            || AssignProcessToJobObject(raw, process) == 0
        {
            return Err(std::io::Error::last_os_error());
        }
        Ok(job)
    }
}

pub fn contain_current_process() -> std::io::Result<()> {
    use std::os::windows::io::IntoRawHandle;
    let job =
        contain_process(unsafe { windows_sys::Win32::System::Threading::GetCurrentProcess() })?;
    // Intentionally retain the single job handle for this explicit CI process
    // lifetime. Closing it here would kill this app before writing its report.
    let _ = job.into_raw_handle();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::contain_process;
    use std::os::windows::io::AsRawHandle;
    use std::process::Command;
    use windows_sys::Win32::Foundation::CloseHandle;

    #[test]
    fn closing_job_stops_descendant_after_parent_exits() -> Result<(), Box<dyn std::error::Error>> {
        let root = tempfile::tempdir()?;
        let gate = root.path().join("gate");
        let pid_file = root.path().join("child-pid");
        let script = format!(
            "while (!(Test-Path -LiteralPath '{}')) {{ Start-Sleep -Milliseconds 50 }}; $p=Start-Process pwsh -WindowStyle Hidden -PassThru -ArgumentList '-NoProfile','-Command','Start-Sleep -Seconds 60'; $p.Id | Set-Content -LiteralPath '{}'",
            gate.display(), pid_file.display()
        );
        let mut parent = Command::new("pwsh")
            .args(["-NoProfile", "-Command", &script])
            .spawn()?;
        let job = match contain_process(parent.as_raw_handle()) {
            Ok(job) => job,
            Err(error) => {
                parent.kill()?;
                parent.wait()?;
                return Err(error.into());
            }
        };
        std::fs::write(&gate, "ready")?;
        // The owned parent exits while its deliberately orphaned child sleeps.
        let parent_deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
        loop {
            if let Some(status) = parent.try_wait()? {
                if !status.success() {
                    return Err("fixture parent failed".into());
                }
                break;
            }
            if std::time::Instant::now() > parent_deadline {
                return Err("fixture parent timed out".into());
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        let pid = std::fs::read_to_string(pid_file)?.trim().parse::<u32>()?;
        drop(job);
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        loop {
            let handle =
                unsafe { windows_sys::Win32::System::Threading::OpenProcess(0x1000, 0, pid) };
            if handle.is_null() {
                break;
            }
            unsafe {
                CloseHandle(handle);
            }
            if std::time::Instant::now() > deadline {
                return Err("orphan survived job closure".into());
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        Ok(())
    }
}
