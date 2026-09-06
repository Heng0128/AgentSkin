#!/usr/bin/env bash
# SPDX-License-Identifier: MPL-2.0
#
# install.sh — One-click installer for AgentSkin (macOS / Linux).
#
# Downloads the latest GitHub Release, verifies the platform, and installs
# to ~/.agentskin/ with a shortcut in ~/Applications (macOS) or a .desktop
# file (Linux).
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/agentskin-desktop/agentskin/main/scripts/install.sh | bash
#   # or
#   ./scripts/install.sh
#
# Environment overrides:
#   AGENTSKIN_GITHUB_REPO  — GitHub repo (default: agentskin-desktop/agentskin)
#   AGENTSKIN_INSTALL_DIR  — Install directory (default: ~/.agentskin)
#   AGENTSKIN_VERSION     — Pin a specific version (e.g. v1.0.0); "latest" for newest

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
GITHUB_REPO="${AGENTSKIN_GITHUB_REPO:-agentskin-desktop/agentskin}"
GITHUB_API="https://api.github.com/repos/${GITHUB_REPO}"
GITHUB_RELEASES="https://github.com/${GITHUB_REPO}/releases"
INSTALL_DIR="${AGENTSKIN_INSTALL_DIR:-$HOME/.agentskin}"
VERSION="${AGENTSKIN_VERSION:-latest}"
NODE_MIN_MAJOR=22

# ---------------------------------------------------------------------------
# Color output
# ---------------------------------------------------------------------------
if [[ -t 1 ]]; then
  C_RED='\033[0;31m'
  C_GREEN='\033[0;32m'
  C_YELLOW='\033[1;33m'
  C_BLUE='\033[0;34m'
  C_BOLD='\033[1m'
  C_RESET='\033[0m'
else
  C_RED='' C_GREEN='' C_YELLOW='' C_BLUE='' C_BOLD='' C_RESET=''
fi

log_info()  { echo -e "${C_BLUE}[INFO]${C_RESET}  $*"; }
log_ok()    { echo -e "${C_GREEN}[OK]${C_RESET}    $*"; }
log_warn()  { echo -e "${C_YELLOW}[WARN]${C_RESET}  $*"; }
log_error() { echo -e "${C_RED}[ERROR]${C_RESET} $*"; }
log_step()  { echo -e "${C_BOLD}[STEP]${C_RESET}  $*"; }

# ---------------------------------------------------------------------------
# Platform detection
# ---------------------------------------------------------------------------
detect_platform() {
  OS="$(uname -s)"
  ARCH="$(uname -m)"

  case "$OS" in
    Darwin)
      PLATFORM="macos"
      if [[ "$ARCH" == "arm64" ]]; then
        ARCH_TAG="arm64"
      elif [[ "$ARCH" == "x86_64" ]]; then
        ARCH_TAG="x64"
      else
        log_error "Unsupported macOS architecture: $ARCH"
        exit 1
      fi
      ;;
    Linux)
      PLATFORM="linux"
      if [[ "$ARCH" == "x86_64" ]]; then
        ARCH_TAG="x64"
      else
        log_error "Unsupported Linux architecture: $ARCH (only x64 is currently built)"
        exit 1
      fi
      ;;
    *)
      log_error "Unsupported operating system: $OS (only macOS and Linux are supported)"
      exit 1
      ;;
  esac

  log_info "Platform: ${PLATFORM} ${ARCH_TAG} (${ARCH})"
}

# ---------------------------------------------------------------------------
# Dependency check: Node.js >= 22
# ---------------------------------------------------------------------------
check_node() {
  if command -v node &>/dev/null; then
    NODE_VERSION="$(node -v)"
    NODE_MAJOR="${NODE_VERSION#v}"
    NODE_MAJOR="${NODE_MAJOR%%.*}"

    if (( NODE_MAJOR >= NODE_MIN_MAJOR )); then
      log_ok "Node.js ${NODE_VERSION} detected (>= ${NODE_MIN_MAJOR})"
      return 0
    else
      log_warn "Node.js ${NODE_VERSION} is below the required v${NODE_MIN_MAJOR}"
    fi
  else
    log_warn "Node.js not found in PATH"
  fi

  echo ""
  log_error "AgentSkin requires Node.js >= ${NODE_MIN_MAJOR}"
  echo ""
  echo "  Install options:"
  echo "    - Official:    https://nodejs.org/"
  echo "    - Homebrew:    brew install node@22        (macOS)"
  echo "    - nvm:         nvm install 22              (any platform)"
  echo "    - fnm:         fnm install 22              (any platform)"
  echo ""
  exit 1
}

# ---------------------------------------------------------------------------
# Dependency check: curl or wget
# ---------------------------------------------------------------------------
detect_downloader() {
  if command -v curl &>/dev/null; then
    DOWNLOADER="curl"
  elif command -v wget &>/dev/null; then
    DOWNLOADER="wget"
  else
    log_error "Neither curl nor wget found. Please install one of them."
    exit 1
  fi
  log_info "Downloader: ${DOWNLOADER}"
}

