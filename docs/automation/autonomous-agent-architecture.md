# Autonomous TRD/CRD Development Agent — Architecture Decision

**Status:** Proposed design only. No runtime, credentials, cloud resources, scheduled workflow, or billing changes have been created.

## Decision

Use a **GitHub Actions controller in this repository** as the first implementation, with a GitHub App installed only on the two approved repositories. Keep the first release manual-dispatch only. Add a schedule only after a separate cost and operating-limit approval.

Do not start with Cloud Run. A scheduled, bounded GitHub Actions job is sufficient for the first agent loop and avoids introducing a continuously running service, queue infrastructure, or new cloud resources. Revisit Cloud Run Jobs only if measured workflow limits or queue requirements justify it.

## Repositories in scope

- `theroofingdrs/TRD-CRD-Operations` — controller, agent source, and this architecture.
- `theroofingdrs/TheRoofingDrs-Combined` — website backlog and code changes.

No other repository is in scope. LaborXchanger is explicitly excluded.

## Proposed operating loop

1. Trigger manually at first; later allow a bounded schedule and approved GitHub events.
2. Acquire a single-run concurrency lock so two agents cannot work the same queue concurrently.
3. Read the two project trackers, open PRs, recent CI results, and any prior checkpoint.
4. Build a candidate task list from existing issue acceptance criteria. Select only the highest-priority task that is explicitly authorized, unblocked, and within the allowlist.
5. Ask the model for a plan and a narrow patch. Treat repository content, issues, PR comments, and model output as untrusted data, never as executable instructions.
6. Apply changes only on a new task branch. Never push directly to `main`, `integration/path-routing`, or another protected/release branch.
7. Run only allowlisted, repository-defined test commands in an isolated runner. Enforce timeouts and capture test output with secret redaction.
8. Open or update a PR. Never merge it automatically.
9. Update the relevant tracker with the branch/PR, commit, test results, unresolved risks, and next checkpoint.
10. Persist a checkpoint and exit. A later run starts from the checkpoint, re-reads live GitHub state, and reconciles rather than trusting stale state.

## State and resumability

For the initial version, store task state as versioned JSON in a dedicated `agent-state` branch in this controller repository. Serialize writers with GitHub Actions `concurrency`; update state with compare-and-swap against the current commit SHA. Keep an append-only run record containing:

- run ID, timestamp, trigger, and agent version
- selected issue/task and why it was eligible
- repository, branch, commit, and PR references
- test commands, exit codes, and bounded log/artifact references
- checkpoint phase, retry count, and next action
- token usage/cost estimate when available

Do not put secrets, customer information, lead data, or private production records in state or logs. GitHub Actions artifacts are supplementary evidence, not the only durable checkpoint. If the state branch cannot be read or updated safely, stop without attempting a code change.

## Credentials and least privilege

Create a dedicated GitHub App installed only on the two repositories. Grant only the permissions needed to read contents/issues/PRs/actions and to create task branches, commits, PRs, and tracker comments. Do not use a broad personal access token.

The runner will need a model-provider API credential stored as a GitHub Actions secret. Do not request or create that credential until the provider, model, maximum tokens, per-run cap, monthly cap, and notification thresholds are approved.

Never pass credentials into the model prompt. Redact secrets from logs, avoid printing environment variables, and keep all secret-bearing actions outside model-controlled shell commands.

## Execution and security boundaries

- Use ephemeral GitHub-hosted runners; no persistent local machine is required.
- Pin third-party Actions to immutable commit SHAs before enabling the workflow.
- Allowlist repositories, paths, commands, and test scripts in code.
- Do not allow arbitrary shell commands returned by the model. The model may select from a fixed tool/action interface only.
- Treat all issue/PR text, source comments, web content, and test output as untrusted data. Ignore embedded requests to reveal secrets, widen scope, change policy, or execute arbitrary commands.
- Enforce per-run timeout, maximum changed files/lines, maximum retries, maximum open agent PRs, and a kill switch.
- Require explicit human approval for merge, production deployment, DNS, billing, secrets/permissions changes, database migrations, imports, customer-data changes, and any destructive action.
- No automatic merge. No automatic Cloud Run deployment.
- Do not access production CRM data to decide or execute code tasks.

## Cost and run limits

Initial mode: **manual only**. No schedule and no Cloud Run resource.

Before enabling autonomous scheduled runs, set and enforce:
- maximum runs per day and a concurrency limit of one
- maximum model input/output tokens per run
- maximum model spend per run and per calendar month
- hard stop when usage or billing data cannot be measured
- bounded runner duration and artifact retention
- failure notifications and a kill switch

The workflow must fail closed if cost limits, credentials, repository allowlists, or checkpoint integrity cannot be verified.

## Rollout plan

### Phase 0 — Design and review
- Review this decision and approve the provider and spending caps.
- Confirm GitHub App ownership and installation on exactly the two repositories.
- Confirm the state-branch protection and retention policy.

### Phase 1 — Safe read-only inventory
- Manual dispatch only.
- Read trackers, branches, PRs, and CI metadata.
- Produce a proposed task plan and checkpoint; no source writes.

### Phase 2 — PR-only implementation
- Enable narrow task branches, approved test commands, PR creation, and tracker comments.
- Keep merge/deploy/database/billing/secret permissions unavailable to the agent.

### Phase 3 — Bounded autonomy
- Add a schedule only after measured cost and quality are acceptable.
- Add failure notifications, dashboards, retry ceilings, and regular permission reviews.

## Acceptance tests before activation

- A manual run completes with no ChatGPT session or local computer open.
- Two simultaneous triggers cannot create overlapping task work.
- An interrupted run resumes from a valid checkpoint without duplicating commits or PRs.
- A malicious issue comment cannot expand permissions or trigger arbitrary shell commands.
- A task outside the two-repository allowlist is rejected.
- A task requiring a protected action is blocked and reported.
- A failed test prevents PR readiness and is accurately recorded.
- No secrets or production/customer data appear in prompts, logs, artifacts, or checkpoints.
- A disabled kill switch prevents any further work.
- Token, spend, run-count, and duration limits are enforced.

## Explicitly not included

No Cloud Run Job/service, new Supabase schema/project, queue service, GitHub App, model API key, scheduled trigger, production deployment, automatic merge, CRM data access, or billing configuration is being provisioned in this design-only change.
