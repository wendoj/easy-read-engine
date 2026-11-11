# How Kiro was used

This write-up covers the spec, steering, hooks, MCP server, Power and custom agent in `.kiro/` and `power-easy-read/`. Every number has its source next to it: a file in this repository or a git commit. Commit counts are up to commit `f4c748f`, the last commit before this write-up.

## Spec

The spec in `.kiro/specs/easy-read/` came first. It was committed at 01:03 UTC on 11 November 2026 (`6759681`), before any code.

| Part | Size | Source |
| --- | --- | --- |
| Requirements | 9 requirements with 47 acceptance criteria, in EARS form | `requirements.md` |
| Correctness properties | 10 rules, P1 to P10. 8 are checked without a model | `requirements.md`, "Correctness Properties" |
| Design | 511 lines | `design.md` |
| Tasks | 36 implementation tasks, 35 done. Task 35 (re-run the fixtures on Bedrock) is open | `tasks.md` |
| Non-coding checklist | 10 items, 1 done (the 3 public sample letters) | `tasks.md`, "Non-coding checklist" |

Each task was built and committed on its own. 48 of the 66 commits name a spec task in the message body (`git log`).

The spec set the order of work. Key-fact extraction (task 4) and P1 (task 5) were built before any model call (task 7). So P1 has always compared the output with the Original, never with the model's own output.

## Steering

`.kiro/steering/` has 4 files. Kiro loads 3 of them in every session (`inclusion: always`) and `ui.md` only when a screen file is open (`fileMatch` on `web/app/**/*.tsx` and `web/components/**/*.tsx`).

| File | What it enforces |
| --- | --- |
| `easy-read-rules.md` | The P2 to P8 rules with good and bad examples, the tone rules and the no-advice table. Every prompt in `prompts/` follows it |
| `safety.md` | Never give advice. Always show the Original. Block on a P1 failure. Never store or log letter text. Only `bedrock:` and `groq:` model entries |
| `tech.md` | Stack, folder layout, commands, and who owns what: the web app makes every model call, the checker is model-free |
| `ui.md` | shadcn/ui components, plain copy, Original on the left, one colour per key fact |

The steering files changed when the project changed. For example, the move to Bedrock with Groq as the only fallback updated the steering in the same commit as the code (`f8d9d1c`). The P1, P3 and P4 fixes in `f4c748f` added the split-action and "You are entitled to" notes to `easy-read-rules.md`.

## Hooks

`.kiro/hooks/` has 4 hooks.

| Hook | Trigger | What it does | Added in |
| --- | --- | --- | --- |
| `commit-after-task.json` | After a spec task runs | Runs the tests, then commits the task's files by name, with the task status in the same commit | `1a34f15` |
| `checker-test-on-save.json` | Save in `checker/src/checks/` | Runs the matching `tests/test_<name>.py`, or the whole checker suite | `9d2da5c` (task 20) |
| `fixtures-on-prompt-save.json` | Save in `prompts/` | Runs the 5 fixture letters through the full pipeline and all 10 checks. Its description puts this at about 35,000 to 105,000 tokens a run | `9d2da5c` (task 20) |
| `check-property-tests.json` | After a spec task runs | Fails if any test was removed, skipped or xfailed, or lost its `@given` or `fc.assert` | `9d2da5c` (task 20) |

What the git history shows about them:

- **The commit hook was fixed once.** Its first version led to 7 commits that only marked a task done (`1de56c3` to `6eaebc5`, tasks 1 to 12). Commit `4e1f4dc` changed the hook to put the task status in the same commit as the code. No status-only commits came after it.
- **The property guard has its own tests.** Task 20 added `checker/scripts/check_property_tests.py` (280 lines) and `checker/tests/test_check_property_tests.py` (219 lines) (`git show --stat 9d2da5c`).
- **No commit records the save hooks or the property guard catching a problem.** We don't claim they did.

## Property tests

At `f4c748f` the checker tests have 36 `@given` property tests in 15 files, and the web tests have 28 `fc.assert` calls in 14 files (`git grep` on `checker/tests` and `web/tests`).

One property test found a real bug. Commit `1b93321` says: "Found by the task 5 P1 property during task 23". The sentence splitter could cut a phone number or an amount across 2 sentences. The fix keeps them inside one sentence.

## MCP server

`checker/src/mcp_server.py` (task 13, `a81f96d`) serves the checker over stdio with 3 tools: `extract_key_facts`, `check_easy_read` and `find_symbol`. They call the same functions as the HTTP routes, so Kiro can run the real checks on a prompt's example lines while it writes them.

`.kiro/settings/mcp.json` also lists 2 AWS servers for development (`7f28073`), used for the Bedrock move.

## Power and custom agent

- **`power-easy-read/`** packages the checker MCP server and the Easy Read rules as a Kiro Power: `plugin.json`, `mcp.json` and the `check-easy-read` skill with the rule table. Any Kiro project can add the checks. It needs a clone of this repository for the Python service.
- **`.kiro/agents/easy-read-reviewer.md`** is a read-only reviewer agent. It reviews Easy Read lines, fixtures and prompt changes with the checker tools, loads `easy-read-rules.md` and `safety.md`, and is denied file writes and shell commands.

## Results before and after

The brief planned to compare "the first day of vibe-coded prompts with the spec-driven version" (`docs/brief.md`). The evidence doesn't support a clean before and after, for 2 reasons. The day 1 spike was already spec task 8. And the later run was cut short by provider errors.

| Run | Rules checked | Letters | Result | Source |
| --- | --- | --- | --- | --- |
| Day 1 spike, first draft of `prompts/rewrite.md`, 3 runs | P1, P2, P4 only | 5 invented | No output passed all 3 rules in any run. gpt-oss-120b passed P1 on 3, 4 and 4 letters | `docs/day1-results.md` |
| Day 1 spike, public letters, 1 run | P1, P2, P4 only | 3 public | No output passed all 3 rules. P1 passed on 0 letters | `docs/day1-results.md` |
| Fixture run, final prompts, Groq chain | All 10 | 8 (3 public, 5 invented) | 2 letters finished, both flagged. P1, P2, P3, P4, P6 and P8 passed on both. 6 letters ended with a provider or model-output error | `docs/pass-rates.md` |

The 2 finished letters are not enough for a pass rate, and they were not the letters that lost key facts on day 1. A full run on the Bedrock chain is spec task 35, still open.

## What we didn't do

- No output has been shown to someone who uses or makes Easy Read (`tasks.md`, non-coding checklist).
- The 20-letter pass-rate run planned in the brief has not happened. The partial run had 8 letters (`docs/pass-rates.md`).
