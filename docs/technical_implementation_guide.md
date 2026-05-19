# Deep-Dive Technical Implementation Guide: Enterprise QA Agent

Dokumen ini adalah *Blueprint* teknis tingkat lanjut yang mendetailkan arsitektur, struktur folder, skema data, dan cuplikan kode krusial untuk membangun sistem QA Agent berskala Enterprise.

---

## 📂 1. Arsitektur Struktur Folder (Directory Tree)
Aplikasi akan distrukturkan dalam arsitektur berbasis *Domain-Driven Design (DDD)* sederhana.
```text
ponimi-qa-agent/
├── docker-compose.yml        # Konfigurasi container infrastruktur (Redis, Postgres, dll)
├── .env                      # Variabel lingkungan rahasia
├── package.json
├── instructions/             # Folder Custom Instructions (Bisa diedit user)
│   ├── testcase_rules.md     # Aturan penulisan CSV Test Case
│   └── playwright_rules.md   # Aturan coding konvensi Playwright
├── src/
│   ├── index.js              # Entry point untuk API Server (Express)
│   ├── worker.js             # Entry point untuk Background Worker (BullMQ)
│   ├── config/
│   │   ├── db.js             # Koneksi PostgreSQL (Pool)
│   │   ├── redis.js          # Koneksi Redis
│   │   └── minio.js          # Koneksi AWS S3 / MinIO SDK
│   ├── ai/
│   │   ├── llmFactory.js     # Switcher OpenAI/Claude/Ollama
│   │   ├── qaGraph.js        # Inti logika LangGraph (Nodes & Edges)
│   │   ├── prompts.js        # Template System Prompts
│   │   └── tools/            # Custom LangChain Tools (JiraFetch, VectorSearch)
│   ├── queue/
│   │   ├── producer.js       # Fungsi menambahkan job ke BullMQ
│   │   └── processor.js      # Fungsi mengeksekusi qaGraph dari job BullMQ
│   ├── routes/
│   │   └── qa.routes.js      # Endpoint Webhooks & REST API
│   ├── services/
│   │   ├── jiraService.js    # Interaksi Jira API (Axios)
│   │   ├── ragService.js     # Interaksi ChromaDB (Embeddings)
│   │   └── executionService.js # Docker-in-Docker runner (Playwright)
```

---

## ⚙️ 2. Detail Implementasi LangGraph (`src/ai/qaGraph.js`)

Inilah inti kecerdasan agen. Kita mendefinisikan *State* dan *Graph*.

### 2.1. Definisi State (Memori Agen)
```javascript
const { StateGraph } = require("@langchain/langgraph");

// State adalah memori yang akan di-save ke PostgreSQL Checkpointer
const graphState = {
  ticketId: { value: (x, y) => y, default: () => null },
  requirementContext: { value: (x, y) => y, default: () => "" },
  testCasesCsv: { value: (x, y) => y, default: () => "" },
  playwrightCode: { value: (x, y) => y, default: () => "" },
  executionLog: { value: (x, y) => y, default: () => "" },
  retryCount: { value: (x, y) => y, default: () => 0 },
  status: { value: (x, y) => y, default: () => "init" } // init, pending_review, success, error
};
```

### 2.2. Definisi Graf (Workflow)
```javascript
const workflow = new StateGraph({ channels: graphState })
  .addNode("gather_context", gatherContextNode)      // Scrape Jira & RAG Vector DB
  .addNode("generate_testcases", generateCsvNode)    // Baca instruksi .md -> Buat CSV
  .addNode("generate_playwright", generateCodeNode)  // Baca instruksi .md -> Buat Code
  .addNode("execute_test", executeSandboxNode)       // Run Docker-in-Docker
  .addNode("report_results", autoReportNode);        // Push PR Github & Komen Jira

// Edge Dasar
workflow.addEdge("gather_context", "generate_testcases");
workflow.addEdge("generate_testcases", "generate_playwright");
workflow.addEdge("generate_playwright", "execute_test");

// Conditional Edge (Self-Healing Loop)
workflow.addConditionalEdges("execute_test", (state) => {
  if (state.status === "error" && state.retryCount < 3) return "generate_playwright"; // Loop kembali!
  return "report_results"; // Jika sukses atau jatah retry habis
}, {
  "generate_playwright": "generate_playwright",
  "report_results": "report_results"
});

// Setup Postgres Checkpointer (Penting untuk Enterprise)
const { PostgresSaver } = require("@langchain/langgraph-checkpoint-postgres");
const checkpointer = new PostgresSaver(dbPool);
const qaAgent = workflow.compile({ checkpointer });
```

---

## 🐳 3. Detail Eksekusi Terisolasi (Docker-in-Docker Sandbox)

Untuk menguji kode Playwright secara aman (mencegah eksploitasi RCE ke server utama), `executionService.js` akan menyewa *container* kosong sebentar.

