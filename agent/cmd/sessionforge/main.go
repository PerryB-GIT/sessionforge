package main

import (
	"fmt"
	"os"

	"github.com/sessionforge/agent/internal/cli"
)

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
