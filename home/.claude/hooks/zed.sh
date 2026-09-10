#!/usr/bin/env bash
# UserPromptExpansion runs in Claude's current directory. Always block the
# expansion (exit 2), including launch failures, so no model turn follows.
trap 'exit 2' EXIT

case "$(uname -s)" in
  Darwin) open -a Zed "$PWD" >&2 ;;
  Linux) zeditor "$PWD" >&2 ;;
  *) printf '%s\n' '/zed supports macOS and Linux only.' >&2; exit 2 ;;
esac
status=$?

if [ "$status" -eq 0 ]; then
  printf 'Opened %s in Zed.\n' "$PWD" >&2
else
  printf 'Could not open Zed (exit %s).\n' "$status" >&2
fi
