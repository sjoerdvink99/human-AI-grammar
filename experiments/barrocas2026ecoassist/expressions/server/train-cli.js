// `npm run train`: run process 1 from the command line.
import { runTraining } from './training.js';
import { closeBrowser } from './render.js';

const { optimizer_weights_1 } = await runTraining({ onProgress: (p) => console.log(p.message) });
console.table(optimizer_weights_1.strategies);
await closeBrowser();
