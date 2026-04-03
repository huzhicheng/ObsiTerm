#[cfg(windows)]
mod platform {
    use portable_pty::{CommandBuilder, MasterPty, NativePtySystem, PtySize, PtySystem};
    use std::env;
    use std::fs::File;
    use std::io::{self, Read, Write};
    use std::os::windows::io::{FromRawHandle, RawHandle};
    use std::path::PathBuf;
    use std::sync::{Arc, Mutex};

    pub fn run() -> Result<(), String> {
        let shell = determine_shell();
        let shell_args: Vec<String> = env::args().skip(2).collect();
        let pty_system = NativePtySystem::default();
        let pair = pty_system
            .openpty(determine_initial_winsize())
            .map_err(|error| format!("openpty failed: {error}"))?;

        let mut command = CommandBuilder::new(shell);
        for arg in shell_args {
            command.arg(arg);
        }
        if let Some(initial_cwd) = determine_initial_cwd() {
            command.cwd(initial_cwd);
        }

        let mut child = pair
            .slave
            .spawn_command(command)
            .map_err(|error| format!("failed to spawn shell: {error}"))?;

        drop(pair.slave);

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|error| format!("failed to clone PTY reader: {error}"))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|error| format!("failed to acquire PTY writer: {error}"))?;
        let master = Arc::new(Mutex::new(pair.master));

        spawn_stdin_forwarder(writer);
        spawn_resize_forwarder(Arc::clone(&master));
        forward_pty_output(&mut reader)?;

        child.wait().map_err(|error| format!("wait failed: {error}"))?;
        Ok(())
    }

    fn determine_shell() -> String {
        env::args()
            .nth(1)
            .filter(|value| !value.trim().is_empty())
            .or_else(|| env::var("OBSITERM_SHELL").ok())
            .or_else(|| env::var("COMSPEC").ok())
            .unwrap_or_else(|| "cmd.exe".to_string())
    }

    fn determine_initial_winsize() -> PtySize {
        let cols = env::var("XTERM_INITIAL_COLS")
            .ok()
            .and_then(|value| value.parse::<u16>().ok())
            .filter(|value| *value > 0)
            .unwrap_or(80);
        let rows = env::var("XTERM_INITIAL_ROWS")
            .ok()
            .and_then(|value| value.parse::<u16>().ok())
            .filter(|value| *value > 0)
            .unwrap_or(24);

        PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        }
    }

    fn determine_initial_cwd() -> Option<PathBuf> {
        let value = env::var("OBSITERM_INITIAL_CWD").ok()?;
        let trimmed = value.trim();
        if trimmed.is_empty() {
            return None;
        }

        Some(PathBuf::from(trimmed))
    }

    fn spawn_stdin_forwarder(mut writer: Box<dyn Write + Send>) {
        std::thread::spawn(move || {
            let mut stdin = io::stdin().lock();
            let mut buffer = [0u8; 32768];

            loop {
                match stdin.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(size) => {
                        if writer.write_all(&buffer[..size]).is_err() || writer.flush().is_err() {
                            break;
                        }
                    }
                    Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                    Err(_) => break,
                }
            }
        });
    }

    fn spawn_resize_forwarder(master: Arc<Mutex<Box<dyn MasterPty + Send>>>) {
        let Some(mut resize_stream) = open_optional_pipe_file(3) else {
            return;
        };

        std::thread::spawn(move || {
            let mut winsize_bytes = [0u8; 8];

            loop {
                match resize_stream.read_exact(&mut winsize_bytes) {
                    Ok(()) => {
                        let size = PtySize {
                            rows: u16::from_le_bytes([winsize_bytes[0], winsize_bytes[1]]),
                            cols: u16::from_le_bytes([winsize_bytes[2], winsize_bytes[3]]),
                            pixel_width: u16::from_le_bytes([winsize_bytes[4], winsize_bytes[5]]),
                            pixel_height: u16::from_le_bytes([winsize_bytes[6], winsize_bytes[7]]),
                        };

                        if let Ok(master) = master.lock() {
                            let _ = master.resize(size);
                        }
                    }
                    Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                    Err(_) => break,
                }
            }
        });
    }

    fn forward_pty_output(reader: &mut Box<dyn Read + Send>) -> Result<(), String> {
        let mut stdout = io::stdout().lock();
        let mut buffer = [0u8; 65536];

        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(size) => stdout
                    .write_all(&buffer[..size])
                    .and_then(|_| stdout.flush())
                    .map_err(|error| format!("write(stdout): {error}"))?,
                Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                Err(error) => return Err(format!("read(pty): {error}")),
            }
        }

        Ok(())
    }

    fn open_optional_pipe_file(fd: i32) -> Option<File> {
        let dup_fd = unsafe { libc::dup(fd) };
        if dup_fd < 0 {
            return None;
        }

        let handle = unsafe { libc::get_osfhandle(dup_fd) };
        if handle == -1 {
            unsafe {
                libc::close(dup_fd);
            }
            return None;
        }

        Some(unsafe { File::from_raw_handle(handle as RawHandle) })
    }
}

