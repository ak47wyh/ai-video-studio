#!/usr/bin/env bash
# 一键启动脚本（Linux/macOS）
# 用法：./scripts/start.sh 或 bash scripts/start.sh
#
# 职责：检测并安装 Node.js，然后调用跨平台核心脚本启动服务

# 不用 set -e，手动处理关键错误，避免函数返回码陷阱
set -uo pipefail

# ===== 配置 =====
NODE_MIN_MAJOR=20
NPM_MIN_MAJOR=9
NODE_INSTALL_VERSION="22"

# ===== 颜色输出 =====
info()  { printf "\033[36m[INFO]\033[0m  %s\n" "$*"; }
warn()  { printf "\033[33m[WARN]\033[0m  %s\n" "$*"; }
error() { printf "\033[31m[ERROR]\033[0m %s\n" "$*"; }
ok()    { printf "\033[32m[OK]\033[0m    %s\n" "$*"; }

# ===== 步骤 1：检测 Node.js =====
# 返回：0=满足，1=未安装，2=版本过低
detect_node() {
  if ! command -v node &>/dev/null; then
    return 1
  fi
  local ver
  ver=$(node -p "process.versions.node.split('.')[0]" 2>/dev/null) || return 1
  if (( ver < NODE_MIN_MAJOR )); then
    warn "Node.js 版本过低：v$(node -v)（需要 >= v$NODE_MIN_MAJOR）"
    return 2
  fi
  return 0
}

# ===== 步骤 2：安装 Node.js =====
install_node() {
  info "开始安装 Node.js v$NODE_INSTALL_VERSION..."

  # 优先用 nvm（用户级安装，不需要 sudo）
  if [ -s "$HOME/.nvm/nvm.sh" ]; then
    info "检测到 nvm，使用 nvm 安装..."
    . "$HOME/.nvm/nvm.sh"
    nvm install "$NODE_INSTALL_VERSION"
    nvm use "$NODE_INSTALL_VERSION"
    ok "Node.js 已通过 nvm 安装"
    return 0
  fi

  # 探测系统包管理器
  if command -v apt-get &>/dev/null; then
    info "使用 NodeSource 官方源（apt）..."
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_INSTALL_VERSION}.x" | sudo -E bash -
    sudo apt-get install -y nodejs
  elif command -v dnf &>/dev/null; then
    info "使用 NodeSource 官方源（dnf）..."
    curl -fsSL "https://rpm.nodesource.com/setup_${NODE_INSTALL_VERSION}.x" | sudo -E bash -
    sudo dnf install -y nodejs
  elif command -v yum &>/dev/null; then
    info "使用 NodeSource 官方源（yum）..."
    curl -fsSL "https://rpm.nodesource.com/setup_${NODE_INSTALL_VERSION}.x" | sudo -E bash -
    sudo yum install -y nodejs
  elif command -v brew &>/dev/null; then
    info "使用 Homebrew 安装..."
    brew install "node@${NODE_INSTALL_VERSION}"
    brew link --overwrite "node@${NODE_INSTALL_VERSION}"
  else
    error "未识别的包管理器，请手动安装 Node.js >= $NODE_MIN_MAJOR："
    error "  https://nodejs.org/en/download/"
    error "或安装 nvm 后重试：https://github.com/nvm-sh/nvm"
    return 1
  fi

  ok "Node.js 安装完成：$(node -v)"
  return 0
}

# ===== 主流程 =====
main() {
  echo ""
  echo "═══════════════════════════════════════════"
  echo "  AI Video Studio — 一键启动（Linux/macOS）"
  echo "═══════════════════════════════════════════"
  info "工作目录：$(pwd)"
  echo ""

  # 步骤 1：Node 检测
  info "[1/3] 检测 Node.js..."
  rc=0
  detect_node || rc=$?
  case $rc in
    0) ok "Node.js: $(node -v)" ;;
    1) warn "未检测到 Node.js"; install_node || { error "Node.js 安装失败"; exit 1; } ;;
    2) install_node || { error "Node.js 升级失败"; exit 1; } ;;
  esac

  # 步骤 2：npm 检测
  info "[2/3] 检测 npm..."
  if ! command -v npm &>/dev/null; then
    error "npm 未安装，请重新安装 Node.js（npm 会随 Node 一起安装）"
    exit 1
  fi
  npm_major=$(npm -v | cut -d. -f1)
  if (( npm_major < NPM_MIN_MAJOR )); then
    warn "npm 版本过低：$(npm -v)（需要 >= $NPM_MIN_MAJOR）"
    warn "请升级 Node.js 到 LTS 版本"
    exit 1
  fi
  ok "npm: $(npm -v)"

  # 步骤 3：首次运行安装依赖（仅 node_modules 不存在时执行）
  info "[3/4] 检查依赖..."
  local script_dir project_root
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  project_root="$(cd "$script_dir/.." && pwd)"
  if [ ! -d "$project_root/node_modules" ]; then
    info "首次运行（node_modules 不存在），执行 npm install..."
    (cd "$project_root" && npm install) || { error "依赖安装失败"; exit 1; }
    ok "依赖安装完成"
  else
    ok "node_modules 已存在，跳过依赖安装"
  fi

  # 步骤 4：调用 Node 核心脚本
  info "[4/4] 进入核心流程..."
  echo ""
  exec node "$script_dir/lib/run-dev.mjs"
}

main "$@"
