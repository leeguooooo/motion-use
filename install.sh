#!/bin/sh
# Install motion-use from a GitHub Release.
#   curl -fsSL https://raw.githubusercontent.com/leeguooooo/motion-use/main/install.sh | sh
#
# What it does: downloads motion-use-vX.Y.Z.tar.gz and its .sha256 from the release,
# verifies the checksum, unpacks into $MOTION_USE_HOME/versions/X.Y.Z, installs the
# npm dependencies there (npm ci, no install scripts), points $MOTION_USE_HOME/current
# at it, and writes a `motion-use` launcher into $MOTION_USE_BIN_DIR.
# It only ever removes or replaces files and folders it created itself.
#
# Needs: Node.js 22+ with npm, curl, tar. Rendering also needs ffmpeg and Chrome;
# run `motion-use doctor` afterwards.
#
# Environment:
#   MOTION_USE_HOME     install root (default ~/.local/share/motion-use)
#   MOTION_USE_BIN_DIR  where the launcher goes (default ~/.local/bin)
#   MOTION_USE_VERSION  version to install (default: latest release)
#   MOTION_USE_ARCHIVE  install from this local .tar.gz instead of downloading (checksum file next to it)
#   MOTION_USE_SKILL=0  do not link the agent skill into ~/.agents/skills
set -eu

REPO="leeguooooo/motion-use"
HOME_DIR="${MOTION_USE_HOME:-$HOME/.local/share/motion-use}"
BIN_DIR="${MOTION_USE_BIN_DIR:-$HOME/.local/bin}"
RECEIPT=.motion-use-install.json

say() { printf '%s\n' "$*"; }
die() { printf 'motion-use install: %s\n' "$*" >&2; exit 1; }
owned() { [ -f "$1/$RECEIPT" ]; }

command -v node >/dev/null 2>&1 || die "Node.js 22 or newer is required: https://nodejs.org"
command -v npm >/dev/null 2>&1 || die "npm is required (it comes with Node.js)"
command -v tar >/dev/null 2>&1 || die "tar is required"
major=$(node -e 'process.stdout.write(process.versions.node.split(".")[0])')
[ "$major" -ge 22 ] || die "Node.js 22 or newer is required (found $(node -v))"
launcher="$BIN_DIR/motion-use"
if [ -e "$launcher" ] && ! grep -q '^# motion-use launcher' "$launcher" 2>/dev/null; then die "$launcher exists and is not a motion-use launcher; move it away first"; fi

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1
  else die "need sha256sum or shasum to verify the download"; fi
}

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

if [ -n "${MOTION_USE_ARCHIVE:-}" ]; then
  archive="$MOTION_USE_ARCHIVE"
  [ -f "$archive" ] || die "no such archive: $archive"
  [ -f "$archive.sha256" ] || die "missing checksum file: $archive.sha256"
  cp "$archive.sha256" "$tmp/archive.sha256"