#[cfg(not(windows))]
mod platform {
    use libc::{c_char, c_int};
    use std::collections::HashSet;
    use std::env;
    use std::ffi::CString;
    use std::io::{self, Read, Write};
    use std::os::fd::FromRawFd;
    use std::path::Path;
    use std::process::Command;
    use std::ptr;
    use std::time::Duration;

    pub fn run() -> Result<(), String> {
        let shell_path = determine_shell();
        let argv = determine_shell_argv(&shell_path);
        let mut initial_winsize = determine_initial_winsize();
        let mut master_fd: c_int = -1;
        let winsize_ptr = initial_winsize
            .as_mut()
            .map(|winsize| winsize as *mut libc::winsize)
            .unwrap_or(ptr::null_mut());

        let pid = unsafe { libc::forkpty(&mut master_fd, ptr::null_mut(), ptr::null_mut(), winsize_ptr) };
        if pid < 0 {
            return Err("forkpty failed".to_string());
        }

        if pid == 0 {
            exec_shell(&shell_path, &argv);
        }

        if master_fd < 0 {
            return Err("pty master fd was not created".to_string());
        }

        spawn_stdin_forwarder(master_fd);
        spawn_resize_forwarder(master_fd);
        spawn_foreground_process_reporter(master_fd);
        forward_pty_output(master_fd)?;

        unsafe {
            libc::waitpid(pid, ptr::null_mut(), 0);
        }

        Ok(())
    }

    fn determine_initial_winsize() -> Option<libc::winsize> {
        let cols = env::var("XTERM_INITIAL_COLS")
            .ok()
            .and_then(|value| value.parse::<u16>().ok())
            .filter(|value| *value > 0)?;

        let rows = env::var("XTERM_INITIAL_ROWS")
            .ok()
            .and_then(|value| value.parse::<u16>().ok())
            .filter(|value| *value > 0)?;

        Some(libc::winsize {
            ws_row: rows,
            ws_col: cols,
            ws_xpixel: 0,
            ws_ypixel: 0,
        })
    }

