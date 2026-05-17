# Contributing

## Quick Start
```bash
git clone https://github.com/your/repo.git
cd bridge
cp .env.example .env   # Configure LLM API keys
npm install
npm start              # Opens CLI mode
```

## Directory Structure
```
bridge/src/            # Backend (Node.js 24, ESM)
  api/                 # Express REST API
  core/                # Agent engine, residents, learning
  providers/           # 42 LLM provider adapters
  p2p/                 # Hyperswarm DHT + messaging
  monitoring/          # Health check
openchat-flutter/      # Mobile client (Dart/Flutter)
modules/               # Published npm packages
```

## Workflow
1. Fork + branch (`feat/`, `fix/`, `chore/`)
2. Write code + tests
3. `npm test` passes
4. PR to master
5. Squash merge

## Commit Format
```
type: short description

type: feat / fix / refactor / chore / test / docs
```
