// Local model runtime (transformers.js) shared by model_1 (ASR) and model_3 (embedding).
import path from 'node:path';
import { env, pipeline } from '@huggingface/transformers';

env.cacheDir = path.resolve('data/models');

const cache = new Map<string, Promise<any>>();
export function localPipeline(task: string, model: string): Promise<any> {
  const key = `${task}:${model}`;
  if (!cache.has(key)) {
    const p = (pipeline as any)(task, model);
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return cache.get(key)!;
}
