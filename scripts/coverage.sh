#!/bin/bash

rm -rf coverage

# generate raw data
DEV_MODE=true deno test --coverage=coverage --unstable --allow-all

# generate .lcov file
deno coverage coverage --lcov > coverage/cov.xml

# visual summary
deno coverage coverage | grep "%" > ./coverage/summary.txt
deno run --allow-all --unstable ./scripts/total_coverage.ts