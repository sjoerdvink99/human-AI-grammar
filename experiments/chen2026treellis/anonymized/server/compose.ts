// tool compose steps: build the instruction records r2 (processes 1, 6) and r15 (process 5),
// and turn each record into a prompt for callModel().
import { DSL_SPEC } from '../shared/dsl';

/** r2: request to generate a whole program. r2_1 has no current_code; r2_2 (process 6) does. */
export interface GenerateRequest {
  task: 'generate';
  instruction: string; // r1 or r16
  current_code?: string; // r3_1 (process 6 only)
  dsl_spec: string;
}

/** r15: request to modify one extracted snippet. */
export interface SnippetRequest {
  task: 'modify_snippet';
  instruction: string; // r13
  snippet: string; // r14_1
  selection: { node_id: string; start_line: number; end_line: number }; // r12
  context_code: string; // r3_1
  dsl_spec: string;
}

export function composeGenerateRequest(instruction: string, currentCode?: string): GenerateRequest {
  return { task: 'generate', instruction, current_code: currentCode || undefined, dsl_spec: DSL_SPEC };
}

export function composeSnippetRequest(
  instruction: string,
  snippet: string,
  selection: SnippetRequest['selection'],
  contextCode: string,
): SnippetRequest {
  return { task: 'modify_snippet', instruction, snippet, selection, context_code: contextCode, dsl_spec: DSL_SPEC };
}

const SYSTEM_BASE = `You write programs in the Shape DSL described below. You never explain; you answer with exactly one fenced code block tagged shape.

${DSL_SPEC}`;

export function generatePrompt(r: GenerateRequest): { system: string; prompt: string } {
  if (!r.current_code) {
    return {
      system: SYSTEM_BASE,
      prompt: `Write a complete Shape DSL program that draws the following.
Use groups for meaningful parts, give every element a descriptive name, and expose 3-8 useful parameters (sizes with [min, max] ranges, main colours) that the elements refer to.

Description:
${r.instruction}`,
    };
  }
  return {
    system: SYSTEM_BASE,
    prompt: `Here is the current program:
\`\`\`shape
${r.current_code}
\`\`\`

Rewrite the complete program to apply this change to the whole drawing. Keep element names, structure and parameters that the change does not concern.

Change:
${r.instruction}`,
  };
}

export function snippetPrompt(r: SnippetRequest): { system: string; prompt: string } {
  return {
    system: SYSTEM_BASE,
    prompt: `Full program, for context only:
\`\`\`shape
${r.context_code}
\`\`\`

The selected element "${r.selection.node_id}" is defined by these lines (${r.selection.start_line}-${r.selection.end_line}):
\`\`\`shape
${r.snippet}
\`\`\`

Return ONLY the replacement for those selected lines, applying the change below. It may be one or more elements or a group; it must not contain canvas or param lines; it may use the existing parameters. Keep the element's name unless the change requires otherwise.

Change:
${r.instruction}`,
  };
}

/** Pull the code out of the model's answer. */
export function extractCodeBlock(answer: string): string {
  const m = /```(?:shape|[a-z]*)?\s*\n([\s\S]*?)```/i.exec(answer);
  return (m ? m[1] : answer).replace(/\s+$/, '');
}
