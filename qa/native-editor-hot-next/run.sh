#!/bin/zsh
set -euo pipefail
qa_dir=${0:A:h}
desktop_dir=${qa_dir:h:h}
mkdir -p "$qa_dir/build"
cd "$desktop_dir"
swiftc -swift-version 5 -target arm64-apple-macos15.8 composer_native/*.swift "$qa_dir/main.swift" -o "$qa_dir/build/native-editor-hot-checks"
"$qa_dir/build/native-editor-hot-checks" "${1:-$qa_dir/build/results.json}"
