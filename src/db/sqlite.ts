import { MemorySaver } from '@langchain/langgraph';
import path from 'path';
import fs from 'fs';

/**
 * Inisialisasi Checkpointer untuk LangGraph.
 *
 * Saat ini menggunakan MemorySaver (in-memory) karena `better-sqlite3`
 * memerlukan native compilation yang belum kompatibel dengan Node v24.
 *
 * TODO: Ganti ke SqliteSaver ketika:
 * 1. better-sqlite3 sudah support Node v24, ATAU
 * 2. Migrasi ke versi Node yang lebih stabil (v20/v22 LTS)
 *
 * Catatan: MemorySaver menyimpan state di RAM, sehingga state akan hilang
 * jika proses di-restart. Untuk produksi, gunakan SqliteSaver atau PostgresSaver.
 */

// Pastikan folder data tersedia (untuk output file nantinya)
const dataDir = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Pastikan folder output tersedia
const outputDir = path.resolve(process.cwd(), 'output');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Inisialisasi Checkpointer (in-memory untuk skeleton/development)
export const checkpointer = new MemorySaver();