# ---------------------------------------------------------------------------
# Fetch latest release version from GitHub API
# ---------------------------------------------------------------------------
fetch_latest_version() {
  log_step "Fetching latest release from ${GITHUB_REPO}..."

  local api_url="${GITHUB_API}/releases/latest"
  local tag=""

  if [[ "$DOWNLOADER" == "curl" ]]; then
    tag="$(curl -fsSL --retry 3 --retry-delay 2 \
      -H "Accept: application/vnd.github+json" \
      "$api_url" 2>/dev/null | grep -m1 '"tag_name"' | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/')"
  else
    tag="$(wget -qO- --tries=3 \
      --header="Accept: application/vnd.github+json" \
      "$api_url" 2>/dev/null | grep -m1 '"tag_name"' | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/')"
  fi

  if [[ -z "$tag" ]]; then
    log_error "Could not determine latest release version."
    log_error "Check that the repository exists: ${GITHUB_RELEASES}"
    exit 1
  fi

  LATEST_VERSION="$tag"
  log_ok "Latest release: ${LATEST_VERSION}"
}

# ---------------------------------------------------------------------------
# Resolve the version to install
# ---------------------------------------------------------------------------
resolve_version() {
  if [[ "$VERSION" == "latest" ]]; then
    fetch_latest_version
    INSTALL_VERSION="$LATEST_VERSION"
  else
    INSTALL_VERSION="$VERSION"
    log_info "Using pinned version: ${INSTALL_VERSION}"
  fi
}

# ---------------------------------------------------------------------------
# Download the release asset for the current platform
# ---------------------------------------------------------------------------
download_release() {
  log_step "Downloading AgentSkin ${INSTALL_VERSION} for ${PLATFORM} ${ARCH_TAG}..."

  # Determine asset filename pattern
  case "$PLATFORM" in
    macos)
      ASSET_NAME="AgentSkin-${INSTALL_VERSION}-arm64.dmg"
      ASSET_PATTERN="arm64.dmg"
      ;;
    linux)
      # Linux builds are not yet published as release assets.
      # Fall back to source tarball.
      ASSET_NAME="${INSTALL_VERSION}.tar.gz"
      ASSET_PATTERN=".tar.gz"
      ;;
  esac

  DOWNLOAD_URL="${GITHUB_RELEASES}/download/${INSTALL_VERSION}/${ASSET_NAME}"
  TMP_DIR="$(mktemp -d)"
  TMP_FILE="${TMP_DIR}/${ASSET_NAME}"

  log_info "URL: ${DOWNLOAD_URL}"

  local http_code=""
  if [[ "$DOWNLOADER" == "curl" ]]; then
    http_code="$(curl -fsSL --retry 3 --retry-delay 2 \
      -w '%{http_code}' \
      -o "$TMP_FILE" \
      "$DOWNLOAD_URL" 2>/dev/null)"
  else
    if ! wget -q --tries=3 -O "$TMP_FILE" "$DOWNLOAD_URL" 2>/dev/null; then
      http_code="000"
    else
      http_code="200"
    fi
  fi

  if [[ "$http_code" != "200" ]]; then
    # Try alternative patterns
    if [[ "$PLATFORM" == "macos" ]]; then
      # Try x64 dmg as fallback
      ASSET_NAME="AgentSkin-${INSTALL_VERSION}-x64.dmg"
      DOWNLOAD_URL="${GITHUB_RELEASES}/download/${INSTALL_VERSION}/${ASSET_NAME}"
      log_warn "arm64 DMG not found, trying x64..."
      if [[ "$DOWNLOADER" == "curl" ]]; then
        http_code="$(curl -fsSL --retry 3 --retry-delay 2 \
          -w '%{http_code}' -o "$TMP_FILE" "$DOWNLOAD_URL" 2>/dev/null)"
      else
        if wget -q --tries=3 -O "$TMP_FILE" "$DOWNLOAD_URL" 2>/dev/null; then
          http_code="200"
        fi
      fi
    fi
  fi

  if [[ "$http_code" != "200" ]]; then
    rm -rf "$TMP_DIR"
    log_error "Download failed (HTTP ${http_code})."
    log_error "Asset not found: ${DOWNLOAD_URL}"
    log_error ""
    log_error "This version may not have a ${PLATFORM} ${ARCH_TAG} build yet."
    log_error "Available assets: ${GITHUB_RELEASES}/tag/${INSTALL_VERSION}"
    exit 1
  fi

  local size
  size="$(du -h "$TMP_FILE" | cut -f1)"
  log_ok "Downloaded: ${ASSET_NAME} (${size})"
}

# ---------------------------------------------------------------------------
# Install the downloaded asset
# ---------------------------------------------------------------------------
install_release() {
  log_step "Installing to ${INSTALL_DIR}..."

  # Create install directory
  mkdir -p "$INSTALL_DIR"

  case "$PLATFORM" in
    macos)
      install_macos
      ;;
    linux)
      install_linux
      ;;
  esac
}

