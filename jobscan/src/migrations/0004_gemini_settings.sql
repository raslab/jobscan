-- Migrate LLM settings from Ollama to Google Gemini
-- Add gemini_api_key setting (empty by default — user must set it in UI)
INSERT OR IGNORE INTO crm_settings (key, value) VALUES ('gemini_api_key', '');

-- Update default model to gemini-2.5-flash for existing DBs that still have the old Ollama default
UPDATE crm_settings SET value = 'gemini-2.5-flash'
  WHERE key = 'llm_model' AND value IN ('llama3.1:8b', 'llama3.2', 'llama3:8b', 'llama3', 'mistral');
