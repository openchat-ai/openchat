# OpenChat Test Framework - Quick Reference

> **最后更新**: 2026-04-29

## 7 Test Types at a Glance

```
┌─────────────────────────────────────────────────────────────────┐
│                    OPENCHAT TEST FRAMEWORK                       │
└─────────────────────────────────────────────────────────────────┘

┌─────────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────────┐
│  QUALITY    │  │  ADVERSARIAL │  │ MULTI-MODEL  │  │ EXPERIENCE │
│   CHECK     │  │   TESTING    │  │  CONSENSUS   │  │ACCUMULTION │
│   5 cats    │  │   3 vectors  │  │   6+ models  │  │ 3 patterns │
│   80/100    │  │  HIGH/MED/LO │  │   70% pass   │  │ 3 occ req  │
│   2 retries │  │  zero viol   │  │   7 models   │  │ Learning   │
└─────────────┘  └──────────────┘  └──────────────┘  └────────────┘

┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────────┐
│  STRATEGY    │  │  KNOWLEDGE   │  │ ORCHESTRATION│  │ CONSENSUS  │
│ OPTIMIZATION │  │   NETWORK    │  │   PIPELINE   │  │ AGGREGATION│
│ 5 algorithms │  │  4 dimensions│  │   6 steps    │  │  4 modes   │
│  Reward sys  │  │  0.7 score   │  │  Auto retry  │  │  Weighted  │
│ Performance  │  │   Validated  │  │  Rollback    │  │   Voting   │
└──────────────┘  └──────────────┘  └──────────────┘  └────────────┘
```

---

## Core Numbers

| Metric | Value |
|--------|-------|
| Quality Pass Threshold | 80/100 |
| Security Weight | 30% |
| Multi-Model Consensus | ≥70% |
| Adversarial Pass Rate | ≥90% |
| Pattern Threshold | 3 occurrences |
| Max Retries | 2 attempts |
| Test Coverage | 90%+ |
| Code Line Limit | 500 lines |
| Temporal Relevance | 1 year decay |
| Overall QA | 90%+ |

---

## Quality Check Weights

```
┌────────────────────────────────────────────┐
│ Security (30%)    [████████████████████████░░░░░░░░]
│ Response (20%)    [████████████░░░░░░░░░░░░░░░░░░░░]
│ Code (20%)        [████████████░░░░░░░░░░░░░░░░░░░░]
│ Format (15%)      [█████████░░░░░░░░░░░░░░░░░░░░░░░]
│ Completeness (15%)[█████████░░░░░░░░░░░░░░░░░░░░░░░]
│ TOTAL: 100/100    [████████████████████████████████]
└────────────────────────────────────────────┘
```

---

## Adversarial Vectors

```
Logic Poisoning  ➜ HIGH severity    ➜ 0 violations = PASS
                   Detects: eval, exit, loops
                   
Prompt Injection ➜ MEDIUM severity  ➜ 0 violations = PASS
                   Detects: SQL, XSS, templates
                   
Boundary Attack  ➜ LOW severity     ➜ 2+ defenses = PASS
                   Detects: insufficient protection
```

---

## Multi-Model Consensus

```
Claude 3.5 ─┐
GPT-4 ──────├─➜ SUCCESS COUNT / 6 = %
Gemini ─────┤
GLM-4 ──────├─➜ % >= 70% = ✅ VALID
ERNIE ──────┤
Llama2 ─────┘
```

---

## Test Orchestration Pipeline

```
INPUT: Code Changes
  │
  ├─ Step 1: Auto Commit ✓
  │
  ├─ Step 2: Sandbox Test ✓
  │
  ├─ Step 3: Multi-Model Test ✓
  │   └─ Consensus >= 70%?
  │      ├─ YES ✓
  │      └─ NO ✗
  │
  ├─ Step 4: Adversarial Test ✓
  │   └─ All pass?
  │      ├─ YES ✓
  │      └─ NO ✗
  │
  ├─ Step 5: Auto Restart ✓
  │   └─ Deployment success?
  │      ├─ YES ➜ OUTPUT: ✅ PROD
  │      └─ NO ✗
  │
  └─ Step 6: Auto Rollback (on failure)
     └─ OUTPUT: ⚠️  ROLLED BACK
```

---

## Experience Accumulation

```
Task ➜ Execute
  │
  ├─ Success Pattern (3+ occ) ➜ Best Practices
  ├─ Failure Pattern (3+ occ) ➜ Avoidance Guide
  └─ Improvement Pattern ➜ Optimization Tips
  
  Learning Rate: 0.1
  Max Experiences: 1000
  Forgetting Factor: 0.99
```

---

## Strategy Optimization Algorithms

```
E-Greedy (10% explore)    ➜ ±5% parameter adjustments
UCB                       ➜ Confidence-based selection
Thompson Sampling         ➜ Bayesian approach
Gradient Ascent           ➜ Reward-based updates
Evolutionary              ➜ Gene-based evolution

Reward Score: [-1.0, 2.0]
  Success: 1.0
  Efficiency: 0-1.0
  Resources: 0-0.2
```

---

## Knowledge Network Validation

```
Input Knowledge
  │
  ├─ Source Credibility (0-1.0)
  ├─ Cross-Reference (0-1.0)
  ├─ Logical Consistency (0-1.0)
  └─ Temporal Relevance (0-1.0)
  │
  └─ Average = Final Score
     │
     ├─ > 0.7 ➜ ✅ VERIFIED
     └─ ≤ 0.7 ➜ ⚠️  QUESTIONABLE
```

---

## File Locations

```
bridge/src/core/
├── quality-check-system.js
├── adversarial-test.js
├── multi-model-tester.js
├── experience-accumulator.js
├── strategy-optimizer.js
├── knowledge-network.js
├── result-aggregator.js
├── test-orchestrator.js
├── __tests__/
│   ├── advanced-integration.test.js
│   ├── agent-session.test.js
│   ├── cli-integration.test.js
│   ├── evolution-integration.test.js
│   ├── evolution-system.test.js
│   └── phase34-integration.test.js
└── ... (supporting modules)
```

---

## Validation Enforcement

```
HARD (Auto-Reject):
├─ Response Quality: 80+
├─ Security: 8 items
├─ Consensus: ≥70%
├─ Adversarial: ≥90%
├─ Test Coverage: 90%+
├─ Dependencies: Whitelist
└─ Error Handling: try-catch

MEDIUM (Review):
├─ Instruction: >90%
├─ Hallucination: Flag
├─ Naming: Conform
├─ Versioning: Semantic
├─ Logging: JSON
└─ Metrics: 8 tracked
```

---

## Design Principles

1️⃣ **Post-Validation** - Check after generation  
2️⃣ **Multi-Strategy** - Multiple algorithms  
3️⃣ **Consensus** - Cross-validate  
4️⃣ **Experience-Driven** - Learn from history  
5️⃣ **Gradual Trust** - 3+ occurrences  
6️⃣ **Reputation-Based** - Credit performance  
7️⃣ **Graceful Failure** - Auto correct/rollback  
8️⃣ **Modular** - Independent, orchestrated  

---

**Status**: Complete Reverse Engineering ✅  
**Total Test Types**: 7+  
**Overall QA**: 90%+  
**Analysis Date**: 2026-04-23