install_macos() {
  local dmg_file
  dmg_file="$(ls "${TMP_DIR}"/*.dmg 2>/dev/null | head -1)"

  if [[ -z "$dmg_file" ]]; then
    log_error "No DMG file found in download."
    exit 1
  fi

  log_info "Mounting DMG..."
  local mount_point
  mount_point="$(hdiutil attach "$dmg_file" -nobrowse -readonly 2>/dev/null | \
    tail -1 | awk '{print $3}')"

  if [[ -z "$mount_point" ]] || [[ ! -d "$mount_point" ]]; then
    log_error "Failed to mount DMG."
    exit 1
  fi

  # Copy .app bundle
  local app_name
  app_name="$(ls "$mount_point" | grep '\.app$' | head -1)"

  if [[ -n "$app_name" ]]; then
    log_info "Copying ${app_name}..."
    rm -rf "${INSTALL_DIR}/${app_name}"
    cp -R "${mount_point}/${app_name}" "${INSTALL_DIR}/${app_name}"
    APP_BUNDLE="${INSTALL_DIR}/${app_name}"
  else
    # Fallback: copy entire contents
    log_info "Copying DMG contents..."
    cp -R "${mount_point}/"* "${INSTALL_DIR}/" 2>/dev/null || true
  fi

  # Unmount
  hdiutil detach "$mount_point" -quiet 2>/dev/null || true

  # Create ~/Applications shortcut
  if [[ -n "${APP_BUNDLE:-}" ]]; then
    local apps_dir="$HOME/Applications"
    mkdir -p "$apps_dir"
    local ln_target="${apps_dir}/$(basename "$APP_BUNDLE")"
    if [[ -e "$ln_target" ]]; then
      rm -rf "$ln_target"
    fi
    ln -sf "$APP_BUNDLE" "$ln_target"
    log_ok "Shortcut created: ${ln_target}"
  fi
}

install_linux() {
  local tar_file
  tar_file="$(ls "${TMP_DIR}"/*.tar.gz 2>/dev/null | head -1)"

  if [[ -z "$tar_file" ]]; then
    log_error "No tarball found in download."
    exit 1
  fi

  log_info "Extracting tarball..."
  tar -xzf "$tar_file" -C "$INSTALL_DIR" --strip-components=1

  # Create .desktop file
  local desktop_dir="$HOME/.local/share/applications"
  mkdir -p "$desktop_dir"

  local app_name="AgentSkin"
  local exec_path="${INSTALL_DIR}/AgentSkin"
  local icon_path="${INSTALL_DIR}/resources/runtime/icon.png"

  cat > "${desktop_dir}/agentskin.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=AgentSkin
Comment=AI Agent Visual Customization Engine
Exec=${exec_path}
Icon=${icon_path}
Terminal=false
Categories=Development;Utility;
EOF

  log_ok "Desktop entry created: ${desktop_dir}/agentskin.desktop"

  # Update desktop database
  if command -v update-desktop-database &>/dev/null; then
    update-desktop-database "$desktop_dir" 2>/dev/null || true
  fi
}

# ---------------------------------------------------------------------------
# Print success banner
# ---------------------------------------------------------------------------
print_success() {
  echo ""
  echo -e "${C_GREEN}${C_BOLD}  ╔══════════════════════════════════════════════════╗${C_RESET}"
  echo -e "${C_GREEN}${C_BOLD}  ║         AgentSkin installed successfully!        ║${C_RESET}"
  echo -e "${C_GREEN}${C_BOLD}  ╚══════════════════════════════════════════════════╝${C_RESET}"
  echo ""
  log_info "Version:    ${INSTALL_VERSION}"
  log_info "Location:   ${INSTALL_DIR}"

  case "$PLATFORM" in
    macos)
      if [[ -n "${APP_BUNDLE:-}" ]]; then
        echo ""
        log_info "Launch:     open \"${APP_BUNDLE}\""
        log_info "Or find AgentSkin in ~/Applications"
      fi
      ;;
    linux)
      echo ""
      log_info "Launch:     ${INSTALL_DIR}/AgentSkin"
      log_info "Or search 'AgentSkin' in your application menu"
      ;;
  esac

  echo ""
  log_info "Uninstall:  rm -rf ${INSTALL_DIR}"
  echo ""
}

# ---------------------------------------------------------------------------
# Cleanup on exit
# ---------------------------------------------------------------------------
cleanup() {
  if [[ -n "${TMP_DIR:-}" ]] && [[ -d "$TMP_DIR" ]]; then
    rm -rf "$TMP_DIR"
  fi
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
  echo ""
  echo -e "${C_BOLD}  AgentSkin One-Click Installer${C_RESET}"
  echo -e "${C_BOLD}  ─────────────────────────────${C_RESET}"
  echo ""

  detect_platform
  check_node
  detect_downloader
  resolve_version
  download_release
  install_release
  print_success
}

main "$@"
