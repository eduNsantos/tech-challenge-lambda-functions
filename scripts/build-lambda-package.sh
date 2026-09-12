#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="$ROOT_DIR/src"
BUILD_DIR="$ROOT_DIR/build"
ZIP_PATH="$BUILD_DIR/auth-lambda.zip"

mkdir -p "$BUILD_DIR"

cd "$SRC_DIR"
npm ci --no-fund --no-audit

rm -f "$ZIP_PATH"
python3 - "$SRC_DIR" "$ZIP_PATH" <<'PY'
import os
import sys
import zipfile

src_dir, zip_path = sys.argv[1], sys.argv[2]

with zipfile.ZipFile(zip_path, mode='w', compression=zipfile.ZIP_DEFLATED) as zf:
    for root, dirs, files in os.walk(src_dir):
        dirs[:] = [d for d in dirs if d != 'test']
        for file_name in files:
            full_path = os.path.join(root, file_name)
            arcname = os.path.relpath(full_path, src_dir)
            zf.write(full_path, arcname)
PY
