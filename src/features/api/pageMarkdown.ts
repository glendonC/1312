import type { ApiEndpointGroup } from "./model.ts";

/** Markdown snapshot of an endpoint group for “Copy page” / LLM paste. */
export const endpointGroupMarkdown = (group: ApiEndpointGroup): string => {
  const lines: string[] = [`# ${group.title}`, ""];
  if (group.note) {
    lines.push(group.note, "");
  }
  for (const endpoint of group.endpoints) {
    lines.push(`## ${endpoint.methods.join(" · ")} \`${endpoint.path}\``, "", endpoint.summary, "");
    if (endpoint.responseSchema) {
      lines.push(`Response schema: \`${endpoint.responseSchema}\``, "");
    }
    for (const table of endpoint.fieldTables) {
      lines.push(`### ${table.title}`, "");
      for (const field of table.fields) {
        const req = field.required ? ", required" : "";
        lines.push(`- \`${field.name}\` (${field.type}${req}): ${field.note}`);
      }
      lines.push("");
    }
    for (const panel of endpoint.panels) {
      const fence = panel.kind === "request" ? "bash" : "json";
      lines.push(`### ${panel.title}`, "", "```" + fence, panel.body, "```", "");
    }
  }
  return `${lines.join("\n").trim()}\n`;
};
