# Easy Read power for Kiro

This [Kiro Power](https://kiro.dev/docs/powers/create/) adds Easy Read checks to any Kiro project. It has:

- `plugin.json`: the manifest. Kiro activates the power when you mention words such as "easy read", "plain language" or "accessibility".
- `mcp.json`: starts the `easy-read-checker` MCP server, with the tools `extract_key_facts`, `check_easy_read` and `find_symbol`.
- `skills/check-easy-read/`: the steps to follow (extract key facts, write lines, check, pick pictures) and the rule table in `references/rules.md`.

The layout follows the Agent Plugins format described in the [Kiro docs on creating powers](https://kiro.dev/docs/powers/create/), as of October 2026.

The checker runs rules P1 to P8 without a model. P9 (meaning) and P10 (tone and no advice) need a model judge. In this power they are written as rules for the agent to follow, not as automatic checks.

## You need a clone of the checker

A power can't ship the Python service, so the MCP server runs from a clone of the [Easy Read Engine](https://github.com/wendoj/easy-read-engine) repository.

1. Install [uv](https://docs.astral.sh/uv/).
2. Clone the repository and install the checker:

   ```sh
   git clone https://github.com/wendoj/easy-read-engine.git
   cd easy-read-engine/checker && uv sync
   ```

3. Set `EASY_READ_CHECKER_DIR` to the full path of the `checker` folder, in the environment Kiro starts from. For example, in `~/.zshrc`:

   ```sh
   export EASY_READ_CHECKER_DIR="$HOME/code/easy-read-engine/checker"
   ```

4. In Kiro settings, add `EASY_READ_CHECKER_DIR` to **Mcp Approved Env Vars**. Kiro expands only approved variables.
5. In Kiro, open the Powers panel, choose **Add Custom Power**, then **Import power from a folder**, and select this `power-easy-read` folder. **Import power from GitHub** works only once the repository is public.

`mcp.json` starts the server with `sh -c`, so it works on macOS and Linux. On Windows, change `command` and `args` to run `uv --directory <path to checker> run python src/mcp_server.py` directly.

The first start loads the spaCy model and the pictogram index, which takes a few seconds.

## Privacy

The checker keeps nothing and never logs letter text. The chat with your Kiro agent may still go to a model provider, so use public sample letters or invented ones, not real letters with personal details.

## Licences

- Code: MIT.
- Pictograms returned by `find_symbol`: Sergio Palao, ARASAAC (https://arasaac.org), CC BY-NC-SA, owned by the Government of Aragón (Spain). The licence is non-commercial.
- Word list used by P5: New General Service List, CC BY-SA 4.0.
