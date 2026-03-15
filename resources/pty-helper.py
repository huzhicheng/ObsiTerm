#!/usr/bin/env python3
#
# Obsidian Terminal Plugin PTY helper
#
# Uses Python's built-in pty module to create a proper pseudo-terminal,
# bypassing the node-pty native module restriction in Electron.
#
# Communication:
# - stdin (fd 0): Input from xterm.js
# - stdout (fd 1): Output to xterm.js
# - fd 3: Terminal size changes (8 bytes: rows, cols, xpixel, ypixel as unsigned shorts)
#
# Based on clevcode/obsidian-terminal-plugin implementation

import termios
import select
import struct
import signal
import fcntl
import errno
import pty
import sys
import pwd
import os

# Signal handler for fast exit
def sigterm_handler(sig, frame):
    sys.exit(0)

signal.signal(signal.SIGTERM, sigterm_handler)

def get_shell():
    """Determine the user's shell"""
    if len(sys.argv) >= 2:
        return sys.argv[1]
    shell = os.getenv('SHELL')
    if shell:
        return shell
    try:
        return pwd.getpwuid(os.getuid()).pw_shell
    except:
        return '/bin/sh'

def get_argv():
    """Determine shell arguments"""
    if len(sys.argv) >= 3:
        return sys.argv[1:]
    shell = get_shell()
    # Use login shell for proper profile loading
    return ['-' + os.path.basename(shell)]

def pty_fork(shell_path, argv=None, envp=None):
    """Fork a pseudo-terminal with the given shell"""
    if not argv:
        argv = [os.path.basename(shell_path)]
    if not envp:
        envp = dict(os.environ)
        envp['TERM'] = 'xterm-256color'
        # Ensure proper locale for Unicode support
        if 'LANG' not in envp:
            envp['LANG'] = 'en_US.UTF-8'
    
    pid, fd = pty.fork()
    if pid == 0:
        # Child process - exec the shell
        try:
            os.execve(shell_path, argv, envp)
        except Exception as e:
            sys.stderr.write(f'Failed to exec {shell_path}: {e}\n')
            sys.exit(1)
    return fd, pid

def main():
    shell = get_shell()
    argv = get_argv()
    
    fd, pid = pty_fork(shell, argv)
    
    # File descriptors to monitor
    fds = [fd, 0]  # PTY fd and stdin
    
    # Check if fd 3 is available for resize events
    try:
        os.fstat(3)
        fds.append(3)
        has_resize_fd = True
    except OSError:
        has_resize_fd = False
    
    # Wrap PTY fd for writing
    proc = os.fdopen(fd, 'wb', 0)  # Unbuffered
    
    try:
        while True:
            try:
                rfds, _, _ = select.select(fds, [], [])
            except select.error as e:
                if e.args[0] == errno.EINTR:
                    continue
                raise
            
            # Handle PTY output -> stdout
            if fd in rfds:
                try:
                    buf = os.read(fd, 65536)  # Larger buffer for better throughput
                    if len(buf) == 0:
                        break  # EOF from PTY
                    sys.stdout.buffer.write(buf)
                    # Only flush if no more data is immediately available
                    # This batches output for better performance
                    try:
                        ready, _, _ = select.select([fd], [], [], 0)
                        if not ready:
                            sys.stdout.buffer.flush()
                    except:
                        sys.stdout.buffer.flush()
                except OSError as e:
                    if e.errno in (errno.EINTR, errno.EAGAIN):
                        continue
                    if e.errno == errno.EIO:
                        break  # PTY closed
                    sys.stderr.write(f'read(pty): {e}\n')
                    break
            
            # Handle stdin -> PTY
            if 0 in rfds:
                try:
                    buf = os.read(0, 32768)
                    if len(buf) == 0:
                        break  # EOF from stdin
                    proc.write(buf)
                except OSError as e:
                    if e.errno in (errno.EINTR, errno.EAGAIN):
                        continue
                    sys.stderr.write(f'read(stdin): {e}\n')
                    break
            
            # Handle terminal resize via fd 3
            if has_resize_fd and 3 in rfds:
                try:
                    winsize = os.read(3, 8)
                    if len(winsize) == 0:
                        # fd 3 closed, remove from monitoring
                        fds = [f for f in fds if f != 3]
                        has_resize_fd = False
                    elif len(winsize) == 8:
                        # winsize is struct { unsigned short ws_row, ws_col, ws_xpixel, ws_ypixel }
                        fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)
                except OSError as e:
                    if e.errno in (errno.EINTR, errno.EAGAIN):
                        continue
                    # Ignore resize fd errors, just disable resize
                    fds = [f for f in fds if f != 3]
                    has_resize_fd = False
    
    except KeyboardInterrupt:
        pass
    finally:
        # Clean up
        try:
            proc.close()
        except:
            pass
        try:
            os.waitpid(pid, 0)
        except:
            pass

if __name__ == '__main__':
    main()
