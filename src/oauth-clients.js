// Public client identifiers only. Never add client secrets to the extension package.
export const DISTRIBUTION_OAUTH_CLIENT_IDS = Object.freeze({
  // Temporary compatibility dependency: this is the public Codex CLI client ID.
  // Replace it when OpenAI documents a client registration path for third-party extensions.
  codex: "app_EMoamEEZ73f0CkXaXp7hrann",
  // Temporary compatibility dependency: this public GitHub Copilot client ID was used by
  // earlier WebClaw builds. Distributors should replace it with an app they control.
  githubCopilot: "Iv1.b507a08c87ecfe98"
});
