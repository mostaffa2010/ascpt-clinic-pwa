# Workflow & Verification Rules

## 1. Branch-Per-Feature Workflow
- **No Direct Commits to `main`:** Committing directly to `main` is strictly forbidden under all circumstances.
- **Isolated Feature Branches:** Every task must begin with a dedicated branch cut from the latest `main` with a clear, descriptive name.
- **Immediate Remote Tracking:** Immediately push newly created branches to remote (`git push -u origin <branch-name>`) so live previews can be tested on Vercel Preview.
- **Single Permanent Branch:** `main` is the only persistent branch. Any leftover local or remote branches must be deleted upon task completion and merge.
- **No Auto-Merge:** Automatic merges are prohibited under all circumstances.

## 2. Mandatory Verification with `npm test`
- **100% Pass Rate Required:** Before completing any task or seeking approval, run the full test suite (`npm test`) to verify that 100% of test suites, assertions, and guardrails pass without regressions.
- **Zero Code Breakage:** Any failure or regression must be resolved before proceeding.

## 3. Mandatory Inspection of `git diff`
- Review `git diff` thoroughly prior to staging and committing.
- Ensure only intended, scoped changes are included, with zero accidental edits, stray debug logs (`console.log`), or unrelated modifications.

## 4. Stopping for User Approval Before PR
- **Stop Gate:** Always push changes to the remote feature branch, stop, and report testing results to the user.
- **Explicit Approval Required:** Never open a Pull Request or merge code without explicit confirmation and approval from the user after testing the live preview on Vercel.
