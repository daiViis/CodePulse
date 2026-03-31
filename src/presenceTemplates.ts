import { PresenceTemplateContext } from "./types";

const SUPPORTED_VARIABLES = /\{(username|project|phase)\}/g;

export function renderPresenceTemplate(
  template: string,
  fallbackTemplate: string,
  context: PresenceTemplateContext
): string {
  const normalizedTemplate = typeof template === "string" && template.trim() ? template.trim() : fallbackTemplate;

  try {
    const rendered = normalizedTemplate.replace(SUPPORTED_VARIABLES, (_match, variable: keyof PresenceTemplateContext) => {
      return context[variable] ?? "";
    });

    const normalizedOutput = rendered.replace(/\s+/g, " ").trim();
    if (normalizedOutput) {
      return normalizedOutput;
    }
  } catch {
    // Fall back to the default template below.
  }

  return fallbackTemplate.replace(SUPPORTED_VARIABLES, (_match, variable: keyof PresenceTemplateContext) => {
    return context[variable] ?? "";
  });
}
