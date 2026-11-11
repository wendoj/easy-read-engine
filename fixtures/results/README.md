# Fixture run results

`npm run fixtures` (in `web/`) writes one JSON file here per run, named `<UTC time>-<set>.json`. `default` is the 5 `invented-*.txt` letters. `all` is the pass-rate run from `npm run fixtures -- --all` (task 31).

These files are committed as evidence of pass rates. They hold rule results and metadata only: file name, status, tries, pass or fail per rule with counts, model request counts, and which provider and model answered. They never hold letter text, Easy Read lines, check details or key-fact values (`.kiro/steering/safety.md`).
