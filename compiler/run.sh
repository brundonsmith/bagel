#!/bin/bash
compiler_path=$( cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" ; pwd -P )
deno run --allow-read --allow-write --allow-net --allow-env --allow-run --unstable "$compiler_path/index.ts" "$@"