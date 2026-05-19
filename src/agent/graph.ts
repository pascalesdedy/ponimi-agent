import { StateGraph, END, START } from "@langchain/langgraph";
import { AgentStateAnnotation, AgentState } from "./state";
import { extractRequirements } from "./nodes/extractRequirements";
import { generateCsv } from "./nodes/generateCsv";
import { generatePlaywright } from "./nodes/generatePlaywright";
import { executeTest } from "./nodes/executeTest";
import { reportResults } from "./nodes/reportResults";

// Fungsi untuk router/conditional edge
const routeAfterCsv = (state: AgentState) => {
  // Jika autonomous (Mode 3), bypass jeda dan langsung generate playwright
  if (state.mode === 'autonomous') {
    return 'generatePlaywright';
  }
  // Mode 1 (Manual) & Mode 2 (Semi), interrupt/pause untuk review manusia
  return '__end__'; // Sebenarnya kita akan menggunakan `interruptBefore` di kompilasi graf
};

const routeAfterExecution = (state: AgentState) => {
  // Jika berhasil (tidak ada error), lanjut ke step selanjutnya
  if (!state.executionError) {
    // Jika Mode 3 (Auto), lapor hasil
    if (state.mode === 'autonomous') {
      return 'reportResults';
    }
    // Jika Mode 1/2, eksekusi selesai
    return END;
  }
  
  // Jika error tapi retry limit belum tercapai, perbaiki diri (self-healing)
  if (state.retryCount < 3) {
    return 'generatePlaywright';
  }
  
  // Jika gagal 3 kali beruntun, hentikan
  return END;
};

// Inisialisasi Graf
const workflow = new StateGraph(AgentStateAnnotation)
  .addNode("extractRequirements", extractRequirements)
  .addNode("generateCsv", generateCsv)
  .addNode("generatePlaywright", generatePlaywright)
  .addNode("executeTest", executeTest)
  .addNode("reportResults", reportResults)
  
  // Alur Awal
  .addEdge(START, "extractRequirements")
  .addEdge("extractRequirements", "generateCsv")
  
  // Percabangan setelah CSV dibuat
  .addConditionalEdges("generateCsv", routeAfterCsv, {
    generatePlaywright: "generatePlaywright",
    __end__: END // Placeholder jika kita tidak memakai mekanisme interupsi bawaan
  })
  
  // Dari Playwright langsung dieksekusi (jika bukan Mode 1 murni)
  .addEdge("generatePlaywright", "executeTest")
  
  // Percabangan Self-Healing
  .addConditionalEdges("executeTest", routeAfterExecution, {
    generatePlaywright: "generatePlaywright",
    reportResults: "reportResults",
    __end__: END
  })
  
  // Dari laporan hasil, grafik selesai
  .addEdge("reportResults", END);

// Compile Graph (Checkpointer akan di-inject saat pemanggilan instance graph)
export const app = workflow.compile({
  interruptBefore: ["generatePlaywright"], // Pause grafik di sini untuk menunggu persetujuan (Approve CSV)
});