```javascript
const Docker = require('dockerode');
const docker = new Docker(); // Akses /var/run/docker.sock dari host

async function runPlaywrightSandbox(codeString) {
  // 1. Simpan codeString ke temporary file (misal /tmp/test-runner/test.spec.ts)
  
  // 2. Spin-up container khusus Playwright dari Microsoft
  const container = await docker.createContainer({
    Image: 'mcr.microsoft.com/playwright:v1.44.0-jammy',
    Cmd: ['npx', 'playwright', 'test', '/tests/test.spec.ts'],
    HostConfig: {
      Binds: ['/tmp/test-runner:/tests'] // Mount file dari host ke container
    }
  });

  await container.start();
  // 3. Tangkap output terminal (stdout/stderr)
  const stream = await container.logs({ follow: true, stdout: true, stderr: true });
  // 4. Analisis Exit Code
  const { StatusCode } = await container.wait();
  await container.remove(); // Bersihkan container (ephemeral)

  return {
    isSuccess: StatusCode === 0,
    terminalOutput: bufferToString(stream)
  };
}
```

---

## 📡 4. Skema API & Job Queue (BullMQ)

Express API TIDAK menjalankan graf secara langsung. Ia hanya menerima Webhook, memvalidasi payload, lalu memasukkannya ke antrian Redis.

### 4.1. Endpoint Jira Webhook (`src/routes/qa.routes.js`)
```javascript
router.post('/api/webhook/jira', async (req, res) => {
  const payload = req.body;
  // Cek jika status tiket berubah jadi "Ready for QA"
  if (payload.transition.to_status === 'Ready for QA') {
    const ticketId = payload.issue.key;
    
    // Masukkan ke Antrian (Queue)
    await qaQueue.add('process-qa-agent', {
      ticketId: ticketId,
      mode: 'autonomous' // Force mode auto
    });
    
    return res.status(202).json({ message: "Job accepted to queue" });
  }
});
```

### 4.2. Worker Processor (`src/queue/processor.js`)
Proses yang berjalan di *background* memakan job dari Redis.
```javascript
const { Worker } = require('bullmq');

const worker = new Worker('QA_QUEUE', async job => {
  const { ticketId } = job.data;
  const config = { configurable: { thread_id: `qa-${ticketId}` } };
  
  // LangGraph akan otomatis melanjutkan pekerjaan jika thread_id sudah ada di DB
  await qaAgent.invoke({ ticketId: ticketId }, config);
}, { connection: redisConnection });
```

---

## 🧠 5. Detail RAG Ingestion (ChromaDB + Nomic)

Untuk dokumen "Big Data", kita membuat skrip `src/services/ragService.js`.
1. Agen menggunakan `@langchain/community/document_loaders` (misal `ConfluencePagesLoader`) untuk mendownload ribuan dokumen PRD.
2. Memotong teks (Text Chunking) dengan `RecursiveCharacterTextSplitter`.
3. Mengubah teks jadi angka (Embeddings) menggunakan LLM lokal (misal: *Ollama Nomic-Embed-Text*).
4. Menyimpan ke ChromaDB. 
5. Saat node `gatherContextNode` bekerja, ia memanggil Retriever:
```javascript
const vectorStore = await Chroma.fromExistingCollection(new OllamaEmbeddings(), { collectionName: "qa_knowledge" });
const relevantDocs = await vectorStore.similaritySearch(`Past bugs and test cases for ${ticketFeature}`, 3);
```

### 1.3. Konfigurasi `llmFactory.js` (Multi-Provider Support)
Buat *factory* pendeteksi LLM yang sangat dinamis. Aplikasi bisa di-switch antara Lokal (privasi 100%) dan Cloud (akurasi/kecepatan maksimal) hanya lewat `.env`.
```javascript
const { ChatOllama } = require("@langchain/community/chat_models/ollama");
const { ChatOpenAI } = require("@langchain/openai");
const { ChatAnthropic } = require("@langchain/anthropic");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");

function getLLM() {
  const provider = process.env.LLM_PROVIDER || 'openai'; // default to openai

  switch(provider) {
    case 'ollama':
      return new ChatOllama({
        baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
        model: process.env.OLLAMA_MODEL || "deepseek-coder",
      });
    case 'anthropic':
      return new ChatAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    case 'gemini':
      return new ChatGoogleGenerativeAI({ apiKey: process.env.GOOGLE_API_KEY });
    case 'deepseek':
      return new ChatOpenAI({
        configuration: { baseURL: "https://api.deepseek.com/v1" },
        openAIApiKey: process.env.DEEPSEEK_API_KEY,
        modelName: "deepseek-chat"
      });
    case 'openai':
    default:
      return new ChatOpenAI({ openAIApiKey: process.env.OPENAI_API_KEY });
  }
}
```

> [!IMPORTANT]  
> Cetak biru teknis ini dirancang untuk menangani beban tinggi secara *asinkron*. Komponen dipisah-pisah (API, Worker, Database, Storage) sesuai dengan standar *Microservices* di Enterprise.
