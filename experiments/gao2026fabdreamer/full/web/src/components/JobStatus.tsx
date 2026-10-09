import type { Job } from '../../../shared/types';

/** Loading / error state for a generative step (the design's `~`). */
export default function JobStatus({ job, label, onRetry }: { job?: Job; label?: string; onRetry?: () => void }) {
  if (!job) return null;
  if (job.status === 'running')
    return (
      <div className="job running-job">
        <span className="spinner" /> {job.log.at(-1) || label || 'Working…'}
      </div>
    );
  if (job.status === 'error')
    return (
      <div className="job error">
        {label ? `${label} failed: ` : ''}
        {job.error}
        {onRetry && (
          <button className="small" onClick={onRetry}>
            Retry
          </button>
        )}
      </div>
    );
  return null;
}
