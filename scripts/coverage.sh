#!/bin/bash
deno test --coverage=coverage --unstable --allow-all
deno coverage coverage | grep "%" > ./coverage/summary.txt
deno run --allow-all --unstable ./scripts/total_coverage.ts