#!/usr/bin/env bash
set -euo pipefail

source_dir=/var/lib/cox-publisher/state.json.history
target_dir=/opt/eox/state/cox-publication-archive

install -d -o eox -g eox -m 0750 "$target_dir"
[ -d "$source_dir" ] || exit 0

for record in "$source_dir"/[0-9]*.json; do
  [ -e "$record" ] || continue
  name=$(basename "$record")
  [[ "$name" =~ ^[0-9]+\.json$ ]] || continue
  [ -e "$target_dir/$name" ] && continue
  temporary="$target_dir/.$name.tmp"
  install -o eox -g eox -m 0640 "$record" "$temporary"
  mv -n "$temporary" "$target_dir/$name"
  rm -f "$temporary"
done
