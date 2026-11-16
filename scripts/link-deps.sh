#!/usr/bin/env bash
# Symlink the plugin's only runtime dep (@deepseek-ai/dsh-tools) from a dsh
# runtime store, and link the plugin itself into a Web profile so the Cordis
# loader entry name resolves from the profile root.
#
# usage: scripts/link-deps.sh [DSH_RUNTIME_STORE] [PROFILE_DIR]
set -euo pipefail

STORE="${1:-/home/ubuntu/.local/share/dsh-runtime/node_modules/.pnpm}"
PROFILE="${2:-$HOME/.dsh/profiles/web}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"

TOOLS_SRC="$(ls -d "$STORE"/@deepseek-ai+dsh-tools@*/node_modules/@deepseek-ai/dsh-tools 2>/dev/null | head -1)"
if [[ -z "$TOOLS_SRC" ]]; then
	echo "error: @deepseek-ai/dsh-tools not found under $STORE" >&2
	exit 1
fi

mkdir -p "$HERE/node_modules/@deepseek-ai"
ln -sfn "$TOOLS_SRC" "$HERE/node_modules/@deepseek-ai/dsh-tools"
echo "linked dep: $HERE/node_modules/@deepseek-ai/dsh-tools -> $TOOLS_SRC"

mkdir -p "$PROFILE/node_modules"
ln -sfn "$HERE" "$PROFILE/node_modules/dsh-media-player"
echo "linked plugin: $PROFILE/node_modules/dsh-media-player -> $HERE"
echo
echo "next: add to $PROFILE/cordis.patch.yml:"
echo "  - insert:"
echo "      - id: dsh-media-player"
echo "        name: dsh-media-player"
echo "then restart 'dsh web' and refresh the GUI."
