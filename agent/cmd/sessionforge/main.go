package main

import (
	"fmt"
	"os"

	"github.com/sessionforge/agent/internal/cli"
)

// Set via ldflags: -X main.Version=v1.0.0 -X main.BuildDate=2024-01-01 -X main.GitCommit=abc123
var (
	Version   = "0.1.0"
	BuildDate = "unknown"
	GitCommit = "unknown"
)

func main() {
	cli.SetVersion(Version, BuildDate, GitCommit)
	if err := cli.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
