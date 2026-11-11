// Runs once when the Next.js server starts. Fails start-up on bad model
// config, including any gemini: entry when APP_ENV=production.
//
// Throwing alone isn't enough: the standalone server.js logs "Failed to
// prepare server" and keeps listening (seen in the task 32 Docker check). So
// on a config error the process exits with code 1, and the container stops.
// The message names the env variable only, never a key.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { loadModelConfig, ModelConfigError } = await import("./src/llm/config");
    try {
      loadModelConfig(process.env);
    } catch (error) {
      if (error instanceof ModelConfigError) {
        console.error(`Refusing to start: ${error.message}`);
        process.exit(1);
      }
      throw error;
    }
  }
}
