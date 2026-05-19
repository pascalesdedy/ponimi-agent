import { AgentState } from "../state";

/**
 * Node: Generate Playwright
 * Fungsi: Menerima CSV Test Case yang sudah disetujui, membaca instruksi kustom, dan men-generate Playwright Script.
 * @param state State agen saat ini
 * @returns State yang diperbarui dengan kode Playwright
 */
export const generatePlaywright = async (state: AgentState): Promise<Partial<AgentState>> => {
  // TODO: Muat instruksi dari instructions/automation/
  // TODO: Panggil LLM dengan input CSV Test Case + Instruksi untuk menghasilkan script Playwright
  
  return {
    currentStep: "Menghasilkan Script Playwright...",
    // playwrightCode: "<HASIL SCRIPT>"
  };
};
