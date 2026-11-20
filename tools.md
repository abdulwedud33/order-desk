# tools.md

The complete allow-list of tools the in-app agents may call, plus the principles that keep them safe. Agents, prompts and limits: `agents.md`, `prompts.md`, `guardrails.md`.

---

## 1. Principles

1. **Allow-list only.** An agent can call only the tools listed for it. Anything else is rejected.
2. **Scope from the session, not from the model.** No tool accepts `shop_id`, `user_id` or `role` from the model. The Edge Function derives them from the verified session.
3. **Read tools use the caller's identity,** so row level security applies exactly as it would in the app. The service role is used only for the rate limiter, usage log and the tracking lookup.
4. **Propose tools never write.** They validate and build a draft that a person confirms.
5. **Arguments are validated** (types, ranges, lengths, uuid format) before running. Ids must have been returned by an earlier tool call in the same request.
6. **Results are data.** They are wrapped as untrusted data when returned to the model.
7. **Hard caps:** at most 6 tool calls and 3 model turns per request; per-tool row limits (5 to 10 results).
8. **Minimal results.** Tools return only the fields the agent needs; no phone numbers or addresses unless the tool exists for that purpose (none in v1 agent tools).

## 2. Order Intake tools

| Tool | Input | Output | Notes |
|------|-------|--------|-------|
| `search_catalog` | `query` (string, 1-60) | up to 5 available items: id, name, kind, price, prep minutes | Name match with the shop's saved aliases applied by the model through `get_shop_memory` |
| `search_customers` | `query` (name, 1-60) | up to 5: id, name | **Never returns phone numbers.** Matching by phone is done in code before the model call |
| `get_shop_memory` | none | saved aliases and preferences (up to 50) | Data, not instructions |
| `propose_order` | `type`, `items[{item_id? , name?, qty, note?}]`, `label?`, `channel?`, `note?`, `due_in_minutes?`, `customer_id?` | `{ draft: 'ready', summary }` or `{ error: CODE }` | Server recomputes prices and totals from the catalog; free-text lines flagged for confirmation; records the draft on the server side; no model-supplied prices |

Redaction flow for contact details: code extracts phone numbers (regular expression and normalisation) and replaces them with `[PHONE_n]` in the text sent to the model. The draft returned to the client contains the real number from the code's own extraction, never from model output. Addresses are free text kept as data; the model may copy them into `note` or an address field only as given.

## 3. Status Writer tool

| Tool | Input | Output | Notes |
|------|-------|--------|-------|
| `get_order_for_message` | `order_id` (uuid) | order code, status, template wording key, due time, shop name, customer first name | No phone, address or money. Must be an order the caller can see |

## 4. Insights Analyst tools (owner only)

| Tool | Input | Output |
|------|-------|--------|
| `get_dashboard_summary` | `period` today, week, month | orders by status, sales, cash in, unpaid balances, late count (profit not applicable) |
| `get_orders_by_hour` | `period` | counts per hour in the shop timezone |
| `get_late_orders` | `period` | up to 10: order code, minutes late, status, type (no personal data) |
| `get_top_items` | `period` | up to 5 items with counts and revenue |
| `get_repair_turnaround` | `period` | average days per stage, jobs waiting longest (no customer details) |

## 5. Non-agent tool: public tracking

`track-order` (Edge Function, no login). Not available to any model. Input: token. Output: shop name, business type, order code, status, due time, last update. Rate limited per IP and token; generic answer for unknown tokens.

## 6. Error results the model may see

`NO_ITEMS`, `UNKNOWN_ITEM`, `BAD_QUANTITY`, `DUPLICATE_ITEM`, `UNKNOWN_CUSTOMER`, `TOOL_LIMIT`, `UNAVAILABLE`. These are short codes, never messages with internals.

## 7. Developer tools (for coding agents, not the app)

| Tool | Use |
|------|-----|
| Supabase CLI | Local stack, migrations, pgTAP, function serve |
| Test runners | Unit tests, pgTAP, Playwright |
| Linters and scanners | Type check, bundle secret scan, history secret scan, dependency audit |
| Design review skills | `agents.md` part B section B4 |

Developer tools run on the developer machine or in CI only; none is callable from the deployed app.

## 8. Adding a tool (checklist)

1. Justify it in writing: which agent, which job, why existing tools are not enough.
2. Define the input schema and limits; return the minimum fields.
3. Decide role access and confirm RLS covers what it reads.
4. Add redaction if personal data could appear.
5. Add unit tests, an injection test (data containing instructions), and an eval case.
6. Update this file, `agents.md` and `prompts.md`.
