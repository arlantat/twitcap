# Domain memory packs

TwitCap injects a **domain pack** (streamer/topic context + glossary) into every
translation batch, and grows the glossary automatically after each job.

Packs live in `packs/<slug>/`:

| File | Role |
| --- | --- |
| `profile.md` | Who speaks, tone, audience — steers translation and mining |
| `glossary.json` | Accepted terms: `{ jp, translations: { vi, en, … }, source, count }` |
| `pending.json` | Ambiguous terms waiting for your decision |

## Create a pack for your own domain

```bash
npm run domain:new -- cooking "JP cooking streams"
# then edit domain/packs/cooking/profile.md
```

Pick the pack per job in the web UI (or set `DOMAIN_PACK` for the default).

## How memory grows

After each successful job, an Ollama miner proposes terms **for that job's
caption language**:

- **Confident / non-conflicting** → written into `glossary.json` automatically.
- **Ambiguous or conflicting** → queued in `pending.json`. Resolve with:

```bash
npm run domain:resolve            # all packs, interactive
npm run domain:resolve -- --pack cooking --choose <id>=<rendering>
```

In an agentic IDE (Cursor etc.), the agent reads `pending.json`, asks you via
its interview UI, then applies your choices with `--choose`. You never need to
hand-edit these JSON files.

Terms with `"source": "interview"` or `"manual"` are never auto-overwritten.
