import { AgentState } from "../state";

/**
 * Node: Extract Requirements
 * Fungsi: Membaca input tiket Jira dan memuat instruksi tambahan dari file .md lokal.
 * @param state State agen saat ini
 * @returns State yang diperbarui (ticketData, instructions, currentStep)
 */
export const extractRequirements = async (state: AgentState): Promise<Partial<AgentState>> => {
  // TODO: Integrasikan dengan Jira API atau baca dari file instruksi kustom (instructions/testcases/)
  
  return {
    currentStep: "Mengambil requirements dari Jira dan memuat instruksi...",
    // ticketData: ...
    // instructions: ...
  };
};
