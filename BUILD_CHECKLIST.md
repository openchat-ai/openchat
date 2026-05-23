# Build Checklist

## Before triggering any APK build, ALL must pass:

### 1. Bridge tests
cd bridge && npm test

### 2. Qiniu connectivity + token generation
node tests/preflight.mjs

### 3. ESLint clean
cd bridge && npx eslint src/ --quiet

### 4. Verify upload token algorithm (if token code changed)
node tests/verify-final.js

### 5. Check endpoint connectivity (if endpoint changed)
node tests/endpoint-test.js

## Failure = don't build
If any check fails, fix the issue first.
