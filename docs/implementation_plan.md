# Rencana Implementasi: Enterprise QA Agent (Self-Hosted & Cloud-Ready)

Rencana ini adalah versi pamungkas yang tidak hanya mendukung **Big Corporate / Big Data**, tetapi juga **100% Data Privacy via Self-Hosting (On-Premise)**. Perusahaan tidak perlu mengirimkan data konfidensial mereka ke server Cloud atau API pihak ketiga.

---

## 1. Arsitektur Self-Hosted Berbasis Docker
Seluruh infrastruktur agen ini akan dibungkus ke dalam *Docker containers* yang bisa di-deploy ke server internal (Bare Metal) maupun private Kubernetes cluster menggunakan **Docker Compose**.

### Ekosistem Container:
- **Node.js API Server**: Mendengarkan Webhook Jira (Container 1).
- **Node.js Worker**: Pekerja *background* yang mengeksekusi LangGraph (Container 2).
- **Redis**: *Message broker* untuk antrian (Container 3).
- **PostgreSQL**: *Database Checkpointer* penyimpan State graf (Container 4).

### Alternatif Self-Hosted untuk Layanan Cloud:
1. **Local Object Storage (Pengganti AWS S3)**: Menggunakan **MinIO**. Sifatnya persis seperti S3 API, namun berjalan di server internal untuk menyimpan file CSV & Playwright.
2. **Local Vector Database (Pengganti Pinecone/Cloud DB)**: Menggunakan **ChromaDB** atau **Milvus** via Docker. Menyimpan seluruh data RAG (dokumen Confluence, bug lama) di internal server.
3. **Local LLM (Pengganti OpenAI/Claude)**: Mendukung integrasi dengan **Ollama** atau **vLLM**. Perusahaan bisa menjalankan model *open-source* raksasa (seperti *Llama-3* atau *DeepSeek-Coder*) di atas server ber-GPU milik mereka sendiri, sehingga 0 byte data keluar ke internet publik.

---

## FASE 1: Fondasi Docker & Local LLM
1. **Konfigurasi `docker-compose.yml`**:
   - Men-setup koneksi container untuk Redis, Postgres, MinIO, dan ChromaDB.
2. **Integrasi Local LLM (`llmFactory.js`)**:
   - Menambahkan *adapter* LangChain untuk **Ollama**.
   - Contoh di `.env`: `LLM_PROVIDER=ollama`, `OLLAMA_BASE_URL=http://localhost:11434`, `LLM_MODEL=deepseek-coder:33b`.

---

## FASE 2: Job Queue & State Persistence
1. **BullMQ Integration**: *Worker* dikemas dalam image Docker terpisah (`Dockerfile.worker`) untuk horizontal scaling.
2. **LangGraph Postgres Checkpointer**: Setup migrasi tabel PostgreSQL otomatis saat container dijalankan.

---

## FASE 3: Local RAG (Big Data Internal) & MinIO
1. **Vector DB Setup (ChromaDB)**: 
   - Memasukkan (*ingest*) dokumen internal perusahaan dengan mengubahnya menjadi vektor *embeddings* menggunakan model *Local Embeddings* (misal: Nomic Embed Text).
2. **MinIO S3 Compatible Storage**:
   - Skrip penyimpanan file akan langsung menembak API MinIO internal. Jika URL di-generate, URL tersebut menunjuk ke IP internal perusahaan (misal: `http://10.0.0.5:9000/qa-artifacts/test.csv`).

---

## FASE 4: Eksekusi Otonom berskala Besar (Self-Healing K8s/Docker)
1. **Docker-in-Docker (DinD)**:
   - Worker QA Agent akan mem-build container sementara (*ephemeral*) berisi *Playwright Docker Image* resmi dari Microsoft untuk mengeksekusi *test script* secara terisolasi dan mandiri. Ini memastikan *self-healing* loop berjalan sangat aman tanpa merusak server *host*.

> [!TIP]
> **Privasi Maksimal (Air-Gapped Ready)**  
> Dengan setup **Self-Hosted** (Ollama + MinIO + ChromaDB + Postgres), aplikasi ini bisa dijalankan secara *Air-Gapped* (tanpa koneksi internet sama sekali!). Semua data rahasia Jira, kode sumber, dan dokumentasi perusahaan akan tetap berada di dalam dinding *firewall* internal perusahaan Anda selamanya.
>
> Rencana arsitektur tertinggi (*Peak Enterprise*) sudah siap. Tolong konfirmasi apakah kita sudah bisa mengunci (*lock*) desain ini!
