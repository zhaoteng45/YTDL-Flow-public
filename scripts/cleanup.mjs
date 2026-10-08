/**
 * Retained for the package.json maintenance command.
 *
 * Intentionally non-destructive: ordinary build/test/maintenance commands
 * must never delete live cookies or terminate unrelated download processes.
 * Rust application startup handles app-owned stale cookie files with exact
 * generated-file identity, age (>24h), and dead-owner checks.
 *
 * Any future manual destructive maintenance must have its own reviewed,
 * explicitly scoped command and must not be enabled from this entrypoint.
 */
console.log(
  'No cleanup performed. Stale app-owned temporary credentials are managed ' +
  'safely by the Rust application during startup.',
);
