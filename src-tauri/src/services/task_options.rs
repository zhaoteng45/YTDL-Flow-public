use crate::{
    error::{AppError, AppResult},
    models::ExtraArgs,
};

pub fn flags(extra: &ExtraArgs) -> AppResult<Vec<String>> {
    let mut result = vec![];
    if let Some(selector) = &extra.format_selector {
        if selector.is_empty()
            || !selector
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || "._-+".contains(c))
            || selector.split('+').any(str::is_empty)
        {
            return Err(AppError::Validation("TASK_FORMAT_UNAVAILABLE".into()));
        }
        result.extend(["-f".into(), selector.clone()]);
    }
    let start = extra.section_start.unwrap_or(0.0);
    if !start.is_finite()
        || start < 0.0
        || extra
            .section_end
            .is_some_and(|end| !end.is_finite() || end <= start)
    {
        return Err(AppError::Validation("TASK_SECTION_INVALID".into()));
    }
    if extra.section_start.is_some() || extra.section_end.is_some() {
        result.extend([
            "--download-sections".into(),
            format!(
                "*{}-{}",
                start,
                extra
                    .section_end
                    .map(|n| n.to_string())
                    .unwrap_or_else(|| "inf".into())
            ),
        ]);
    }
    Ok(result)
}
pub fn subtitle_retry(error: &str, enabled: bool, cancelled: bool) -> bool {
    let text = error.to_ascii_lowercase();
    enabled
        && !cancelled
        && (text.contains("unable to download video subtitles")
            || text.contains("error embedding subtitles")
            || text.contains("unable to download subtitles"))
}
pub fn verified_artifact(path: Option<&str>) -> bool {
    path.and_then(|p| std::fs::metadata(p).ok())
        .is_some_and(|m| m.is_file() && m.len() > 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn completion_requires_a_real_nonempty_file() {
        assert!(!verified_artifact(None));
        assert!(!verified_artifact(Some(
            ".scratch/nonexistent-output.fixture"
        )));
        let path = std::env::temp_dir().join(format!("ytdl-artifact-test-{}", std::process::id()));
        std::fs::write(&path, []).expect("empty fixture");
        assert!(!verified_artifact(path.to_str()));
        std::fs::write(&path, b"media").expect("media fixture");
        assert!(verified_artifact(path.to_str()));
        std::fs::remove_file(path).expect("owned fixture cleanup");
    }
    #[test]
    fn task_flags_preserve_format_and_section() {
        let e = ExtraArgs {
            format_selector: Some("137+bestaudio".into()),
            section_start: Some(60.0),
            section_end: Some(70.0),
            ..Default::default()
        };
        assert_eq!(
            flags(&e).expect("valid"),
            vec!["-f", "137+bestaudio", "--download-sections", "*60-70"]
        );
    }
    #[test]
    fn task_flags_reject_invalid_input() {
        for e in [
            ExtraArgs {
                format_selector: Some("--exec anything".into()),
                ..Default::default()
            },
            ExtraArgs {
                section_start: Some(-1.0),
                ..Default::default()
            },
            ExtraArgs {
                section_start: Some(70.0),
                section_end: Some(60.0),
                ..Default::default()
            },
            ExtraArgs {
                section_end: Some(f64::INFINITY),
                ..Default::default()
            },
        ] {
            assert!(flags(&e).is_err());
        }
    }
    #[test]
    fn subtitle_failure_is_optional_and_specific() {
        assert!(subtitle_retry(
            "ERROR: Unable to download video subtitles for 'en': HTTP Error 429",
            true,
            false
        ));
        assert!(!subtitle_retry(
            "HTTP Error 403: video unavailable",
            true,
            false
        ));
        assert!(!subtitle_retry(
            "ERROR: Unable to download video subtitles",
            false,
            false
        ));
        assert!(!subtitle_retry(
            "ERROR: Unable to download video subtitles",
            true,
            true
        ));
    }
}
