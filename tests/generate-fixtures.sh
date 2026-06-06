#!/usr/bin/env bash
# generate-fixtures.sh: Generate git history log fixtures from the bun repository

set -euo pipefail

# Ensure we are in the tests directory
CDPATH= cd "$(dirname "$0")"

echo "Generating git history log fixtures..."

FILES=(
  "package.json"
  "bun.lock"
  "bun.lockb"
  "Cargo.toml"
  "Cargo.lock"
)

for file in "${FILES[@]}"; do
  echo "Generating fixtures/${file}.log..."
  if [ "$file" = "bun.lockb" ]; then
    git -C bun log --reverse --patch --binary -- "$file" > "fixtures/${file}.log"
  else
    git -C bun log --reverse --patch -- "$file" > "fixtures/${file}.log"
  fi
done

echo "Done generating fixtures!"
