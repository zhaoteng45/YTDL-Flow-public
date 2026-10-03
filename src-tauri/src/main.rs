// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![warn(clippy::unwrap_used)]
#![warn(clippy::expect_used)]

fn main() {
    tracing_subscriber::fmt().with_ansi(false).init();

    if let Err(err) = ytdl_flow_lib::run() {
        tracing::error!(error = %err, "tauri app exited with error");
    }
}
