//go:build windows

// conpty-diag is a standalone Windows-only diagnostic tool that runs the
// ConPTY probe sequence step-by-step with verbose output at each stage.
// Run it to see exactly where the ConPTY pipeline fails on this machine.
package main

import (
	"fmt"
	"os"
	"unsafe"

	"golang.org/x/sys/windows"
)

// Mirror the constants from pty_windows.go so this tool is self-contained.
const (
	extendedStartupInfoPresent       uint32  = 0x00080000
	createUnicodeEnvironment         uint32  = 0x00000400
	procThreadAttributePseudoConsole uintptr = 0x00020016
)

func step(n int, desc string) {
	fmt.Printf("[STEP %d] %s\n", n, desc)
}

func pass(n int, desc string) {
	fmt.Printf("[STEP %d] OK  — %s\n", n, desc)
}

func fail(n int, desc string, err error) {
	fmt.Printf("[STEP %d] FAIL — %s: %v\n", n, desc, err)
}

func main() {
	fmt.Println("=== ConPTY Diagnostic Tool ===")
	fmt.Printf("OS: %s\n\n", "windows")

	failedStep := ""

	// -------------------------------------------------------------------------
	// STEP 1 — CreatePipe (input pipe: ir = read end, iw = write end)
	// -------------------------------------------------------------------------
	step(1, "CreatePipe (input pipe: ir=read, iw=write)")
	var ir, iw windows.Handle
	if err := windows.CreatePipe(&ir, &iw, nil, 0); err != nil {
		fail(1, "CreatePipe input", err)
		failedStep = "Step 1: CreatePipe (input)"
		goto done
	}
	pass(1, fmt.Sprintf("ir=0x%x  iw=0x%x", ir, iw))

	// -------------------------------------------------------------------------
	// STEP 2 — CreatePipe (output pipe: or_ = read end, ow = write end)
	// -------------------------------------------------------------------------
	{
		step(2, "CreatePipe (output pipe: or_=read, ow=write)")
		var or_, ow windows.Handle
		if err := windows.CreatePipe(&or_, &ow, nil, 0); err != nil {
			fail(2, "CreatePipe output", err)
			windows.CloseHandle(ir)
			windows.CloseHandle(iw)
			failedStep = "Step 2: CreatePipe (output)"
			goto done
		}
		pass(2, fmt.Sprintf("or_=0x%x  ow=0x%x", or_, ow))

		// ---------------------------------------------------------------------
		// STEP 3 — CreatePseudoConsole
		// ---------------------------------------------------------------------
		step(3, "CreatePseudoConsole (size 80x25, ir, ow)")
		coord := windows.Coord{X: 80, Y: 25}
		var hPC windows.Handle
		if err := windows.CreatePseudoConsole(coord, ir, ow, 0, &hPC); err != nil {
			fail(3, "CreatePseudoConsole", err)
			windows.CloseHandle(ir)
			windows.CloseHandle(iw)
			windows.CloseHandle(or_)
			windows.CloseHandle(ow)
			failedStep = "Step 3: CreatePseudoConsole"
			goto done
		}
		pass(3, fmt.Sprintf("hPC=0x%x", hPC))

		// ConPTY now owns ir and ow — parent closes them.
		fmt.Println("         closing ir and ow (ConPTY owns them now)")
		windows.CloseHandle(ir)
		windows.CloseHandle(ow)

		// ---------------------------------------------------------------------
		// STEP 4 — NewProcThreadAttributeList
		// ---------------------------------------------------------------------
		step(4, "NewProcThreadAttributeList(1)")
		attrList, err := windows.NewProcThreadAttributeList(1)
		if err != nil {
			fail(4, "NewProcThreadAttributeList", err)
			windows.CloseHandle(or_)
			windows.CloseHandle(iw)
			windows.ClosePseudoConsole(hPC)
			failedStep = "Step 4: NewProcThreadAttributeList"
			goto done
		}
		pass(4, "attrList created")

		// ---------------------------------------------------------------------
		// STEP 5 — attrList.Update with PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE
		// ---------------------------------------------------------------------
		step(5, fmt.Sprintf("attrList.Update(PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE=0x%x, &hPC, sizeof(hPC))", procThreadAttributePseudoConsole))
		if err := attrList.Update(procThreadAttributePseudoConsole, unsafe.Pointer(&hPC), unsafe.Sizeof(hPC)); err != nil {
			fail(5, "attrList.Update", err)
			attrList.Delete()
			windows.CloseHandle(or_)
			windows.CloseHandle(iw)
			windows.ClosePseudoConsole(hPC)
			failedStep = "Step 5: attrList.Update (PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE)"
			goto done
		}
		pass(5, "attribute list updated with ConPTY handle")

		// ---------------------------------------------------------------------
		// STEP 6 — Build STARTUPINFOEX and call CreateProcess
		// ---------------------------------------------------------------------
		step(6, `CreateProcess for "C:\Windows\System32\cmd.exe" /C echo CONPTY-PROBE`)
		siEx := windows.StartupInfoEx{}
		siEx.StartupInfo.Cb = uint32(unsafe.Sizeof(siEx))
		siEx.ProcThreadAttributeList = attrList.List()

		probeCmd := `"C:\Windows\System32\cmd.exe" /C echo CONPTY-PROBE`
		cmdLinePtr, ptrErr := windows.UTF16PtrFromString(probeCmd)
		if ptrErr != nil {
			fail(6, "UTF16PtrFromString for command line", ptrErr)
			attrList.Delete()
			windows.CloseHandle(or_)
			windows.CloseHandle(iw)
			windows.ClosePseudoConsole(hPC)
			failedStep = "Step 6a: UTF16PtrFromString"
			goto done
		}

		var pi windows.ProcessInformation
		spawnErr := windows.CreateProcess(
			nil,
			cmdLinePtr,
			nil,
			nil,
			false,
			extendedStartupInfoPresent|createUnicodeEnvironment,
			nil,
			nil,
			&siEx.StartupInfo,
			&pi,
		)
		attrList.Delete()

		if spawnErr != nil {
			fail(6, "CreateProcess", spawnErr)
			windows.CloseHandle(or_)
			windows.CloseHandle(iw)
			windows.ClosePseudoConsole(hPC)
			failedStep = "Step 6: CreateProcess"
			goto done
		}
		pass(6, fmt.Sprintf("PID=%d  hProcess=0x%x  hThread=0x%x", pi.ProcessId, pi.Process, pi.Thread))
		windows.CloseHandle(pi.Thread)

		// ---------------------------------------------------------------------
		// STEP 7 — WaitForSingleObject (2000 ms)
		// ---------------------------------------------------------------------
		step(7, "WaitForSingleObject(hProcess, 2000ms)")
		waitResult, waitErr := windows.WaitForSingleObject(pi.Process, 2000)
		const waitObject0 uint32 = 0x00000000
		const waitTimeout uint32 = 0x00000102
		switch waitResult {
		case waitObject0:
			pass(7, "process exited before timeout")
		case waitTimeout:
			fmt.Printf("[STEP 7] WARN — process did NOT exit within 2s (WAIT_TIMEOUT); continuing\n")
		default:
			fmt.Printf("[STEP 7] WARN — WaitForSingleObject returned 0x%x err=%v; continuing\n", waitResult, waitErr)
		}

		// ---------------------------------------------------------------------
		// STEP 8 — TerminateProcess (safety, no-op if already exited)
		// ---------------------------------------------------------------------
		step(8, "TerminateProcess(hProcess, 1) [safety — no-op if already exited]")
		termErr := windows.TerminateProcess(pi.Process, 1)
		if termErr != nil {
			fmt.Printf("[STEP 8] NOTE — TerminateProcess: %v (probably already exited, that is fine)\n", termErr)
		} else {
			pass(8, "TerminateProcess called (or process already gone)")
		}
		windows.CloseHandle(pi.Process)

		// ---------------------------------------------------------------------
		// STEP 9 — ClosePseudoConsole (signals EOF on output pipe)
		// ---------------------------------------------------------------------
		step(9, "ClosePseudoConsole(hPC) — signals EOF on or_")
		windows.ClosePseudoConsole(hPC)
		pass(9, "ConPTY closed")

		// ---------------------------------------------------------------------
		// STEP 10 — CloseHandle(iw) (closes write end of input pipe)
		// ---------------------------------------------------------------------
		step(10, "CloseHandle(iw) — close input-write end")
		windows.CloseHandle(iw)
		pass(10, "iw closed")

		// ---------------------------------------------------------------------
		// STEP 11 — ReadFile on or_ (output read pipe)
		// ---------------------------------------------------------------------
		step(11, "ReadFile(or_, buf[256], ...) — read probe output")
		buf := make([]byte, 256)
		var n uint32
		readErr := windows.ReadFile(or_, buf, &n, nil)
		windows.CloseHandle(or_)

		if readErr != nil {
			fail(11, "ReadFile", readErr)
			failedStep = "Step 11: ReadFile"
			goto done
		}

		fmt.Printf("[STEP 11] OK  — ReadFile returned n=%d\n", n)
		if n > 0 {
			fmt.Printf("[STEP 11]      bytes (hex): % x\n", buf[:n])
			fmt.Printf("[STEP 11]      bytes (str): %q\n", string(buf[:n]))
		} else {
			fmt.Println("[STEP 11] WARN — n=0 (no bytes read); ConPTY may be non-functional")
			failedStep = "Step 11: ReadFile returned n=0 (no output from probe process)"
			goto done
		}
	}

done:
	fmt.Println()
	if failedStep == "" {
		fmt.Println("=== RESULT: PASS — ConPTY probe completed successfully ===")
		os.Exit(0)
	} else {
		fmt.Printf("=== RESULT: FAIL — failed at: %s ===\n", failedStep)
		os.Exit(1)
	}
}
