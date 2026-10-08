# Team review rules

- Never log secrets, tokens, or personal/health data. Log IDs instead.
- Validate all external input at the boundary.
- No `any` in TypeScript unless there is a comment explaining why.
- Every model output must be validated before it is acted on.
- New logic needs a unit test.
