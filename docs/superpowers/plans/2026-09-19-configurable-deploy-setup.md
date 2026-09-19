# Configurable Deploy Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collect and validate user-specific Synology deployment values, verify the deployment account before setup, and present resolved values without exposing credentials.

**Architecture:** Keep `deploy.config.json` as the local source of truth. Add small pure helpers for validation and display so `init`, `prepare`, `key`, `nas`, and `secrets` use the same resolved settings. `.env` remains runtime configuration and never stores a DSM password or SSH private key.

**Tech Stack:** Node.js 20+, `node:test`, GitHub CLI, SSH, Synology DSM.

**Spec:** `docs/superpowers/specs/2026-09-19-configured-deployment-input-design.md`

## Global Constraints

- A new configuration must not default to `/volume1/docker`, a NAS host, or a DSM account.
- Existing configuration remains compatible and is preserved on re-run.
- Existing deployment accounts and unrelated SSH keys are never changed or deleted.
- Missing deployment accounts require DSM creation and a successful recheck before key or NAS installation.
- Console previews show local file paths, never private-key or password contents.

## Review Focus

- Empty or example-only NAS values must fail before files are generated.
- Reverse proxy and internal-only examples must distinguish NAS Docker and container ports.
- A LAN user must be directed to a NAS internal IP rather than `127.0.0.1`.
- A missing account must not advance to `key` or `nas` after the user says it was created.
- Secret previews must not leak SSH material.

---

### Task 1: Add configuration validation and generic route presentation

**Files:**

- Modify: `synology-github-actions-docker-deploy/cli/lib/init.mjs`
- Modify: `synology-github-actions-docker-deploy/cli/lib/init.test.mjs`

**Interfaces:**

- Export `routeExamples()`, `validateDeploymentConfig(config)`, and `configurationSummary(config)` from `init.mjs`.
- `routeExamples()` returns generic Korean copy for reverse-proxy and internal-only modes.
- `validateDeploymentConfig()` throws for empty or placeholder host, administrator, deploy user, NAS directory, and key path.

- [ ] Write failing `init.test.mjs` cases that prove: a new `withDefaults({ project: 'demo', owner: 'owner' })` has `nas.dir === ''`; generic route text contains `나의 도메인:포트번호` and `NAS 내부 IP`; placeholder values cause `validateDeploymentConfig()` to throw; `configurationSummary()` includes the resolved key path and configured NAS directory.
- [ ] Run `node --test synology-github-actions-docker-deploy/cli/lib/init.test.mjs` and confirm the new assertions fail.
- [ ] Implement the three helpers. Change the new-config NAS directory default to `''`, preserve a previous directory, show `/volume2/apps/나의프로젝트` only as prompt help, and call validation before generated files are written.
- [ ] Replace the route text and final `init` summary with helper output.
- [ ] Re-run the focused test and commit: `feat: clarify configurable NAS deployment inputs`.

### Task 2: Require deployment-account existence and post-creation recheck

**Files:**

- Modify: `synology-github-actions-docker-deploy/cli/lib/prepare.mjs`
- Create: `synology-github-actions-docker-deploy/cli/lib/prepare.test.mjs`

**Interfaces:**

- Export a pure `deploymentAccountState(values)` mapper that returns `ready`, `missing`, or `incomplete`.
- Export `deploymentAccountGuide(config)` for the DSM path and exact selected account name.
- `prepareCommand()` uses the same remote probe after a user confirms DSM account creation.

- [ ] Write failing tests for `deploymentAccountState()` covering an existing ready account, a missing account, and an existing account missing `administrators` membership.
- [ ] Run `node --test synology-github-actions-docker-deploy/cli/lib/prepare.test.mjs` and confirm failure because the exports do not exist.
- [ ] Implement the mapper and guide. When `USER=missing`, show DSM Control Panel → User & Group creation guidance, ask the user to confirm completion, and re-run the exact remote probe. If the recheck is not `ready`, return without displaying later steps.
- [ ] When the account is ready, ask explicitly whether to use it. A negative response returns with an instruction to rerun `init` with another account name.
- [ ] Run the focused test and commit: `feat: verify deployment account before setup`.

### Task 3: Show resolved values in key, NAS, and Secrets screens

**Files:**

- Modify: `synology-github-actions-docker-deploy/cli/lib/key.mjs`
- Modify: `synology-github-actions-docker-deploy/cli/lib/nas.mjs`
- Modify: `synology-github-actions-docker-deploy/cli/lib/secrets.mjs`
- Modify: `synology-github-actions-docker-deploy/cli/lib/secrets.test.mjs`
- Create: `synology-github-actions-docker-deploy/cli/lib/presentation.test.mjs`

**Interfaces:**

- Export `keySummary(config)`, `nasInstallSummary(config)`, and `secretPreview(config)`.
- `secretPreview()` returns host, port, user, private-key path, and known-hosts path; GitHub registration still reads actual private-key and known-hosts file contents separately.

- [ ] Write failing presentation tests with `/volume2/apps/demo`, `nas.example.test:2233`, and `~/.ssh/demo_deploy`; assert key/NAS summaries contain these values and preview entries contain only identifiers and local paths.
- [ ] Run `node --test synology-github-actions-docker-deploy/cli/lib/presentation.test.mjs` and confirm failure because helpers do not exist.
- [ ] Implement helpers and use them only for `panel()`/`detail()` text. Do not change Secret names or registration values.
- [ ] Run focused presentation, Secrets, and NAS tests; commit: `feat: show resolved deployment settings`.

### Task 4: Align documentation, install, and publish

**Files:**

- Modify: `README.md`
- Modify: `synology-github-actions-docker-deploy/SKILL.md`
- Create: `synology-github-actions-docker-deploy/cli/lib/docs.test.mjs`

- [ ] Write a failing docs test that requires both documents to mention `나의 도메인:포트번호`, `NAS 내부 IP`, user-provided NAS deployment directory, deployment-account recheck, and the boundary that `.env` excludes DSM passwords and private keys.
- [ ] Run `node --test synology-github-actions-docker-deploy/cli/lib/docs.test.mjs` and confirm failure.
- [ ] Update the documents with the generic route examples, account flow, dynamic installation summary, Secrets source values, and credential boundary.
- [ ] Run `node --test synology-github-actions-docker-deploy/cli/*.test.mjs synology-github-actions-docker-deploy/cli/lib/*.test.mjs`; require zero failures.
- [ ] Run `npm install -g .`, verify `nas-deploy` resolves to the npm shim, commit remaining documentation/tests, then `git push origin main`.
