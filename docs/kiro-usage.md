# How Kiro was used

This write-up covers the spec, steering, hooks, MCP server, Power and custom agent in `.kiro/` and `power-easy-read/`. Every number has its source next to it: a file in this repository or a git commit. Commit counts are up to commit `f4c748f`, the last commit before this write-up. Later notes also cite commits after it, up to `9776bc4`.

## Spec

The spec in `.kiro/specs/easy-read/` came first. It was committed at 01:03 UTC on 11 November 2026 (`6759681`), before any code.

| Part | Size | Source |
| --- | --- | --- |
| Requirements | 9 requirements with 47 acceptance criteria, in EARS form | `requirements.md` |
| Correctness properties | 10 rules, P1 to P10. 8 are checked without a model | `requirements.md`, "Correctness Properties" |
| Design | 511 lines | `design.md` |
| Tasks | 36 implementation tasks, 35 done. Task 35 (re-run the fixtures on Bedrock) is open | `tasks.md` |
| Non-coding checklist | 10 items, 2 done (the 3 public sample letters, and showing an output to an Easy Read checker) | `tasks.md`, "Non-coding checklist" |

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
- **The property guard caught a test change once.** The pipeline's P1 behaviour changed so that it keeps the latest try that passed P1 when the last try breaks it. `checker/scripts/check_property_tests.py`, which the `check-property-tests.json` hook runs, then reported 3 renamed fast-check properties in `web/tests/pipeline.test.ts`. They were reviewed and kept as renamed properties, each still using `fc.assert` for the same requirement, and a new property was added for the kept try. The body of commit `03c6c1b` records this.
- **The prompt-save hook has no recorded before and after.** The prompt changes in `7d0fccc` and `7d8335d` have not been through the 8-letter fixture run (task 35), so we don't claim a fixture result for them. They were live for 1 recording: the 3 public samples were re-recorded on Bedrock in `40faaee`, after those commits and after the P3 and P5 checker fixes. Summed over all 10 rules, the failing lines in the recorded checks went from 190 (`24116c8`) to 103 (`40faaee`). That re-record changed the prompts, the checker and the model's answers at once, so the drop can't be credited to the prompts alone.
- **Recorded samples can be re-checked offline.** `checker/scripts/recheck_samples.py` (`55f32dd`) runs P1 to P8 on the recorded sample lines with the current checker and prints only rule IDs and counts. On the `40faaee` recordings, with no new recording, the failing lines summed over P1 to P8 went from 119 (checker at `78db0f8`) to 80 after the P3 and P5 fixes in `68cb6b3` and `9214a3f`. A review then found 3 exemptions too wide and a line-break rule that weakened P1. The stricter fixes in `f9f2f81` and `9776bc4` bring the count to 90. A second review found that `f9f2f81` also renumbered the planning letter's sentences (51 became 48), so the app refused that sample with `sample_outdated` while the script still printed clean numbers. The splitter fix in `0aa1120` gives all 3 samples their recorded sentences again, and since `8bc48d4` the script exits 1 (and a pytest fails) when a sample's sentence IDs or texts no longer match the current split. With the P3 and P5 fixes in `4f151fa` and `c0848d1`, the count is 82. P1 passes on all 3 samples at every step. An earlier version of this page said 99 to 60; those were addition mistakes.
- **The save hooks have not been recorded catching a problem.** We don't claim they did.

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
| Sample recording, Bedrock chain, 11 November 2026 | All 10 | 3 public | All 3 flagged after 3 tries. P1 passed on all 3. P3, P5 and P7 failed on some lines in all 3 | `web/data/samples/`, `40faaee` |
| Fixture run, Bedrock chain, 12 November 2026 (spec task 35) | All 10 | 8 (3 public, 5 invented) | All 8 finished, no provider errors. 0 passed, 6 flagged, 2 blocked on 1 key fact each. P9 failed on all 8, P8 passed on all 8 | `docs/pass-rates.md`, `fixtures/results/20261112T171407Z-all.json` |
| Sample re-recording, Bedrock chain, 12 November 2026 | All 10 | 3 public | East Cambridgeshire and the planning letter flagged. Manchester blocked on P1 on every try, so its 11 November recording is kept. 0 letters passed all 10 | `web/data/samples/`, `58055db` |
| Fixture run, Bedrock chain, `66a8d0b` (before the `657bd8f` checker fix), 12 November 2026 | All 10 | 8 (3 public, 5 invented) | All 8 finished, no provider errors. 0 passed, 6 flagged, 2 blocked (1 and 3 missing key facts). P9 failed on all 8, P8 passed on all 8 | `docs/pass-rates.md`, `fixtures/results/20261112T195656Z-all.json` |
| Sample re-recording, Bedrock chain, `66a8d0b` (before the `657bd8f` checker fix), 12 November 2026 | All 10 | 3 public | East Cambridgeshire and the planning letter flagged. Manchester blocked on P1 on every try again, so its 11 November recording is kept. 0 letters passed all 10 | `web/data/samples/`, `a107eeb` |
| Fixture run, Bedrock chain, after the judge change `9ad9ef1`, 13 November 2026 | All 10 | 8 (3 public, 5 invented) | All 8 finished, no provider errors. 0 passed, 6 flagged, 2 blocked on P1. P9 passed on 3 of 8 (0 of 8 before the judge rubric change) | `docs/pass-rates.md`, `fixtures/results/20261113T103145Z-all.json` |
| Fixture run, Bedrock chain, after the P1 extractor fixes `83092cd`, 13 November 2026 (21:36 UTC) | All 10 | 8 (3 public, 5 invented) | All 8 finished, 0 passed, 8 flagged, 0 blocked. P1 passed on all 8, P9 on 2 | `docs/pass-rates.md`, `fixtures/results/20261113T213603Z-all.json` |
| Single letter runs after the P1 extractor fixes (`83092cd`), 13 November 2026 | All 10 | 2 (1 invented, 1 public) | Invented council tax letter passed all 10 rules on try 2. Manchester flagged, with P1 passing on all 3 tries. 1 run each, so not a pass rate | `docs/pass-rates.md` |

None of these runs is a pass rate. Across the full fixture runs no letter has passed all 10 rules; one invented letter did in a single run after the 13 November fixes. On Bedrock the providers are no longer the limit. The rules are, and P3, P5 and P9 most of all.

## Prior art

The brief listed "An AI Easy Read tool already exists" as a risk, with the plan to "lead with the verified checks" (`docs/brief.md`, risk table). The risk came true. Swindon Borough Council's [Simply Readable](https://www.local.gov.uk/case-studies/swindon-borough-council-simply-readable-ai-easy-read-solution) is an open-source AI Easy Read generator on Amazon Bedrock, which social workers use to produce Easy Read versions. Its case study (read again on 11 November 2026) describes no automated check of the output. The README's "Prior art" section says how this project differs: it is for the person who received the letter, and every line goes through P1 to P10, with a P1 failure blocking the output.

## What we didn't do

- No formal testing with readers. An Easy Read checker tried the app and told us it was easy to use and helped a lot. That was 1 informal check (`tasks.md`, non-coding checklist, "Show one output to someone who uses or makes Easy Read"). Feedback from 3 to 5 people, with quotes, is still open there.
- The 20-letter pass-rate run planned in the brief has not happened. The Bedrock run had 8 letters (`docs/pass-rates.md`).