    fn determine_shell() -> String {
        env::args()
            .nth(1)
            .or_else(|| env::var("SHELL").ok())
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "/bin/zsh".to_string())
    }

    fn determine_shell_argv(shell_path: &str) -> Vec<String> {
        let args: Vec<String> = env::args().skip(1).collect();
        if args.len() >= 2 {
            return args;
        }

        let shell_name = Path::new(shell_path)
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("sh");

        vec![format!("-{shell_name}")]
    }

    fn exec_shell(shell_path: &str, argv: &[String]) -> ! {
        let shell = CString::new(shell_path).expect("shell path contained NUL");

        let c_argv: Vec<CString> = argv
            .iter()
            .map(|value| CString::new(value.as_str()).expect("shell arg contained NUL"))
            .collect();
        let mut argv_ptrs: Vec<*const c_char> = c_argv.iter().map(|value| value.as_ptr()).collect();
        argv_ptrs.push(ptr::null());

        let mut env_pairs: Vec<(String, String)> = env::vars().collect();
        ensure_env_var(&mut env_pairs, "TERM", "xterm-256color");
        ensure_env_var(&mut env_pairs, "LANG", "en_US.UTF-8");

        let env_cstrings: Vec<CString> = env_pairs
            .iter()
            .map(|(key, value)| CString::new(format!("{key}={value}")).expect("env contained NUL"))
            .collect();
        let mut env_ptrs: Vec<*const c_char> = env_cstrings.iter().map(|value| value.as_ptr()).collect();
        env_ptrs.push(ptr::null());

        unsafe {
            libc::execve(shell.as_ptr(), argv_ptrs.as_ptr(), env_ptrs.as_ptr());
            let error = io::Error::last_os_error();
            eprintln!("Failed to exec {shell_path}: {error}");
            libc::_exit(1);
        }
    }

    fn ensure_env_var(env_pairs: &mut Vec<(String, String)>, key: &str, default_value: &str) {
        if env_pairs.iter().all(|(env_key, _)| env_key != key) {
            env_pairs.push((key.to_string(), default_value.to_string()));
        }
    }

    fn spawn_stdin_forwarder(master_fd: c_int) {
        let write_fd = unsafe { libc::dup(master_fd) };
        if write_fd < 0 {
            return;
        }

        std::thread::spawn(move || {
            let mut stdin = io::stdin().lock();
            let mut buffer = [0u8; 32768];

            loop {
                match stdin.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(size) => {
                        if write_all_fd(write_fd, &buffer[..size]).is_err() {
                            break;
                        }
                    }
                    Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                    Err(_) => break,
                }
            }

            unsafe {
                libc::close(write_fd);
            }
        });
    }

    fn spawn_resize_forwarder(master_fd: c_int) {
        let is_valid_fd = unsafe { libc::fcntl(3, libc::F_GETFD) } != -1;
        if !is_valid_fd {
            return;
        }

        let resize_fd = unsafe { libc::dup(3) };
        let ioctl_fd = unsafe { libc::dup(master_fd) };
        if resize_fd < 0 || ioctl_fd < 0 {
            if resize_fd >= 0 {
                unsafe { libc::close(resize_fd) };
            }
            if ioctl_fd >= 0 {
                unsafe { libc::close(ioctl_fd) };
            }
            return;
        }

        std::thread::spawn(move || {
            let mut resize_stream = unsafe { std::fs::File::from_raw_fd(resize_fd) };
            let mut winsize_bytes = [0u8; 8];

            loop {
                match resize_stream.read_exact(&mut winsize_bytes) {
                    Ok(()) => {
                        let winsize = libc::winsize {
                            ws_row: u16::from_le_bytes([winsize_bytes[0], winsize_bytes[1]]),
                            ws_col: u16::from_le_bytes([winsize_bytes[2], winsize_bytes[3]]),
                            ws_xpixel: u16::from_le_bytes([winsize_bytes[4], winsize_bytes[5]]),
                            ws_ypixel: u16::from_le_bytes([winsize_bytes[6], winsize_bytes[7]]),
                        };

                        unsafe {
                            libc::ioctl(ioctl_fd, libc::TIOCSWINSZ, &winsize);
                        }
                    }
                    Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                    Err(_) => break,
                }
            }

            unsafe {
                libc::close(ioctl_fd);
            }
        });
    }

    fn spawn_foreground_process_reporter(master_fd: c_int) {
        let is_valid_fd = unsafe { libc::fcntl(4, libc::F_GETFD) } != -1;
        if !is_valid_fd {
            return;
        }

        let status_fd = unsafe { libc::dup(4) };
        let monitor_fd = unsafe { libc::dup(master_fd) };
        if status_fd < 0 || monitor_fd < 0 {
            if status_fd >= 0 {
                unsafe { libc::close(status_fd) };
            }
            if monitor_fd >= 0 {
                unsafe { libc::close(monitor_fd) };
            }
            return;
        }

        std::thread::spawn(move || {
            let mut status_stream = unsafe { std::fs::File::from_raw_fd(status_fd) };
            let mut last_message = String::new();

            loop {
                let commands = get_foreground_commands(monitor_fd);
                let message = format_foreground_message(&commands);

                if message != last_message {
                    if status_stream.write_all(message.as_bytes()).is_err() {
                        break;
                    }

                    if status_stream.flush().is_err() {
                        break;
                    }

                    last_message = message;
                }

                std::thread::sleep(Duration::from_millis(200));
            }

            unsafe {
                libc::close(monitor_fd);
            }
        });
    }

    fn get_foreground_commands(master_fd: c_int) -> Vec<String> {
        let process_group = unsafe { libc::tcgetpgrp(master_fd) };
        if process_group <= 0 {
            return Vec::new();
        }

        let output = match Command::new("ps")
            .args(["-o", "comm=", "-g", &process_group.to_string()])
            .output()
        {
            Ok(output) if output.status.success() => output,
            _ => return Vec::new(),
        };

        let mut seen = HashSet::new();
        output
            .stdout
            .split(|byte| *byte == b'\n')
            .filter_map(|line| String::from_utf8(line.to_vec()).ok())
            .map(|line| line.trim().to_string())
            .filter(|line| !line.is_empty())
            .filter(|line| seen.insert(line.clone()))
            .collect()
    }

    fn format_foreground_message(commands: &[String]) -> String {
        if commands.is_empty() {
            "foreground\n".to_string()
        } else {
            format!("foreground\t{}\n", commands.join("\t"))
        }
    }

    fn forward_pty_output(master_fd: c_int) -> Result<(), String> {
        let mut stdout = io::stdout().lock();
        let mut buffer = [0u8; 65536];

        loop {
            let read_count = unsafe { libc::read(master_fd, buffer.as_mut_ptr().cast(), buffer.len()) };

            if read_count == 0 {
                break;
            }

            if read_count < 0 {
                let error = io::Error::last_os_error();
                match error.raw_os_error() {
                    Some(code) if code == libc::EINTR || code == libc::EAGAIN => continue,
                    Some(code) if code == libc::EIO => break,
                    _ => return Err(format!("read(pty): {error}")),
                }
            }

            let size = read_count as usize;
            stdout
                .write_all(&buffer[..size])
                .and_then(|_| stdout.flush())
                .map_err(|error| format!("write(stdout): {error}"))?;
        }

        unsafe {
            libc::close(master_fd);
        }

        Ok(())
    }

    fn write_all_fd(fd: c_int, data: &[u8]) -> Result<(), io::Error> {
        let mut written = 0;
        while written < data.len() {
            let result = unsafe { libc::write(fd, data[written..].as_ptr().cast(), data.len() - written) };

            if result < 0 {
                let error = io::Error::last_os_error();
                match error.raw_os_error() {
                    Some(code) if code == libc::EINTR || code == libc::EAGAIN => continue,
                    _ => return Err(error),
                }
            } else {
                written += result as usize;
            }
        }

        Ok(())
    }
}

fn main() {
    if let Err(error) = platform::run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
