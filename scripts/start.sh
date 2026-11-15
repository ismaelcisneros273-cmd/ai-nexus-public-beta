#!/bin/sh
set -eu

CDPATH= cd -- "$(dirname -- "$0")/.."

if ! command -v node >/dev/null 2>&1; then
  echo '未找到 Node.js。请先从 https://nodejs.org/ 安装受支持的版本，再运行此脚本。' >&2
  exit 1
fi

node scripts/doctor.mjs
echo '正在启动 AI Nexus。请在 Mac 浏览器打开 http://127.0.0.1:4173/ ；按 Control-C 可停止。'
exec node --use-env-proxy server.mjs
