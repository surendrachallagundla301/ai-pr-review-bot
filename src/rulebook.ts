/** Used when the repository has no rulebook file of its own. */
export const DEFAULT_RULEBOOK = `
- Never log secrets, tokens, passwords, or personal/health data (PII/PHI). Log IDs instead.
- Build SQL with parameters, never by concatenating user input.
- Every new HTTP endpoint must enforce authorization.
- Do not swallow exceptions silently; handle or rethrow with context.
- Avoid database or network calls inside loops when a batch call is possible.
- Public functions should have clear names; avoid unexplained magic numbers.
`;
