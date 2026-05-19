import { Annotation } from "@langchain/langgraph";

/**
 * Definisi State untuk agen QA Homelab.
 * State ini akan diteruskan dan diperbarui oleh setiap node di dalam graf.
 */
export const AgentStateAnnotation = Annotation.Root({
  // Data dari tiket Jira atau input awal pengguna
  ticketData: Annotation<string>(),

  // Instruksi spesifik tambahan (dari file .md di folder instruksi)
  instructions: Annotation<string>(),

  // CSV Test Cases yang digenerate oleh LLM
  csvTestCases: Annotation<string>(),

  // Script otomatisasi Playwright yang digenerate oleh LLM
  playwrightCode: Annotation<string>(),

  // Pesan error jika eksekusi Playwright gagal di sandbox
  executionError: Annotation<string | null>(),

  // Status eksekusi: 'not_run' | 'skipped' | 'passed' | 'failed'
  executionStatus: Annotation<string>(),

  // Jumlah percobaan perbaikan diri (self-healing retry)
  retryCount: Annotation<number>(),

  // Flag: disable self-heal (set when playwright not available)
  selfHealDisabled: Annotation<boolean>(),

  // Mode operasi agen saat ini
  mode: Annotation<'manual' | 'semi-autonomous' | 'autonomous'>(),

  // Progres langkah saat ini (digunakan untuk UX/CLI Spinner)
  currentStep: Annotation<string>(),

  // When execution started (ISO string)
  startTime: Annotation<string | null>(),

  // When execution ended (ISO string)
  endTime: Annotation<string | null>(),

  // History of self-healing attempts: [{retryCount, timestamp, error, status}]
  attemptHistory: Annotation<Array<{
    retryCount: number;
    timestamp: string;
    error: string | null;
    status: string;
  }>>(),
});

// Tipe statis untuk kemudahan pengetikan di Node
export type AgentState = typeof AgentStateAnnotation.State;
