#!/usr/bin/env bash
# Publishes NetraScope.Core for an IIS deployment.
#
# Usage:
#   ./backend/deploy/publish.sh [-o OUT_DIR] [-r RUNTIME] [-s]
#
# Options:
#   -o OUT_DIR   Output directory (default: publish)
#   -r RUNTIME   Target runtime, e.g. win-x64 (default) or win-arm64
#   -s           Self-contained (bundle the .NET runtime)
#   -h           Show this help
#
# Run from anywhere; paths are resolved relative to the repo root.

set -euo pipefail

out_dir="publish"
runtime="win-x64"
self_contained="false"

usage() {
    sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'
    exit "${1:-0}"
}

while getopts ":o:r:sh" opt; do
    case "$opt" in
        o) out_dir="$OPTARG" ;;
        r) runtime="$OPTARG" ;;
        s) self_contained="true" ;;
        h) usage 0 ;;
        :) echo "Error: -$OPTARG requires an argument" >&2; usage 1 ;;
        \?) echo "Error: unknown option -$OPTARG" >&2; usage 1 ;;
    esac
done

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root_dir="$(cd "$script_dir/../.." && pwd)"
cd "$root_dir"

project="backend/src/NetraScope.Core/NetraScope.Core.csproj"

echo "==> Publishing $project ($runtime, SelfContained=$self_contained) to $out_dir"

dotnet publish "$project" \
    -c Release \
    -o "$out_dir" \
    -r "$runtime" \
    --self-contained "$self_contained"

echo "==> Copying web.config"
cp -f "backend/deploy/web.config" "$out_dir/web.config"

echo "==> Done. Copy the contents of '$out_dir' to the IIS site's physical path."
echo "    Edit web.config's <environmentVariables> with your production"
echo "    database connection string and JWT secret before starting the site."
