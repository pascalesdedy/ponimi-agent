import { Queue } from 'bullmq';
import { env } from '../config/env';

/**
 * Koneksi antrian untuk mengirimkan Job baru.
 */
export const qaQueue = new Queue('qa-jobs', {
  connection: { url: env.REDIS_URL },
});

/**
 * Fungsi untuk menambahkan job baru ke antrian.
 * Biasanya dipanggil oleh Webhook Handler (atau bisa disimulasikan via CLI).
 * @param ticketId ID Jira Tiket
 */
export const addQaJob = async (ticketId: string) => {
  const job = await qaQueue.add('run-qa', { ticketId });
  console.log(`[Publisher] Job ${job.id} ditambahkan ke antrian untuk tiket ${ticketId}`);
  return job;
};
