import { Worker, Job } from 'bullmq';
import { env } from '../config/env';

/**
 * Worker untuk memproses job QA secara background (Mode Autonomous).
 */
export const qaWorker = new Worker(
  'qa-jobs', // Nama antrian
  async (job: Job) => {
    console.log(`[Worker] Memproses job ${job.id} untuk tiket ${job.data.ticketId}`);
    
    // TODO: Panggil LangGraph pipeline (app.invoke/app.stream) dengan mode 'autonomous'
    // const config = { configurable: { thread_id: job.id } };
    // const result = await app.invoke({ ...stateAwal, mode: 'autonomous' }, config);
    
    return { success: true };
  },
  { connection: { url: env.REDIS_URL } }
);

qaWorker.on('completed', (job) => {
  console.log(`[Worker] Job ${job.id} selesai.`);
});

qaWorker.on('failed', (job, err) => {
  console.error(`[Worker] Job ${job?.id} gagal:`, err);
});
