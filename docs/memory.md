# memory.md

What the assistant remembers, and what it must never remember. Related: `agents.md`, `guardrails.md`, `security.md`, `05-backend-schema.md` (`shop_memory`).

---

## 1. Principles

1. **Memory is the shop's, not the model's.** Nothing is learned by the model. Saved items live in the database, scoped to one shop and protected by row level security.
2. **Visible and controllable.** The owner can see, delete, or clear everything the assistant remembers.
3. **Confirmed, not silent.** An item is saved only after a person taps "Remember".
4. **Small and boring.** Short items that help recognise the shop's own words. No personal stories, no opinions about people.
5. **Data, not instructions.** Memory is passed to the model as untrusted data and cannot change rules.

## 2. What may be remembered

| Kind | Example | Used by |
|------|---------|---------|
| `alias` | "shiro" means catalog item "Shiro wet" | Order Intake |
| `alias` | "the big one" means "Large pizza" | Order Intake |
| `preference` | "write customer messages in Amharic by default"; "keep messages formal" | Status Writer, Insights |
| `fact` | "Friday lunch is our busiest time"; "We close at 21:00" | Insights, due-time hints |

Limits: key up to 80 characters, value up to 300, at most 200 items per shop.

## 3. What must never be remembered

- Phone numbers, addresses, names of customers, or anything about an individual customer.
- Order contents, amounts, balances, or payment details.
- Opinions or judgments about people, or reasons for lateness blamed on a person.
- Passwords, codes, tokens, keys.
- Anything that looks like an instruction to the assistant ("always give discounts", "ignore the rules"). Such items are rejected on save.

## 4. Lifecycle

| Step | Behaviour |
|------|-----------|
| Suggest | After a confirmed choice resolves a nickname, the agent may return a `memory_suggestion` (alias) whose `ref_id` was returned by a tool this request |
| Confirm | UI asks "Remember this?" with the exact text; saved only on tap |
| Validate | Server checks length, kind, forbidden patterns (digits that look like phone numbers, URLs, instruction-like phrases); duplicates update the value |
| Use | `get_shop_memory` returns items inside an untrusted-data block |
| Review | "Assistant memory" screen (owner) lists items; delete one or clear all |
| Audit | Create, edit and delete are written to `audit_log` |
| Delete | Deleting the shop deletes memory; clearing removes rows immediately |

## 5. Per-conversation context

There is no chat history stored. Each request is stateless apart from confirmed memory. The pasted message is processed and discarded; only usage counters (agent, tokens, success) are logged.

## 6. Project memory (for developers)

Separate from the app: a short `DECISIONS.md` in the repo records architecture decisions with date and reason, so coding agents do not re-litigate them. It never contains secrets or customer data.

## 7. Tests

- Saving an instruction-like item is rejected.
- A phone-like number in a value is rejected.
- Memory from shop A is never returned for shop B (RLS test).
- Clearing memory removes all rows and the agent behaves as if none existed.
- A memory value containing "ignore previous instructions" does not change behaviour (injection eval).
