# 🤖 Ponimi Agent — Homelab QA Agent CLI

Autonomous QA Agent berbasis **LangGraph** dan **Playwright** yang dirancang untuk lingkungan *Homelab* atau *Small VPS* dengan overhead minimal.

## ✨ Fitur Utama

- **3 Mode Operasi**: Manual, Semi-Autonomous, dan Full Autonomous
- **Self-Healing**: Jika test gagal, agen memperbaiki script sendiri (maks 3x retry)
- **CLI-first**: Semua interaksi via command line dengan progress tracking real-time
- **Instruksi Kustom**: Folder `.md` terpisah untuk aturan generate test case & automation script
- **Queue System**: BullMQ + Redis untuk background job processing
- **Lightweight**: Hanya butuh Redis (~20MB RAM) — tanpa Postgres, ChromaDB, atau Ollama

## 📁 Struktur Proyek

```
ponimi-agent/
├── src/
│   ├── cli.ts                  # Entrypoint CLI (commander + clack/prompts)
│   ├── config/
│   │   └── env.ts              # Validasi environment variables (Zod)
│   ├── db/
│   │   └── sqlite.ts           # Checkpointer untuk LangGraph state
│   ├── agent/
│   │   ├── state.ts            # Definisi AgentState
│   │   ├── graph.ts            # Workflow LangGraph (conditional edges)
│   │   └── nodes/
│   │       ├── extractRequirements.ts  # Baca Jira & instruksi lokal
│   │       ├── generateCsv.ts          # Generate CSV Test Cases via LLM
│   │       ├── generatePlaywright.ts   # Generate Playwright script via LLM
│   │       ├── executeTest.ts          # Eksekusi di Docker sandbox
│   │       └── reportResults.ts        # Push ke Github & komentar Jira
│   └── queue/
│       ├── worker.ts           # BullMQ worker (background job)
│       └── publisher.ts        # Masukkan job ke antrian
├── instructions/
│   ├── testcases/              # Instruksi kustom untuk generate test cases
│   └── automation/             # Instruksi kustom untuk generate Playwright script
├── docs/
│   └── homelab_plan.md         # Arsitektur & rencana implementasi
├── docker-compose.yml          # Redis service
├── package.json
└── tsconfig.json
```

## 🚀 Quick Start

### Prerequisites

- Node.js v20+ (LTS disarankan)
- Docker & Docker Compose (untuk Redis dan sandbox)

### Instalasi

```bash
git clone https://github.com/pascalesdedy/ponimi-agent.git
cd ponimi-agent
npm install
```

### Konfigurasi

Buat file `.env` di root proyek:

```env
# Pilih salah satu (atau lebih) LLM Provider
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...

# Redis (default: localhost)
REDIS_URL=redis://localhost:6379

# Jira (opsional, untuk Mode 3)
JIRA_API_TOKEN=...
JIRA_DOMAIN=your-domain.atlassian.net

# Github (opsional, untuk auto-push)
GITHUB_TOKEN=ghp_...
```

### Penggunaan CLI

```bash
# Jalankan agen untuk tiket Jira tertentu (Mode 1/2)
npm run cli run --ticket QA-123

# Setujui CSV dan lanjutkan eksekusi
npm run cli approve --thread <THREAD_ID>

# Jalankan background worker untuk mode Autonomous
npm run cli worker
```

## 🏗️ Arsitektur

### Tiga Mode Operasi

| Mode | Deskripsi | Human Intervention |
|------|-----------|-------------------|
| **Manual** | User kontrol penuh, pause di setiap tahap | ✅ Review CSV + Script |
| **Semi-Autonomous** | Pause hanya di CSV review, self-healing aktif | ✅ Review CSV saja |
| **Full Autonomous** | End-to-end tanpa intervensi, via background worker | ❌ Tidak ada |

### Alur LangGraph

```
extractRequirements → generateCsv → [PAUSE/Review] → generatePlaywright → executeTest → reportResults
                                                              ↑                    │
                                                              └── Self-Healing ────┘
                                                                  (maks 3x retry)
```

## 🐳 Docker

```bash
# Jalankan Redis
docker compose up -d

# Jalankan agent
npm run cli run --ticket QA-123
```

## 📝 Dokumentasi

- [Homelab Plan](docs/homelab_plan.md) — Arsitektur lengkap dan rencana implementasi

## 📄 License

MIT
