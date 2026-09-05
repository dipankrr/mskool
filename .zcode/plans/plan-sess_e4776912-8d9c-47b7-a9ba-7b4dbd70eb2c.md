Strip the two vendored ui-ux-pro-max skill directories from feature/fees-ui only (phase4-fees and main untouched). Keep skills-lock.json and redesign-fees-UI-prompt.md.

Execution: one session, no mid-flow permission stops. Reporting points: (a) after strip + verification — show commit list and diff-stat evidence vs the backup branch; (b) final gate report. Halt conditions: any gate fails (report as-is, no silent fixes) or rewrite verification looks wrong (restore backup, report).

1. Backup: git branch backup/fees-ui-pre-strip (no commit).
2. Rewrite feature/phase4-fees..feature/fees-ui path-filtering out .agents/skills/ui-ux-pro-max/ and .zcode/skills/ui-ux-pro-max/ — branch stays at 14 commits, same messages, hashes change from 01934b6 onward. No commits added or removed. Skill folders vanish from disk (recoverable from backup); history change is verifiable via git diff backup/fees-ui-pre-strip feature/fees-ui --stat (298 deletions, nothing else).
3. Prepare .gitignore change (add .agents/skills/ and .zcode/skills/) — left uncommitted for the user, ready-to-paste commit message (chore: gitignore agent skill directories). Shows as a normal IDE diff.
4. Verify: diff vs phase4-fees shows only apps/web + docs/spec files; spot-check commits; no ui-ux-pro-max paths remain in the range.
5. Fresh gates: on phase4-fees — check-types, test, test:integration, db:verify, check:openapi, check:builders; on rewritten fees-ui — same plus lint, reset:demo→seed→smoke:authz, test:e2e. Report results as-is.
6. Prepare review briefing at .kilo/plans/fees-review-briefing.md and docs/TASKS.md refresh — left uncommitted for the user with ready-to-paste messages.
7. Merge/rebase into main is NOT mine — owner reviews via the briefing, then runs the provided merge-day command sequence.

Reversibility: git branch -f feature/fees-ui backup/fees-ui-pre-strip restores everything instantly. I never commit or push.