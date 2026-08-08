# E2E Resume Checklist

> Expected log greps for manual or instrumentation verification.

## Test 1: Cold resume (Idle → process death → relaunch → Resume)

**Setup:** Agent in Idle state with `needsResume=true` (e.g. after AgentFailed).

**Steps:**
1. Kill app process
2. Relaunch
3. "Resume" button visible
4. Tap Resume

**Expected logs:**
```
[C1.resume] resumed from ...
[C3] awaiting human approval
```
**Not seen:**
```
[C1] agent loop started
```

---

## Test 2: AwaitingApproval resume

**Setup:** Agent at approval gate, process dies.

**Steps:**
1. Kill app process at approval
2. Relaunch
3. "Resume" button visible
4. Tap Resume

**Expected logs:**
```
[C1.resume] resumed from preview-draft (or publish-draft)
[C3] awaiting human approval
```
**Not seen:**
```
[C1] agent loop started
[C1.1] seeded * execution steps
```

---

## Test 3: Publish failure is retryable

**Setup:** Publish stage fails (e.g. 422/conflict, net error).

**Steps:**
1. Agent publishes
2. Publish throws

**Expected logs:**
```
[E3] publish failed: ...
```
Dispatch `AgentLifecycleEvent.Failed` with:
- `retryable = true`
- `taskPackage` = non-null
- `checkpointId` = non-null

UI state: `recovery.needsResume=true`, `recovery.pendingTaskPackage` set,
Resume button visible.

---

## Test 4: Second resume finishes publish

**Setup:** After Test 3, resume.

**Steps:**
1. Tap Resume
2. Agent resumes from saved checkpoint
3. Second publish attempt succeeds

**Expected logs:**
```
[C1.resume] resumed from publish-draft
[C3] awaiting human approval
[C5] approved, executing
[C5.3] publish succeeded
```

---

## Test 5: Stop → no resume leak

**Setup:** Active agent, tap Stop.

**Steps:**
1. Tap Stop
2. Observe

**Expected logs:**
```
[C4] cancelled by stop
```
UI state: `recovery.needsResume=false`.
Resume button hidden.

---

## Test 6: Completed clears recovery

**Setup:** Agent finishes normally.

**Steps:**
1. All tasks approved
2. Summarize runs

**Expected logs:**
```
[C7] plan complete
```
UI state: `recovery.needsResume=false`, `recovery.pendingTaskPackage=null`.
Resume button hidden.
