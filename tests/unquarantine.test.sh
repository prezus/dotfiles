#!/bin/bash
# Real macOS xattrs, isolated HOME; never touches real Downloads or launchd.
set -euo pipefail
if [ "$(uname -s)" != Darwin ]; then printf 'SKIP: macOS xattr integration\n'; exit 0; fi
repo=$(cd -- "$(dirname -- "$0")/.." && pwd -P)
fixture=$(mktemp -d "${TMPDIR:-/tmp}/unquarantine-test.XXXXXX")
fixture=$(cd "$fixture" && pwd -P)
trap 'chmod -R u+rwX "$fixture"; rm -rf -- "$fixture"' EXIT
export HOME=$fixture/home
export TMPDIR=$fixture/tmp
mkdir -p "$HOME/Downloads" "$TMPDIR" "$fixture/repo/bin" "$fixture/repo/config" "$fixture/repo/LaunchAgents" "$fixture/outside"
cp "$repo/bin/unquarantine" "$repo/bin/unquarantine-install" "$fixture/repo/bin/"
cp "$repo/LaunchAgents/local.unquarantine.plist" "$fixture/repo/LaunchAgents/"
worker=$fixture/repo/bin/unquarantine
installer=$fixture/repo/bin/unquarantine-install
config=$fixture/repo/config/unquarantine.conf
unset EXTENSIONS WATCH_DIRS RECURSIVE MAX_DEPTH LOG_FILE DRY_RUN
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
clean() { /bin/bash "$worker" "$@"; }
quarantined() { xattr -p com.apple.quarantine "$1" >/dev/null 2>&1; }
seed() {
    printf 'key = value\n' > "$1"
    xattr -w com.apple.quarantine "0081;$(printf %x "$(date +%s)");Chrome;$(uuidgen)" "$1"
    touch -t 202001010000 "$1"
}
expect_code() {
    local expected=$1 actual=0
    shift
    "$@" > "$fixture/result" 2>&1 || actual=$?
    [ "$actual" -eq "$expected" ] || { cat "$fixture/result" >&2; fail "expected exit $expected, got $actual: $*"; }
}
weird="$HOME/Downloads/weird name'with\"quotes.conf"
newline="$HOME/Downloads/line
break.CONF"
seed "$HOME/Downloads/default.conf"
seed "$HOME/Downloads/wrong.txt"
seed "$weird"
seed "$newline"
seed "$HOME/Downloads/pending.conf.crdownload"
seed "$fixture/outside/target.conf"
ln -s "$fixture/outside/target.conf" "$HOME/Downloads/link.conf"
ln -s "$fixture/outside" "$HOME/Downloads/escape"
xattr -w com.example.retained keep "$weird"
clean --status | grep 'Matching quarantined files.*: 3' || fail 'status count'
clean --dry-run
quarantined "$weird" || fail 'dry run mutated xattr'
[ ! -e "$HOME/.local/state" ] || fail 'dry run wrote state'
clean
for f in "$HOME/Downloads/default.conf" "$weird" "$newline"; do
    if quarantined "$f"; then fail "not cleaned: $f"; fi
done
[ "$(xattr -p com.example.retained "$weird")" = keep ] || fail 'other xattr lost'
quarantined "$HOME/Downloads/wrong.txt" || fail 'wrong extension cleaned'
quarantined "$HOME/Downloads/pending.conf.crdownload" || fail 'partial download cleaned'
quarantined "$fixture/outside/target.conf" || fail 'symlink followed'
before=$(wc -l < "$HOME/.local/state/unquarantine.log")
clean
[ "$(wc -l < "$HOME/.local/state/unquarantine.log")" = "$before" ] || fail 'second sweep not a no-op'
clean --status | grep '^OK ' || fail 'read health missing'
seed "$HOME/Downloads/new.conf"
touch "$HOME/Downloads/new.conf"
clean
quarantined "$HOME/Downloads/new.conf" || fail 'young file cleaned'
clean --all "$HOME/Downloads/wrong.txt" "$HOME/Downloads/pending.conf.crdownload"
if quarantined "$HOME/Downloads/wrong.txt"; then fail '--all ignored'; fi
quarantined "$HOME/Downloads/pending.conf.crdownload" || fail '--all cleaned in-progress file'
expect_code 1 clean "$HOME/Downloads/escape/target.conf"
expect_code 1 clean --all "$fixture/outside/target.conf"
expect_code 1 clean "$HOME"
expect_code 1 clean /
expect_code 2 clean --all
expect_code 2 clean --unknown
expect_code 2 clean --all ''
clean --all "$HOME/Downloads/escape/"
quarantined "$fixture/outside/target.conf" || fail 'trailing slash followed a directory link'
trailing_newline="$HOME/Downloads/direct
"
seed "$trailing_newline"
clean --all "$trailing_newline"
if quarantined "$trailing_newline"; then fail 'trailing newline path mishandled'; fi

mkdir -p "$HOME/Downloads/nested/deeper" "$HOME/Downloads/Safari.download/inner"
seed "$HOME/Downloads/nested/deep.cfg"
seed "$HOME/Downloads/nested/deeper/too-deep.conf"
seed "$HOME/Downloads/Safari.download/inner/pending.conf"
RECURSIVE=true MAX_DEPTH=2 clean
if quarantined "$HOME/Downloads/nested/deep.cfg"; then fail 'recursive file missed'; fi
quarantined "$HOME/Downloads/nested/deeper/too-deep.conf" || fail 'depth exceeded'
RECURSIVE=true MAX_DEPTH=5 clean
quarantined "$HOME/Downloads/Safari.download/inner/pending.conf" || fail 'Safari download directory traversed'
clean --all "$HOME/Downloads/Safari.download/inner/pending.conf"
quarantined "$HOME/Downloads/Safari.download/inner/pending.conf" || fail 'direct path bypassed download directory skip'

