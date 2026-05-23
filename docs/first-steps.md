# First Steps

## 1. Start Bridge

```bash
cd bridge
cp .env.example .env
# Set at least one LLM API key (e.g. SILICONFLOW_API_KEY=sk-xxx)
npm install
npm start
# → http://localhost:3800
```

## 2. Verify

```bash
curl http://localhost:3800/health
curl http://localhost:3800/api-docs
```

## 3. Run Tests

```bash
npm test          # 120+ tests
npm run test:all  # includes contract tests (needs running Bridge)
```

## 4. (Optional) Flutter Client

```bash
cd openchat-flutter
flutter pub get
flutter run
# App connects to localhost:3800 by default
```

## Project Map

| Directory | Purpose |
|-----------|---------|
| `bridge/` | Backend server (Node 24 ESM) |
| `openchat-flutter/` | Mobile client (Flutter 3.11+) |
| `modules/provider-kit/` | LLM provider unified API |
| `modules/fairy-guardian/` | Self-healing process cluster |

## Good First Issues

Start with:
- Add a test to an uncovered module
- Fix a `TODO` in the code
- Update documentation to match current behavior

See [CONTRIBUTING.md](CONTRIBUTING.md) for details.
