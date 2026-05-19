# Rencana Implementasi: Homelab-Grade QA Agent

Rencana ini dioptimalkan untuk *Homelab* atau *Small VPS* (low RAM/CPU overhead), namun tetap mempertahankan kecerdasan penuh agen, termasuk **kemampuan otonom (autonomous) seratus persen**.

Perbedaan utama dengan Enterprise-Grade hanyalah hilangnya infrastruktur berat (Postgres, ChromaDB, MinIO, Ollama) yang diganti dengan alternatif *lightweight* (SQLite, Docker Volumes).

---

## 1. Arsitektur Homelab yang Ringan & Scalable

1. **Cloud LLM Saja**: Menggunakan API OpenAI/Claude/Gemini/DeepSeek (Diatur di `.env`).
2. **Database & Checkpointer**: Menggunakan `better-sqlite3` dan `SqliteSaver` untuk menyimpan State LangGraph.
3. **Vector DB (RAG)**: Menggunakan ekstensi `sqlite-vec` untuk menyimpan embeddings dokumen.
4. **File Storage**: Menggunakan *Docker Volumes* (Folder `./output` lokal).
5. **Queueing**: Redis + BullMQ (Sangat ringan, ~20MB RAM, mencegah server crash saat menerima *spike traffic*).

---

## 2. 🤖 Tiga Mode Kemandirian (Autonomous Configuration)

Meskipun menggunakan infrastruktur Homelab, agen ini tetap dilengkapi dengan **Router Logika (Conditional Edges)** di dalam LangGraph untuk mendukung 3 mode operasi:

### Mode 1: Manual (Human-in-the-Loop Murni)
- **Kapan dipakai?**: Saat Anda mengujicoba *prompt* atau ingin 100% kendali.
- **Alur**: User memanggil via command line (CLI) ➡️ Agen baca Jira & file `.md` ➡️ Agen buat CSV Test Case ➡️ **Grafik Pause (Menunggu Review)** ➡️ User edit & klik *Approve* (via CLI) ➡️ Agen buat kode Playwright ➡️ **Selesai (Tidak ada eksekusi otomatis)**.

### Mode 2: Semi-Autonomous (Self-Healing Lokal)
- **Kapan dipakai?**: Standar operasi harian tim QA.
- **Alur**: Agen buat CSV ➡️ **Grafik Pause (Menunggu Review CSV)** ➡️ User *Approve* CSV ➡️ Agen buat kode Playwright ➡️ **Agen Mengeksekusi Kode di Sandbox Docker** ➡️ **Jika Error, Agen Perbaiki Sendiri (Loop maks 3x)** ➡️ Script final sukses disimpan ke `./output` ➡️ **Selesai**.

### Mode 3: Full Autonomous (Background Job)
- **Kapan dipakai?**: Integrasi murni dengan CI/CD & Jira. Tanpa campur tangan manusia.
- **Alur**: 
  1. **Job Trigger**: Status tiket Jira berubah "Ready for QA". Job di-trigger otomatis dan dimasukkan ke *background worker* (CLI daemon).
  2. Webhook memasukkan antrian ke BullMQ dengan parameter `mode: 'autonomous'`.
  3. Agen baca Jira & file `.md` instruksi.
  4. Agen meng-generate CSV. *(Melewati fase Pause/Review!)*
  5. Agen meng-generate kode Playwright.
  6. **Self-Healing**: Agen mengeksekusi kode di Sandbox Docker. Jika error, perbaiki sendiri.
  7. **Auto-Report**: Jika sukses, agen menggunakan *Github API* untuk mem-Push kode tersebut (membuat Pull Request), dan memanggil *Jira API* untuk meninggalkan komentar: *"Automation script berhasil di-generate dan lulus tes"*.

---

## 3. Topologi Docker Compose (Homelab)

Hanya butuh 2 layanan utama di `docker-compose.yml`:
```yaml
version: '3.8'
services:
  app:
    build: .
    ports: ["3000:3000"]
    env_file: .env
    volumes:
      - ./data:/app/data        # Menyimpan db.sqlite3 (State & RAG)
      - ./output:/app/output    # Menyimpan file .csv & .spec.ts
      - /var/run/docker.sock:/var/run/docker.sock # Akses Docker Sandbox (Self-Healing)
      - ./instructions:/app/instructions # Mount folder aturan QA
    depends_on:
      - redis

  redis:
    image: redis:alpine
    ports: ["6379:6379"]
    volumes:
      - redis_data:/data
      
volumes:
  redis_data:
```

> [!TIP]
> **Otonom di Lingkungan Terbatas**  
> Konsep "Autonomous" (Mode 3) tetap hadir sepenuhnya karena inti logika *Self-Healing* dan integrasi Webhook + Git ada di dalam *source code* (LangGraph), bukan bergantung pada hardware besar. 
> 
> Dengan plan ini, server Homelab Anda bisa beroperasi 24 jam nonstop melayani Webhook Jira layaknya "karyawan robot", tanpa menghabiskan banyak RAM!
