// Source checkpoints below this boundary are immutable archives, often partial
// package snapshots. They are not standalone application test packages.
// Intentional checkpoint QA reads exact files via explicit overlays or scripts.
module native-dsh/desktop/qa-source-checkpoints

go 1.27.3
