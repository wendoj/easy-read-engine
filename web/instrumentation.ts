// Runs once when the Next.js server starts. Fails start-up on bad model
// config, including any gemini: entry when APP_ENV=production.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { loadModelConfig } = await import("./src/llm/config");
    loadModelConfig(process.env);
  }
}
