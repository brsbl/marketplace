Every bb thread starts from zero. A script one agent wrote and debugged yesterday gets written again today by another agent. This plugin keeps those scripts in a library the agents can search, so a later thread runs the saved program instead of writing it again.

## What you get

- `extella_search` finds saved programs by what they do, not by name. In our test a thread that asked "how many errors of each kind are in a service log" found a program another thread had saved as "Count ERROR lines in a text log file, grouped by message".
- `extella_run` runs a program with parameters on a machine you choose and returns its result. The run itself spends no model tokens.
- `extella_save` stores a Python function after it worked. It refuses to replace an existing program unless the agent asks for that.
- `extella_get` shows a program's code, and `extella_devices` lists the machines you can run on.
- A skill tells agents the order: search first, reuse a fit, save only code that already gave the right answer.

## How it works

Programs live in an Extella account, in the scope of one Extella agent. Any bb project configured with the same agent id sees the same library. Programs run on your own computer through Extella Desktop, so they can read local files there. A run takes about 10 seconds end to end, so the gain is on work that takes longer to write and debug than that.

## Requirements

- An Extella account with an API key and an agent id from https://extella.ai
- Extella Desktop running on the machine where programs should run
- bb plugins run with full trust. This one talks only to the API address in its settings.

Source and tests: https://github.com/AnvarBakiyev/bb-plugin-extella
