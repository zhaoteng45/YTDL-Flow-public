use std::path::PathBuf;

pub fn smoke_request_path(args: &[String]) -> Result<Option<PathBuf>, String> {
    if args.get(1).map(String::as_str) != Some("--release-smoke") {
        return Ok(None);
    }
    if args.len() != 3 || args[2].is_empty() {
        return Err("--release-smoke requires exactly one request file".into());
    }
    Ok(Some(PathBuf::from(&args[2])))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normal_launch_does_not_enable_smoke() {
        assert_eq!(smoke_request_path(&["app.exe".into()]), Ok(None));
    }

    #[test]
    fn smoke_requires_exactly_one_explicit_request_file() {
        assert!(smoke_request_path(&["app.exe".into(), "--release-smoke".into()]).is_err());
        assert!(smoke_request_path(&[
            "app.exe".into(),
            "--release-smoke".into(),
            "request.json".into(),
            "extra".into()
        ])
        .is_err());
    }
}
