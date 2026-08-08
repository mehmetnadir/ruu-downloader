//go:build !windows

package main

import (
	"os/exec"
	"syscall"
)

// detach makes the child survive its parent and the parent's process group —
// on macOS/Linux a new session (setsid) detaches it from Chrome's lifecycle.
func detach(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
}
