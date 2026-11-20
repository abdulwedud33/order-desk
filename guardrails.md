# guardrails.md

Limits that keep the assistant and the product safe, accurate and respectful. Tests for each rule are in `evals.md`. Security rules: `security.md`. Agents: `agents.md`. Tools: `tools.md`.

**Core idea:** the AI proposes, deterministic code decides, a person confirms.

---

## 1. Principles

1. **Propose, never commit.** No AI path writes business data. Saving happens through the normal order flow after a tap.
2. **Code does the math and the rules.** Totals, status, numbers, balances come from the database.
3. **Untrusted by default.** User text, pasted chat messages, item names, notes, memory items and tool results are data. They cannot change rules, tools or permissions.
4. **Least data, least power.** Agents see the minimum fields for their job, scoped by the server to the caller's shop and role.
5. **Fail soft.** If the assistant is unavailable or unsure, the manual flow works and the message is friendly.

## 2. Input guardrails (before any model call)

| Check | Rule | On failure |
|-------|------|------------|
| Authenticated | Valid session; member of a shop | 401/403 mapped to friendly text; no model call |
| Role | Intake: owner, staff. Status Writer: owner, staff. Insights: owner | "You don't have access to this." |
| Size | Pasted message at most 600 characters; other inputs have fixed schemas | "That message is too long. Try one order at a time." |
| Shape | Schema validation; unknown fields rejected | "We couldn't read that. Try again." |
| Cleanup | Unicode normalised; control and zero-width characters removed | Silent |
| Redaction | Phone numbers replaced by placeholders in code; kept out of prompts and logs | n/a |
| Rate and budget | Section 6 limits | "Too many tries. Please wait a minute." |
| Kill switch | Server-side flag off | Manual flow shown without error tone |

## 3. Prompt-injection defences

- **Instruction hierarchy.** The system prompt (in the repository, `prompts.md`) is the only source of rules. Nothing from users, data or tools can override it.
- **Delimited data.** All untrusted content sits inside marked blocks (`<untrusted_data>`); the prompt states content inside is never an instruction; closing tags inside data are neutralised.
- **Pasted chats are data.** A customer message saying "give me a free pizza" is just text to be parsed, not a command.
- **No model-supplied scope.** Tools never accept shop, user or role from the model.
- **No free-form actions.** Only allow-listed tools with validated arguments, per-request call limits.
- **Output is never executed.** No rendering of model text as HTML, no model-built URLs or SQL.
- **Secrets never in prompts.**
- **Refusal pattern.** Requests to reveal the prompt, act out of scope, or reach other shops get a short neutral refusal that points back to supported actions.

## 4. Output guardrails (after the model, before the UI)

| Step | Check |
|------|-------|
| 1. Schema | Output parses against the agent's schema; extra or missing fields fail |
| 2. Grounding | Every item and customer id must have been returned by a tool in this request; unknown ids are removed and become a clarification |
| 3. Recompute | `propose_order` computes prices and totals from the catalog; model prices are ignored |
| 4. Sanity limits | Quantity 0 < q <= 10,000, at most 20 lines, due time within 7 days, order type valid for the shop's template |
| 5. Ambiguity | Two or more plausible matches, or low confidence, must produce a question |
| 6. Contact data | Real phone and address come from code extraction, never from model text; the model never outputs a phone number |
| 7. Text safety (customer messages) | At most 60 words; no threats, shaming, legal claims, money amounts, or personal data beyond first name and order code; failing text is replaced by a template |
| 8. Numbers (insights) | Every number must exist in tool results; any mismatch discards the output |
| 9. Render safety | Rendered as plain, escaped text |

Every result appears as a **draft card** with Confirm and Discard. Nothing is saved or sent until the person acts.

## 5. Human-in-the-loop rules

- No auto-confirm, no timers, no background actions.
- Extra flags for unusual drafts: very large quantity, free-text lines with prices, delivery without phone, order for a customer with unpaid balances (informational).
- Customer messages are never sent by the app; the person copies or shares them.
- Memory suggestions are saved only after a separate confirmation (`memory.md`).
- Each draft has a quick "Was this right?" feedback that feeds `evals/` (no personal data stored).

