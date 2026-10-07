#!/bin/bash
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
git -C "$ROOT" remote get-url upstream >/dev/null 2>&1 || git -C "$ROOT" remote add upstream https://github.com/yomidevs/yomitan.git
git -C "$ROOT" remote set-url --push upstream disabled://upstream-read-only
git -C "$ROOT" fetch upstream master
printf '\nUpstream fetched READ ONLY. No merge, push or PR performed.\n'
git -C "$ROOT" log --oneline HEAD..upstream/master | head -30 || true
printf '\nAdapt on a separate local/fork branch; verify keys, permissions and build before replacing packages.\n'
