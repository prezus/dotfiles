// Typed errors, via better-result's TaggedError.
//
// The bash reported failures rather than raising them: `cmd || { print_error …;
// return 1; }`. That is roughly errors-as-values already, but with no type and
// no way to tell "the tool ran and said no" from "the tool isn't installed".
// These tags restore that distinction.
import { TaggedError } from "better-result"

/**
 * The process could not be started at all — almost always a binary missing from
 * PATH. Distinct from a process that ran and exited non-zero, which is a normal
 * RunResult with ok:false and is frequently the expected answer.
 */
export class SpawnError extends TaggedError("SpawnError")<{
  command: string
  message: string
}>() {}
