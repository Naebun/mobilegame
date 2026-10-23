#!/usr/bin/env bash
# Installs Blender as a Python module (bpy) into a venv. The container is ephemeral, so rerun this in a new session.
# Takes about two minutes and roughly 1 GB. Usage: scripts/setup-blender.sh [venv-dir]
set -euo pipefail
VENV="${1:-$HOME/.venvs/blender}"
python3 -m venv "$VENV"
"$VENV/bin/pip" install --quiet bpy
"$VENV/bin/python" "$(dirname "$0")/blender-check.py"
