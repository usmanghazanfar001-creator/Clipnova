import { Queue } from "bullmq";
import IORedis from "ioredis";
import { getEnv } from "./env";

export const QUEUE_NAME = "clipnova-processing";
export const RENDER_QUEUE_NAME = "clipnova-render";

export type ProcessingJob = {
  projectId: string;
  /** "full" runs everything missing; "reanalyze" keeps the transcript and regenerates clips. */
  mode: "full" | "reanalyze";
};

export type RenderJob = { renderId: string };

export function createConnection() {
  const connection = new IORedis(getEnv().REDIS_URL, { maxRetriesPerRequest: null });
  // Without a listener, connection failures are silent and everything just hangs.
  let lastMessage = "";
  connection.on("error", (err) => {
    if (err.message !== lastMessage) {
      lastMessage = err.message;
      console.error(`[redis] ${err.message || err.name} (check REDIS_URL in .env)`);
    }
  });
  connection.on("ready", () => {
    lastMessage = "";
    console.log("[redis] connected");
  });
  return connection;
}

let queue: Queue<ProcessingJob> | undefined;
let renderQueue: Queue<RenderJob> | undefined;

function getQueue() {
  if (!queue) queue = new Queue<ProcessingJob>(QUEUE_NAME, { connection: createConnection() });
  return queue;
}

function getRenderQueue() {
  if (!renderQueue) renderQueue = new Queue<RenderJob>(RENDER_QUEUE_NAME, { connection: createConnection() });
  return renderQueue;
}

export const JOB_ATTEMPTS = 3;
export const RENDER_ATTEMPTS = 2;

export async function enqueueProcessing(job: ProcessingJob) {
  await getQueue().add("process", job, {
    attempts: JOB_ATTEMPTS,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 200,
  });
}

export async function enqueueRender(job: RenderJob) {
  await getRenderQueue().add("render", job, {
    attempts: RENDER_ATTEMPTS,
    backoff: { type: "exponential", delay: 3000 },
    removeOnComplete: 200,
    removeOnFail: 200,
  });
}
