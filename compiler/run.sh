#!/bin/bash
SOURCE="${BASH_SOURCE[0]}"
while [ -h "$SOURCE" ]; do # resolve $SOURCE until the file is no longer a symlink
  DIR="$( cd -P "$( dirname "$SOURCE" )" >/dev/null 2>&1 && pwd )"
  SOURCE="$(readlink "$SOURCE")"
  [[ $SOURCE != /* ]] && SOURCE="$DIR/$SOURCE" # if $SOURCE was a relative symlink, we need to resolve it relative to the path where the symlink file was located
done
compiler_path="$( cd -P "$( dirname "$SOURCE" )" >/dev/null 2>&1 && pwd )"

deno run --allow-read --allow-write --allow-net --allow-env --allow-run --unstable "$compiler_path/index.ts" "$@"