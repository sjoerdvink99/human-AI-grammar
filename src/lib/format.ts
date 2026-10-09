export function formatAuthors(authors: string[], max = 3): string {
  if (authors.length <= max) return authors.join(", ");
  return `${authors.slice(0, max).join(", ")} et al.`;
}

export function shortAuthors(authors: string[]): string {
  const surname = (author: string) => author.trim().split(/\s+/).at(-1) ?? author;
  if (authors.length === 0) return "";
  if (authors.length === 1) return surname(authors[0]);
  if (authors.length === 2) return `${surname(authors[0])} & ${surname(authors[1])}`;
  return `${surname(authors[0])} et al.`;
}

export function formatScore(value: number): string {
  return value.toFixed(2);
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

export const processNumber = (index: number) => String(index + 1).padStart(2, "0");

export const processAnchor = (index: number) => `process-${processNumber(index)}`;