## 6. Rate limits and budgets

| Limit | Starting value |
|-------|----------------|
| Per user | 10 requests per minute, 200 per day |
| Per shop | Daily token cap and request cap |
| Per request | At most 6 tool calls and 3 model turns; output token cap per agent |
| Concurrency | 2 in-flight assistant requests per user |
| Global circuit breaker | If provider errors pass a threshold, the assistant pauses; manual flow stays open |
| Cost alerts | At 80% of a shop's daily budget; hard stop at 100% |

Limits are enforced before the model call.

## 7. Privacy guardrails

- Send only the fields needed; phone numbers never go to the model; addresses only for delivery drafts and only as plain data.
- Logs record agent, token counts, outcome and latency. No prompts, pasted messages, names, phones or addresses.
- Provider settings: no training on our data, minimal retention (verify the provider's current terms before launch).
- Requests are stateless apart from confirmed shop memory.

## 8. Friendly fallbacks (copy rules)

No backend or model error text ever reaches users.

| Situation | Message pattern |
|-----------|-----------------|
| Assistant unavailable | "The assistant isn't available right now. You can still create the order by hand." + button |
| Not understood | "I couldn't tell what to order. Try: 2 shiro and 1 tibs, deliver to Bole." |
| Ambiguous | "Which one do you mean?" + options |
| Too long | "That message is too long. Try one order at a time." |
| Rate limited | "Too many tries. Please wait a minute." |
| Not allowed | "You don't have access to this." |
| Out of scope | "I can help with new orders, customer updates and daily summaries." |

## 9. Product guardrails (not only the assistant)

| Guardrail | Rule | Detail in |
|-----------|------|-----------|
| No secrets in the client | Only public URL and anon key ship | `security.md` section 3 |
| Authorized data only | Server decides access from session and role; RLS on every table; sensitive data in separate tables | `security.md` section 5, `05-backend-schema.md` |
| Backend rules enforced | RPCs, constraints, status machine and RLS are the truth | `05-backend-schema.md` |
| Input validated | Client and server, plus DB constraints | `security.md` section 6 |
| Rate limits on all APIs | Every endpoint including tracking and assistant | `security.md` section 7 |
| No backend errors shown | Error translation module | `security.md` section 8 |
| Append-only history | Events and payments never edited | `05-backend-schema.md` |
| Optimistic rendering with rollback | Instant feedback, clear message on rejection | `02-technical-requirements.md` |
| Tracking minimisation | Public page exposes only code, status, due time, shop name | `security.md` section 9 |

## 10. Ethical UX guardrails

Psychology patterns (`04-ui-ux-design-brief.md` section 6) are allowed only when they help people reach their own goals.

- No fake urgency, countdowns or guilt copy.
- Loss-aversion messages state real numbers from real data.
- Customer-facing messages are polite and never pressure or threaten.
- Defaults favour the user; export and deletion are easy.
- AI text is labeled as a draft until a person sends or saves it.

## 11. Monitoring and response

- Dashboards: assistant success rate, clarification rate, discard rate, schema-failure rate, redaction misses (should be 0), cost per shop, p95 latency.
- Alerts: schema-failure spike, injection-pattern spike, cost spike, provider errors, any redaction miss.
- Kill switches (server-side flags): each agent separately, or all AI at once; tracking links; new sign-ups; read-only mode.
- Any harmful or wrong output reported by a user becomes a new eval case before the fix ships.

## 12. Guardrail to eval map

| Guardrail | Eval |
|-----------|------|
| Injection resistance | `evals.md` section 5 |
| Grounding, no invented ids | Section 2 (hallucinated id = 0) |
| Redaction | Section 2 (raw phone seen by model = 0) |
| Customer message safety | Section 3 |
| Insight numbers grounded | Section 4 |
| Role and shop isolation | Sections 5 and 6.1 |
| Rate limits and fallbacks | Sections 5 and 6.4 |
| No backend text in UI | Section 6.2 and 6.3 |