printf 'EXTENSIONS="txt"\nDRY_RUN=true\n' > "$config"
seed "$HOME/Downloads/override.txt"
DRY_RUN=false EXTENSIONS='' clean
quarantined "$HOME/Downloads/override.txt" || fail 'explicit empty extensions ignored'
DRY_RUN=false EXTENSIONS=txt LOG_FILE='' clean
if quarantined "$HOME/Downloads/override.txt"; then fail 'environment override ignored'; fi
WATCH_DIRS='' clean --status | grep 'Matching quarantined files.*: 0' || fail 'empty watch dirs ignored'
WATCH_DIRS='~/Missing' clean
expect_code 1 env WATCH_DIRS="$HOME/Downloads/escape/missing" /bin/bash "$worker"
expect_code 1 env MAX_DEPTH=no /bin/bash "$worker"
expect_code 1 env WATCH_DIRS=Downloads /bin/bash "$worker"
printf 'EXTENSIONS=(\n' > "$config"
expect_code 1 clean
rm "$config"
mkdir "$config"
expect_code 1 clean
rmdir "$config"

# Stub only launchctl: install/uninstall must never affect the real user agent.
mkdir "$fixture/commands"
export LAUNCH_TEST_DIR=$fixture/launch
mkdir "$LAUNCH_TEST_DIR"
cat > "$fixture/commands/launchctl" <<'STUB'
#!/bin/bash
printf '%s\n' "$*" >> "$LAUNCH_TEST_DIR/calls"
case "$1" in
    print) test -f "$LAUNCH_TEST_DIR/loaded" ;;
    bootstrap) touch "$LAUNCH_TEST_DIR/loaded" ;;
    bootout) rm "$LAUNCH_TEST_DIR/loaded" ;;
    *) exit 99 ;;
esac
STUB
chmod +x "$fixture/commands/launchctl"
export PATH=$fixture/commands:$PATH
cat > "$fixture/commands/find" <<'STUB'
#!/bin/bash
printf 'find: Operation not permitted (synthetic TCC denial)\n' >&2
exit 1
STUB
chmod +x "$fixture/commands/find"
expect_code 1 clean
grep 'READ FAILED' "$fixture/result" || fail 'read failure was silent'
grep '^FAILED ' "$HOME/.local/state/unquarantine.status" || fail 'read failure not persisted'
rm "$fixture/commands/find"
clean --status > "$fixture/status"
grep '^FAILED ' "$fixture/status" || fail 'status hid last failed read'
grep '^OK ' "$fixture/status" || fail 'status did not retry read'
special="$HOME/Downloads/a & <b> 'quote\" space"
mkdir "$special"
printf 'WATCH_DIRS=("$HOME/Downloads" "$HOME/Downloads/a & <b> '\''quote\\\" space")\n' > "$config"
/bin/bash "$installer" install
plist=$HOME/Library/LaunchAgents/local.unquarantine.plist
plutil -lint "$plist"
[ "$(/usr/libexec/PlistBuddy -c 'Print :WatchPaths:1' "$plist")" = "$special" ] || fail 'plist path escaping'
[ "$(/usr/libexec/PlistBuddy -c 'Print :StartInterval' "$plist")" = 60 ] || fail 'retry interval'
[ "$(/usr/libexec/PlistBuddy -c 'Print :ProgramArguments:0' "$plist")" = /bin/bash ] || fail 'executing binary'
[ -x "$HOME/.local/bin/unquarantine" ] || fail 'installed worker not executable'
"$HOME/.local/bin/unquarantine" --status | grep 'Matching quarantined files' || fail 'symlink config lookup'
/bin/bash "$installer" install
[ "$(grep -c '^bootout ' "$LAUNCH_TEST_DIR/calls")" = 1 ] || fail 'reinstall did not bootout'
EXTENSIONS='' /bin/bash "$installer" install
[ "$(/usr/libexec/PlistBuddy -c 'Print :EnvironmentVariables:EXTENSIONS' "$plist")" = '' ] || fail 'empty install override not preserved'
/bin/bash "$installer" uninstall
/bin/bash "$installer" uninstall
[ ! -e "$plist" ] && [ ! -L "$HOME/.local/bin/unquarantine" ] || fail 'uninstall leftovers'
[ -f "$config" ] && [ -f "$HOME/.local/state/unquarantine.log" ] || fail 'uninstall removed config/logs'
printf 'not owned\n' > "$HOME/.local/bin/unquarantine"
expect_code 1 /bin/bash "$installer" install
[ "$(cat "$HOME/.local/bin/unquarantine")" = 'not owned' ] || fail 'unowned binary overwritten'
rm "$HOME/.local/bin/unquarantine"
printf 'not owned\n' > "$plist"
expect_code 1 /bin/bash "$installer" uninstall
[ "$(cat "$plist")" = 'not owned' ] || fail 'unowned plist removed'
printf 'PASS: unquarantine real xattr and isolated launchd-install contracts\n'
