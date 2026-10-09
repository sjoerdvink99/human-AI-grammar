// Background jobs for model chains, so the UI can show loading/progress for generative steps.
import { newId } from './store.js';

const jobs = new Map();

/**
 * @param {string} name
 * @param {string[]} steps design steps in order, e.g. ["tool_1 extract", "model_1 generate~"]
 * @param {(job: Job) => Promise<any>} fn
 */
export function startJob(name, steps, fn) {
  const job = {
    id: newId('job'), name, status: 'running', error: null, result: null,
    steps: steps.map((s) => ({ name: s, status: 'pending', detail: '' })),
    startedAt: Date.now(),
    step(name, status, detail = '') {
      const st = this.steps.find((s) => s.name === name);
      if (st) { st.status = status; st.detail = detail; }
    },
  };
  jobs.set(job.id, job);
  fn(job).then((result) => { job.status = 'done'; job.result = result ?? null; })
    .catch((e) => {
      job.status = 'error'; job.error = e.message;
      const running = job.steps.find((s) => s.status === 'running');
      if (running) running.status = 'error';
      console.error(`[job ${name}]`, e);
    });
  return job;
}

export function getJob(id) {
  const j = jobs.get(id);
  if (!j) return null;
  const { step, ...rest } = j;
  return rest;
}

/** Run a step and mark it running/done on the job. */
export async function runStep(job, name, fn) {
  job.step(name, 'running');
  const out = await fn((detail) => job.step(name, 'running', detail));
  job.step(name, 'done', typeof out?.__detail === 'string' ? out.__detail : '');
  return out;
}
