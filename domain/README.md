# Domain memory

A domain is one streamer or topic. The home screen **Domain** control creates,
edits, and switches them.

## In the app

1. Select a domain (or **New**) before captioning.
2. After a job finishes, confident names are saved automatically.
3. Uncertain names appear as **Needs a spelling** — pick a suggestion or type
   one, then **Use**.
4. **Edit → Saved names** lists what this domain already knows.

Keep one domain per streamer or topic so names do not mix.

## On disk (optional)

`packs/<slug>/`:

| File | Role |
| --- | --- |
| `profile.md` | Notes injected into translation |
| `glossary.json` | Saved names |
| `pending.json` | Names waiting for a spelling |

CLI: `npm run domain:new -- cooking "JP cooking streams"`
