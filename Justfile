set shell := ["bash", "-euo", "pipefail", "-c"]

setup:
    node scripts/check-runtime.mjs
    npm ci
    git config core.hooksPath .githooks

lint:
    npm run lint

typecheck:
    npm run typecheck

quality:
    npm run quality

test *args:
    npm run test -- {{args}}

build:
    npm run build

check:
    npm run check

qa-desktop:
    node scripts/qa-desktop.mjs

evaluate-routing:
    node scripts/evaluate-routing.mjs
