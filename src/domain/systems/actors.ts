import type { ActorDetails } from "./types";

// One line per actor, such as "GPT-4o (gpt-4o-2024-08-06) · OpenAI · language model".
export function describeActor({ name, version, provider, kind }: ActorDetails): string {
  const title = name && version ? `${name} (${version})` : (name ?? version);
  return [title, provider, kind].filter(Boolean).join(" · ");
}
