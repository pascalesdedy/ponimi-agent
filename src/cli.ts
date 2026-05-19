import { Command } from 'commander';
import { intro, outro, spinner, text, select } from '@clack/prompts';
import { app } from './agent/graph';
import { checkpointer } from './db/sqlite';
// Import dependencies queue dsb jika diperlukan

const program = new Command();

program
  .name('qa-agent')
  .description('CLI Autonomous QA Agent berbasis LangGraph')
  .version('1.0.0');

program
  .command('run')
  .description('Jalankan agen untuk sebuah tiket Jira tertentu')
  .option('-t, --ticket <string>', 'ID Tiket Jira (mis. QA-123)')
  .action(async (options) => {
    intro('🤖 Memulai QA Agent...');
    const s = spinner();
    s.start('Inisialisasi...');

    // TODO: Setup thread config dengan checkpointer SQLite
    // const config = { configurable: { thread_id: "thread-" + options.ticket } };
    
    // TODO: Jalankan app.stream() untuk stream progress "currentStep" ke spinner

    s.stop('✅ Graph selesai di-execute sementara');
    outro('Menunggu approval CSV. Jalankan perintah `qa-agent approve` untuk melanjutkan.');
  });

program
  .command('approve')
  .description('Setujui CSV Test Case dan lanjutkan *resume* eksekusi grafik')
  .option('-t, --thread <string>', 'ID Thread LangGraph yang sedang di-pause')
  .action(async (options) => {
    intro('👍 Melanjutkan Eksekusi...');
    const s = spinner();
    s.start('Resume proses grafik...');

    // TODO: Lanjutkan eksekusi graph state
    // await app.stream(null, config);

    s.stop('✅ Proses berhasil!');
    outro('Semua tahapan selesai.');
  });

program
  .command('worker')
  .description('Jalankan background worker (BullMQ) untuk mode Autonomous (Webhook)')
  .action(async () => {
    console.log('👷 Memulai background worker...');
    // TODO: Start BullMQ worker untuk menerima job dari Redis
  });

program.parse(process.argv);
