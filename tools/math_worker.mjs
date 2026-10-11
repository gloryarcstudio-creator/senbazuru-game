import { parentPort, workerData } from 'node:worker_threads';
import { M, simulate } from './math_lib.mjs';
const { tune, mode, rounds, seed } = workerData;
parentPort.postMessage(simulate(M.createEngine(tune), mode, rounds, seed));
