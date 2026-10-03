use std::collections::BTreeMap;
#[derive(Default)]
pub struct TransferProgress {
    streams: BTreeMap<String, f64>,
    expected: usize,
}
impl TransferProgress {
    pub fn observe(&mut self, line: &str) -> Option<(f64, String, &'static str)> {
        if let Some((_, selector)) = line.split_once("format(s): ") {
            self.expected = selector.trim().split('+').count();
        }
        let record = line.strip_prefix("[Flow]")?;
        let fields: Vec<_> = record.split('|').collect();
        if fields.len() != 5 || fields[0].is_empty() || (fields[1] == "none" && fields[2] == "none")
        {
            return None;
        }
        let percent = fields[3].trim().trim_end_matches('%').parse::<f64>().ok()?;
        if !percent.is_finite() || !(0.0..=100.0).contains(&percent) {
            return None;
        }
        let previous = self.streams.entry(fields[0].to_string()).or_default();
        *previous = previous.max(percent);
        let denominator = self.expected.max(self.streams.len()).max(1) as f64;
        // Equal stream units represent transfer only. 100 belongs to verified completion.
        let aggregate = (self.streams.values().sum::<f64>() / denominator).min(99.0);
        Some((
            aggregate,
            fields[4].trim().to_string(),
            if fields[1] == "none" {
                "audio"
            } else {
                "video"
            },
        ))
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn multiple_streams_do_not_reset_or_finish_early() {
        let mut p = TransferProgress::default();
        p.observe("[info] x: Downloading 1 format(s): 137+140");
        assert_eq!(
            p.observe("[Flow]137|avc1|none|100%|2MiB/s")
                .expect("video")
                .0,
            50.0
        );
        let (progress, _, phase) = p.observe("[Flow]140|none|mp4a|50%|1MiB/s").expect("audio");
        assert_eq!((progress, phase), (75.0, "audio"));
        assert_eq!(
            p.observe("[Flow]140|none|mp4a|100%|1MiB/s")
                .expect("audio")
                .0,
            99.0
        );
    }
    #[test]
    fn malformed_or_subtitle_progress_is_not_media_progress() {
        let mut p = TransferProgress::default();
        assert!(p.observe("[Flow]en|none|none|100%|N/A").is_none());
        assert!(p.observe("[Flow]137|avc|none|NaN%|N/A").is_none());
        assert!(p.observe("[Flow]137|avc|none|-1%|N/A").is_none());
    }
}
