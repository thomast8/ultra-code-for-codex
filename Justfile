set shell := ["bash", "-euo", "pipefail", "-c"]

setup:
    node scripts/check-runtime.mjs

quality:
    node --check src/retry-policy.mjs
    node --check test/retry-policy.test.mjs
    node --check scripts/check-runtime.mjs

test:
    node --test test/retry-policy.test.mjs

check: setup quality
    node --test --experimental-test-coverage '--test-coverage-include=src/**/*.mjs' --test-coverage-lines=100 --test-coverage-functions=100 --test-coverage-branches=100 test/retry-policy.test.mjs
