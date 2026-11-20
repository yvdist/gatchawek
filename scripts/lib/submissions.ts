/**
 * Node entry point for the pure submission parser. The implementation lives in
 * src/domain/submissions.ts (worker-safe, no node imports) so the scheduled
 * Worker ingest shares it; this module re-exports it for scripts and tests.
 */
export {
  formatRejectionReply,
  parseSubmission,
  POOL_GROUPS,
  slugifyBase,
  SUBMISSION_TEMPLATE,
  type ParsedSubmission,
  type ParseSubmissionInput,
  type ParseSubmissionResult,
  type PoolChoice,
  type SubmissionAttachment,
} from "../../src/domain/submissions.js";
