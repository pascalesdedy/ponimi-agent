# 🤖 Ponimi Agent — QA Test Automation Agent

Autonomous QA Agent berbasis **LLM** (DeepSeek) + **Playwright** + **BullMQ**. Generate test cases dan Playwright script otomatis dari deskripsi atau URL, lalu eksekusi di Docker sandbox.

> **Untuk klien**: clone → setup → jalanin. No AI assistant required.

---

## ✨ Fitur

- **Input fleksibel**: URL target + deskripsi bebas, atau ticket ID + file instruksi
- **Self-healing**: 3x retry dengan regenerasi script jika test gagal
- **Sandbox execution**: Test dijalankan di Docker container terisolasi
- **CLI + Webhook**: Pake command line atau HTTP API
- **Background queue**: BullMQ + Redis — enqueue, check status kapan aja
- **Real LLM**: DeepSeek (atau OpenAI) buat generate test case + script

---

## 🚀 Quick Start

### Prasyarat

- Node.js v20+
- Docker
- Redis (bisa pake `docker compose up -d`)

### 1. Instalasi

```bash
git clone https://github.com/pascalesdedy/ponimi-agent.git
cd ponimi-agent
cp .env.example .env
npm install
npx tsc
```

### 2. Konfigurasi

Edit `.env`:

```env
# WAJIB: API Key LLM (pilih salah satu)
DEEPSEEK_API_KEY=sk-your-key-here
# OPENAI_API_KEY=...
# ANTHROPIC_API_KEY=...
# LLM_PROVIDER=deepseek|openai|anthropic

# Redis (pakai password)
REDIS_URL=redis://:ponimi-dev-password@localhost:6379

# Webhook security
WEBHOOK_API_KEY=change-me-webhook-key
PONIMI_ALLOWED_ORIGINS=http://localhost:3000
WEBHOOK_MAX_BODY_BYTES=65536
WEBHOOK_RATE_LIMIT_PER_MINUTE=10
```

### 3. Build Docker Sandbox

```bash
docker build -t ponimi-playwright:latest -f docker/Dockerfile.playwright docker/
```

### 4. Start Redis

```bash
docker compose up -d
```

---

## 🎮 CLI Usage

### Run langsung (foreground)

```bash
# URL + deskripsi
node dist/cli.js run -u https://staging.example.com -d "Test login page with Google SSO"

# URL + ticket ID
node dist/cli.js run -t AUTH-123 -u https://staging.example.com

# Mode khusus (manual / semi / auto)
node dist/cli.js run -t AUTH-123 -u https://staging.example.com -m auto
```

### Enqueue background job

```bash
# Enqueue — worker akan proses di background
node dist/cli.js enqueue -t AUTH-123 -u https://staging.example.com -d "Test login" -m auto
```

### Cek status job

```bash
node dist/cli.js status <JOB_ID>
```

---

## 🌐 Webhook API

Start server:

```bash
node dist/scripts/webhook-server.js
```

Default port **3123**.

| Endpoint | Method | Body | Description |
|---|---|---|---|
| `/health` | GET | — | Health check |
| `/run` | POST | `{ ticketId, targetUrl?, description?, mode? }` | Enqueue QA job (auth required) |
| `/status/:id` | GET | — | Check job status |

Contoh:

```bash
curl -X POST http://localhost:3123/run \
  -H "X-Ponimi-Key: change-me-webhook-key" \
  -H "Content-Type: application/json" \
  -d '{"ticketId":"LOGIN-TEST","targetUrl":"https://staging.example.com","description":"Test login flow","mode":"auto"}'
```

---

## ⚙️ Production (systemd)

Untuk auto-start worker + webhook di VPS:

```bash
# Worker
sudo cp deploy/ponimi-worker.service /etc/systemd/system/
sudo systemctl enable --now ponimi-worker.service

# Webhook
sudo cp deploy/ponimi-webhook.service /etc/systemd/system/
sudo systemctl enable --now ponimi-webhook.service
```

> Pastiin `DEEPSEEK_API_KEY` ada di environment atau di `/etc/ponimi.env`

---

## 🏗️ Arsitektur

```
┌──────────┐     ┌──────────────┐     ┌─────────────┐
│   CLI    │────▶│   Publisher   │────▶│   Redis     │
│ Webhook  │     │  (BullMQ)    │     │   Queue     │
└──────────┘     └──────────────┘     └──────┬──────┘
                                             │
                                    ┌────────▼────────┐
                                    │    Worker        │
                                    │  (BullMQ)        │
                                    └────────┬────────┘
                                             │
                    ┌────────────────────────▼──────────────────┐
                    │              LangGraph Pipeline            │
                    │                                            │
                    │  extractRequirements → generateCsv         │
                    │         → generatePlaywright               │
                    │         → validateGeneratedCode            │
                    │         → executeTest → reportResults      │
                    │              ↑                 │           │
                    │              └── self-heal ────┘           │
                    └────────────────────────────────────────────┘
                                             │
                                    ┌────────▼────────┐
                                    │  Docker Sandbox  │
                                    │ (Playwright)     │
                                    └──────────────────┘
```

### Output

Semua hasil ada di folder `output/`:

```
output/
├── <TICKET>.spec.ts          # Playwright test script
├── <TICKET>-testcases.csv     # Generated test cases
├── <TICKET>-report.md         # Test execution report
└── <TICKET>-report.txt        # Plain text report
```

---

## 📝 License

MIT
