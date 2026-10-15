# Provider Policy

These rules apply to every tool that can call a model unattended. They exist
because on 2026-10-15 OpenChamber consumed a week of Claude Max quota and 44% of
a Gemini Ultra weekly quota inside two 5-hour windows, via a goal loop with no
default budget and a fallback chain that walked across providers as each one
capped.

## The five rules

1. **Every autonomous loop has a hard token budget.**
   - Default: 200,000 tokens per goal.
   - Override per goal only, never globally.
   - Compaction counts as a turn and its cost is estimated.
   - A budget that cannot be measured is not a budget.
2. **Every fallback refuses on quota exhaustion.**
   - A 429 is a stop, not an error. The turn fails; it does not move to the
     next provider.
   - Fallback is only for transient errors (timeout, 5xx).
   - A fallback to a model above a configured cost tier fails closed — refuse
     rather than spend.
3. **Every provider has a monthly ceiling the operator is willing to lose.**
   - Set the ceiling in the provider's own dashboard or in local config.
   - Once set, forget it. The ceiling is the backstop, not the plan.
   - Review quarterly. Cancel providers that cannot justify their ceiling.
4. **Every session has a visible token counter.**
   - Cumulative, not per-turn.
   - Provider-agnostic — the total does not reset on a model switch.
   - Surfaced on a health endpoint, in logs, or in the UI. Anywhere the operator
     will actually see it.
5. **Discount windows are respected.**
   - Batch and deferrable work runs inside them (Qwen 15:00–01:00 UK, DeepSeek
     off-peak).
   - Interactive work runs when the operator is present.
   - A job that does not need to run now does not run now.

## Applied to current stack

| Provider | Mode | Ceiling | Notes |
|---|---|---|---|
| QwenCloud Pro | Metered, 80% window 15:00–01:00 UK | 353M tokens/week (native cap) | Primary metered target |
| DeepSeek | Metered, off-peak window | $70.85 credit | Secondary; reasoning strengths |
| Claude Max | Subscription | 5-hour + weekly (native) | Session expired at incident time — audit |
| Gemini Ultra | Subscription | 5-hour + weekly (native) | 81% of 5-hour consumed at incident — near wall |
| OpenCode Go | Subscription | weekly + monthly (native) | 60%/80% used |
| Cursor | Subscription | (native) | Audit for replacement value |
| OpenRouter | Metered credit | $30 → $0.08 at incident | Effectively dead; top up or remove |
| Local (Nemotron 120B, Qwen 27B) | Local | GB10 / 4090 throughput | Context-bound: 256k / 48k |

## The meta-rule

**Nothing runs unattended without a completion condition and a cost boundary.**
A goal loop with neither will consume until an external limit stops it. The
external limit is not a design.
