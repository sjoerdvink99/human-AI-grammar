export const starters = [
  { label: "a prompt", expression: "(prompt_1: instruction language)\n" },
  { label: "a document", expression: "(document_1: artifact language)\n" },
  { label: "data", expression: "(data_1: artifact structured)\n" },
  { label: "an image", expression: "(image_1: artifact visual)\n" },
];

const tips = [
  {
    text: "Describe the system in a few sentences first. The expressions record the structure; the descriptions tell whoever implements it what the system is for.",
  },
  {
    text: "Start from what exists before the system acts: a prompt, a document, data, or a selection.",
    example: "(prompt_1: instruction language)",
  },
  {
    text: "Add one transformation at a time: who acts, what they do, and what results.",
    example: "-> [model generate]~ -> (draft_1: artifact language)",
  },
  {
    text: "Reuse an identifier while the information is unchanged and raise its version once it changes. Shared identifiers are what connect processes.",
    example: "(draft_1: …) -> [human modify] -> (draft_2: …)",
  },
  {
    text: "Mark generative steps with ~. These are the steps where people need to review or choose.",
    example: "[model evaluate]~",
  },
  {
    text: "Say under Representations what each identifier contains. The grammar records its kind; the description records its content and constraints.",
    example: "story: a short story, only about cats or dogs",
  },
  {
    text: "Give each mode of interaction its own process and describe it in plain words: what happens and when. A loop is one iteration plus a sentence on when it repeats.",
  },
  {
    text: "Pick a next step under Then, ranked by how often it follows a similar state in published systems.",
  },
];

export function Guide() {
  return (
    <details className="mb-4 rounded border border-line px-3 py-2 text-[13px]">
      <summary className="cursor-pointer text-xs font-medium text-muted select-none hover:text-ink">How to design with the grammar</summary>
      <ol className="mt-2 mb-1 space-y-1.5">
        {tips.map(({ text, example }, index) => (
          <li key={text} className="grid grid-cols-[1.25rem_1fr] gap-x-2">
            <span className="font-mono text-xs leading-5 text-faint tabular-nums">{index + 1}</span>
            <span>
              {text}
              {example && <span className="ml-2 font-mono text-xs text-muted">{example}</span>}
            </span>
          </li>
        ))}
      </ol>
    </details>
  );
}
