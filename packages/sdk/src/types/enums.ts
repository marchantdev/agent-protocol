export enum JobStatus {
  Pending = 'pending',
  InProgress = 'inProgress',
  Completed = 'completed',
  Disputed = 'disputed',
  Cancelled = 'cancelled',
  Finalized = 'finalized',
}

export enum Capability {
  CodeReview = 1 << 0,
  SecurityAudit = 1 << 1,
  Documentation = 1 << 2,
  Testing = 1 << 3,
  Deployment = 1 << 4,
  General = 1 << 5,
}

export function parseJobStatus(raw: Record<string, unknown>): JobStatus {
  const key = Object.keys(raw)[0];
  return key as JobStatus;
}
