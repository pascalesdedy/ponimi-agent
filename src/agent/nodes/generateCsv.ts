import { AgentState } from "../state";

/**
 * Node: Generate CSV
 * Fungsi: Menggunakan LLM untuk mengubah requirement menjadi test case berformat CSV.
 * @param state State agen saat ini
 * @returns State yang diperbarui dengan CSV Test Cases
 */
export const generateCsv = async (state: AgentState): Promise<Partial<AgentState>> => {
  // TODO: Panggil LLM (OpenAI/Anthropic) dengan prompt untuk menghasilkan CSV
  
  return {
    currentStep: "Menghasilkan CSV Test Cases...",
    // csvTestCases: "<HASIL CSV>"
  };
};
