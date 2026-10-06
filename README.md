# Taste Brief

**A taste brief for small hospitality businesses in Vietnam.** A café, homestay or tour owner picks the visitors they want — people from Seoul, Tokyo, Sydney — and gets a one-page plan grounded in Qloo's taste graph: where those visitors already go in the city, what those places have in common, music both visitors and locals know, and how the owner's own ideas measure up. Every claim on the page links to the Qloo result behind it.

Built for the [Qloo Agentic Hackathon](https://qloo.devpost.com). Data: Qloo Taste AI™ (hackathon API). Agent: NVIDIA Nemotron 3 Super on Nebius Token Factory. Also served as an MCP server.

## The problem

Vietnam's small cafés, homestays and tour operators depend on foreign visitors, and most of them market to "tourists" in general. An owner who wants more guests from Seoul has two sources today: a guess, or a chatbot that answers from general knowledge. Both tend to name the same famous places and the same global stars.

A general chatbot does not know which cafés in Hanoi people from Seoul favour **more than** Hanoi does overall, or what those places have in common. Qloo does, because its taste graph links places, music and film to the aggregate taste of people in a given city.

## What it does

For one business type, city and visitor market, the agent produces:

| Section | How it is computed | Qloo request |
|---|---|---|
| **Where they already go** | Places of the owner's kind in the city ranked for the visitor market, next to the same list without the market signal. A place that climbs is one this market lifts. | `/v2/insights` `filter.type=urn:entity:place`, `filter.location.query=<city>`, `filter.tags=<business tags>`, with and without `signal.location.query=<market>` |
| **What their favourites have in common** | Tags (ambience, setting, offerings, cuisine) that appear more often among the market's favourites than city-wide, with counts. | derived from the two lists above |
| **Your ideas, measured** | A Nemotron tool loop maps each idea to a Qloo tag (`find_tags`), then scores it against the same two lists: over-represented, common, untested, or absent from the market's favourites. | `/v2/tags` `filter.query`, `filter.parents.types=urn:entity:place` |
| **Your own place** | Looks the owner's place up in Qloo and ranks it with the market's top favourites. | `/search`, then `/v2/insights` with `filter.results.entities` |
| **Music both sides know** | Artists loved in the visitor city that the host city also loves (a playlist guests and locals share), plus what is distinctive to the visitors. Same for TV. | `/v2/insights` `filter.type=urn:entity:artist` / `tv_show`, `signal.location.query=<market>` and `=<city>` |
| **Same question, no Qloo** | The same model answers the same question with no data; its places and artists are checked against the Qloo lists. | — |

### Example (Hanoi café, guests from Seoul)

From the saved example in `data/samples/hanoi-cafe-seoul.json`:

- Qloo returns 21 Hanoi cafés with a measurable Seoul signal. "Lakefront" is carried by 4 of those 21 against 1 of Hanoi's top 50; "Vietnamese" by 14 of 21 against 23 of 50.
- Artists in both Seoul's and Hanoi's top lists include G-Dragon, Jennie and HyunA.
- The owner's idea "egg coffee workshop" maps to the tag *Egg Coffee*: 4 of 21 Seoul favourites offer it against 10 of 50 city-wide, so it is common rather than distinctive. "Live music" is offered by 4 of Hanoi's top 50 and by none of the Seoul favourites.
- Asked without data, the model names Hanoi's famous cafés: The Note Coffee and Hanoi Social Club are #4 and #6 city-wide, but none of its five picks is among the 21 cafés where Qloo measures a Seoul signal.

## The evidence rule

Every Qloo result that can support a recommendation goes into a ledger with a short reference (`P3` for a place, `T1` for a tag, `C2` for culture, `I1` for an idea) and the exact request that produced it.

- The model writes the brief from a fact sheet built from the ledger. Any action that does not cite a valid reference is dropped, and the page says how many were dropped.
- The agent can only score tag ids that Qloo returned to it in the same run.
- Names, ranks and counts on the page are rendered from the ledger, never from model text.
- Without a model key, the brief is assembled by rule from the same ledger.

## Architecture

```
browser ──POST /api/brief (server-sent events)──▶ Express
                                                   │
                         ┌─────────────────────────┼──────────────────────────┐
                         ▼                         ▼                          ▼
              Qloo /v2/insights, /search,    Nemotron tool loop        Nemotron JSON brief
              /v2/tags (server-side key,     (find_tags, rank ideas)   + LLM-only contrast
              cached 12 h)                         │                          │
                         └────────────── ledger of cited results ◀────────────┘
MCP clients ──/mcp (Streamable HTTP)──▶ market_favourites · shared_culture · find_tags · score_ideas · taste_brief
```

- `src/qloo.js`: Qloo client. Key in the `X-Api-Key` header, server-side only; bounded retry; 12-hour response cache.
- `src/analysis.js`: market vs city rankings, taste profile, shared culture, idea scoring, ledger.
- `src/agent.js`: the three phases, fact sheet, brief validation, LLM-only contrast.
- `src/mcp.js`: the same tools over MCP.
- `server.js`: web app, SSE, daily call budgets, per-IP rate limit, brief cache.

## Run it

Requires Node.js 22+.

```sh
npm install
cp .env.example .env   # add QLOO_API_KEY (and NEBIUS_API_KEY for the agent)
npm start              # http://127.0.0.1:4320
npm test
```

Regenerate the saved examples with `node --env-file=.env scripts/make-samples.mjs`.

### Use it from an MCP client

Point any Streamable HTTP MCP client at `https://<deployment>/mcp`. Tools:

- `market_favourites(city, market, business)`
- `shared_culture(city, market, kind)`
- `find_tags(query)`
- `score_ideas(city, market, business, ideas[])`
- `taste_brief(city, market, business, ownPlace?, ideas?)`

## Limits

- Qloo results describe the **aggregate** taste of people in a city. They say nothing about any individual guest, and the app sends no personal data to Qloo.
- Coverage is uneven. Hanoi and Ho Chi Minh City have measurable signals for most markets; smaller cities have few for distant markets. When a business type has too few, the list widens to every kind of place and says so; when there is none, the page says that too.
- The hackathon key allows 5 Qloo requests a second and 10,000 a month. The client paces itself to 4 a second, retries rate-limited requests, caches responses for 12 hours, and the server pauses live briefs when fewer than 1,000 monthly calls remain, so the saved examples and cached briefs keep working through judging.
- Qloo returns at most 50 results per request, so "city-wide" means the city's top 50 for that business type.
- Idea scores show whether places offering something are over-represented among a market's favourites. They do not show that adding it will bring guests.

## License

MIT
