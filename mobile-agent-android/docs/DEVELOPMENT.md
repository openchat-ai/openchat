# Development Guide

## Branch
- Working branch: `mobile/android-agent-app`

## Scope rules
- Allowed: `mobile-agent-android/**`
- Forbidden: modifications outside the workspace unless explicitly approved

## Milestones
- P0-1: workspace bootstrap ✅
- P0-2: Android project shell (Gradle + manifest + resources + wrapper) ✅
- P0-3: core stubs (AgentLoop / EditGate / ModelRouter / GitHubClient / Tool) ✅
- P0-4: GitHub flow integration (wire GitHubClient to UI)
- P0-5: CI workflow ✅ (`.github/workflows/android-agent.yml`)
