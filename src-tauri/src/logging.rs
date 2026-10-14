use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::PathBuf;

/// A thread-safe file writer that writes logs into daily files named `upsed_YYYY-MM-DD.log`.
///
/// Seamlessly rolls over to the next day's file at 00:00:00 midnight without needing
/// an application restart.
pub struct DailyRotatingFile {
    dir: PathBuf,
    current_date: String,
    current_file: Option<File>,
}

impl DailyRotatingFile {
    pub fn new(dir: PathBuf) -> Self {
        Self {
            dir,
            current_date: String::new(),
            current_file: None,
        }
    }

    fn ensure_current_file(&mut self) -> io::Result<&mut File> {
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        if self.current_file.is_none() || self.current_date != today {
            if let Some(mut old) = self.current_file.take() {
                let _ = old.flush();
            }
            let _ = fs::create_dir_all(&self.dir);
            let file_path = self.dir.join(format!("upsed_{today}.log"));
            let file = OpenOptions::new()
                .create(true)
                .append(true)
                .open(file_path)?;
            self.current_date = today;
            self.current_file = Some(file);
        }
        Ok(self.current_file.as_mut().unwrap())
    }
}

impl Write for DailyRotatingFile {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        let file = self.ensure_current_file()?;
        file.write(buf)
    }

    fn flush(&mut self) -> io::Result<()> {
        if let Some(file) = self.current_file.as_mut() {
            file.flush()
        } else {
            Ok(())
        }
    }
}

/// Computes the OS-standard app log directory matching Tauri's `app_log_dir()`.
pub fn get_log_dir() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        std::env::var("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|_| std::env::temp_dir())
            .join("com.adsandakannipunajith.upsed")
            .join("logs")
    }
    #[cfg(target_os = "macos")]
    {
        std::env::var("HOME")
            .map(|h| PathBuf::from(h).join("Library/Logs/com.adsandakannipunajith.upsed"))
            .unwrap_or_else(|_| std::env::temp_dir().join("upsed_logs"))
    }
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        std::env::var("XDG_STATE_HOME")
            .map(PathBuf::from)
            .or_else(|_| std::env::var("XDG_DATA_HOME").map(PathBuf::from))
            .unwrap_or_else(|_| {
                std::env::var("HOME")
                    .map(|h| PathBuf::from(h).join(".local/state"))
                    .unwrap_or_else(|_| std::env::temp_dir())
            })
            .join("com.adsandakannipunajith.upsed")
            .join("logs")
    }
}
