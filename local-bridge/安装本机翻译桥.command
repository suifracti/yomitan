#!/bin/bash
set -euo pipefail
HERE="$(cd -- "$(dirname -- "$0")" && pwd)"
PYTHON="$(command -v python3 || true)"
if [[ -z "$PYTHON" ]]; then
  echo '需要 Python 3.11 或更新版本；不会自动下载安装。'
  exit 1
fi
"$PYTHON" "$HERE/install_bridge.py"
echo '完成。可关闭此终端。'