else
  command -v curl >/dev/null 2>&1 || die "curl is required"
  version="${MOTION_USE_VERSION:-}"
  if [ -z "$version" ]; then
    version=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null | sed -n 's/.*"tag_name": *"v\{0,1\}\([^"]*\)".*/\1/p' | head -1)
    # The anonymous API is rate-limited per IP; the releases page redirects to the tag without that limit.
    [ -n "$version" ] || version=$(curl -fsSI "https://github.com/$REPO/releases/latest" 2>/dev/null | tr -d '\r' | sed -n 's#^[Ll]ocation: .*/tag/v\{0,1\}\([0-9][0-9.]*\)$#\1#p' | head -1)
    [ -n "$version" ] || die "could not find the latest release of $REPO"
  fi
  version=${version#v}
  printf '%s' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || die "not a version: $version"
  base="https://github.com/$REPO/releases/download/v$version/motion-use-v$version.tar.gz"
  say "downloading motion-use $version"
  curl -fsSL "$base" -o "$tmp/archive.tar.gz" || die "download failed: $base"
  curl -fsSL "$base.sha256" -o "$tmp/archive.sha256" || die "download failed: $base.sha256"
  archive="$tmp/archive.tar.gz"
fi

want=$(cut -d' ' -f1 < "$tmp/archive.sha256")
got=$(sha256 "$archive")
[ "$want" = "$got" ] || die "checksum mismatch (expected $want, got $got)"
say "checksum ok"

mkdir -p "$tmp/x"
tar -xzf "$archive" -C "$tmp/x"
src=$(find "$tmp/x" -mindepth 1 -maxdepth 1 -type d | head -1)
[ -n "$src" ] && [ -f "$src/package.json" ] || die "archive has no package.json"
version=$(node -e 'process.stdout.write(String(require(process.argv[1]).version))' "$src/package.json")
# The version becomes a directory name: plain semver only.
printf '%s' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || die "unexpected version in archive: $version"

dest="$HOME_DIR/versions/$version"
mkdir -p "$HOME_DIR/versions"
if [ -e "$dest" ] && ! owned "$dest"; then die "$dest exists and was not created by this installer; move it away first"; fi
if [ -e "$HOME_DIR/current" ] || [ -L "$HOME_DIR/current" ]; then
  # Only take over a `current` link that this installer made: it points at an owned versions/<x>.
  cur=$(readlink "$HOME_DIR/current" 2>/dev/null || true)
  case "$cur" in versions/*) ;; *) die "$HOME_DIR/current was not made by this installer; move it away first" ;; esac
  owned "$HOME_DIR/$cur" || die "$HOME_DIR/current points at $cur, which this installer did not create"
fi
# A fresh, uniquely named staging folder; on failure only that folder is removed.
stage=$(mktemp -d "$HOME_DIR/versions/.stage.XXXXXX")
rmdir "$stage"
mv "$src" "$stage"
say "installing dependencies (npm ci)"
(cd "$stage" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error) || { rm -rf "$stage"; die "npm ci failed"; }
node -e 'const [f, version, home, bin_dir] = process.argv.slice(1); require("fs").writeFileSync(f, JSON.stringify({ version, home, bin_dir }) + "\n")' \
  "$stage/$RECEIPT" "$version" "$HOME_DIR" "$BIN_DIR"
rm -rf "$dest"
mv "$stage" "$dest"
ln -sfn "versions/$version" "$HOME_DIR/current"

# The launcher. Paths are single-quoted for sh, so spaces, $ and quotes in them are safe.
quoted=$(printf '%s' "$HOME_DIR/current/bin/motion-use.mjs" | sed "s/'/'\\\\''/g")
mkdir -p "$BIN_DIR"
printf '#!/bin/sh\n# motion-use launcher (written by install.sh)\nexec node '"'"'%s'"'"' "$@"\n' "$quoted" > "$launcher"
chmod +x "$launcher"

# Keep the current and the previous version; remove older ones this installer made.
ls -1t "$HOME_DIR/versions" 2>/dev/null | tail -n +3 | while read -r old; do
  [ "$old" = "$version" ] && continue
  owned "$HOME_DIR/versions/$old" && rm -rf "$HOME_DIR/versions/$old"
done

if [ "${MOTION_USE_SKILL:-1}" != 0 ] && [ -d "$HOME/.agents/skills" ]; then
  link="$HOME/.agents/skills/motion-use"
  if [ ! -e "$link" ] && [ ! -L "$link" ]; then
    ln -s "$HOME_DIR/current" "$link" && say "linked skill: $link"
  elif [ -L "$link" ] && [ "$(readlink "$link")" = "$HOME_DIR/current" ]; then
    say "skill: $link is up to date"
  else
    say "skill: left $link alone (not made by this installer)"
  fi
fi

say "installed motion-use $version -> $launcher"
case ":$PATH:" in *":$BIN_DIR:"*) ;; *) say "note: $BIN_DIR is not on your PATH; add it, or run $launcher" ;; esac
say "next: motion-use doctor"
