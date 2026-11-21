Activation: Always On

1. Treat /docs as the specification; conflicts are resolved toward the safer option and
   logged in DECISIONS.md.
2. Every new table: enable RLS, write policies, revoke default privileges, add indexes for
   policy columns, add pgTAP tests for all roles (anonymous, outsider, owner, staff, kitchen,
   courier assigned, courier other).
3. Every new RPC: security definer, set search_path = '', role check, rate_limit_hit,
   argument validation, idempotency key, event row, coded errors.
4. Every new screen: skeleton that matches the layout, instant pressed feedback, optimistic
   update with rollback, offline behaviour, strings in en/am/om, friendly errors only,
   accessibility pass.
5. Never read or write secrets in code. Never log personal data.
6. Finish every task with the report format: Done, Verified (real command results), Not
   verified, Decisions, What I must do, Next.
