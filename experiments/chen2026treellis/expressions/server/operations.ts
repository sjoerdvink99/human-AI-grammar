// Model operations. One prompt per operation, built only from the composed input record.
import type { GenerationInput, ScopedInput } from '../shared/compose';
import { canonicalize, parseNode, serializeNode, NODE_TYPES } from '../shared/scene';
import { callModel } from './model';

const LANGUAGE_SPEC = `SceneScript is a small declarative 3D scene language.

Grammar:
  node  := TYPE "name" attr* ( "{" node* "}" )?
  attr  := key=value          (no spaces around =)
  value := number | [x, y, z] | [w, d] | #rrggbb | "string"
Node types: ${NODE_TYPES.join(', ')}. Only 'scene' and 'group' may have children (in braces).
The whole scene is exactly one 'scene' node at the top level.

Attributes per type (all optional):
  scene:    background=#rrggbb
  group:    position rotation scale
  box:      size=[w, h, d]
  sphere:   radius
  cylinder: radius height
  cone:     radius height
  torus:    radius tube
  plane:    size=[w, d]   (horizontal, lies in the XZ plane)
  every primitive also: position rotation scale color opacity metalness roughness
position=[x, y, z] in metres, Y is up, the ground is y=0. Primitives are centred on their position
(a box of height h resting on the ground has y = h/2). rotation=[rx, ry, rz] in degrees.
scale=[sx, sy, sz]. Children of a group are positioned relative to the group.
Use descriptive, human-readable names. Group parts that belong together (e.g. a chair's legs).

Example:
scene "Small table" background=#20252b {
  plane "floor" size=[6, 6] color=#6b6f73
  group "table" position=[0, 0, 0] {
    box "top" size=[1.2, 0.05, 0.7] position=[0, 0.725, 0] color=#8b5a2b roughness=0.6
    group "legs" {
      cylinder "leg front left" radius=0.03 height=0.7 position=[-0.55, 0.35, 0.3] color=#3a3a3a
      cylinder "leg front right" radius=0.03 height=0.7 position=[0.55, 0.35, 0.3] color=#3a3a3a
      cylinder "leg back left" radius=0.03 height=0.7 position=[-0.55, 0.35, -0.3] color=#3a3a3a
      cylinder "leg back right" radius=0.03 height=0.7 position=[0.55, 0.35, -0.3] color=#3a3a3a
    }
  }
}`;

const SYSTEM = `You write SceneScript code. Answer with SceneScript code only, inside a single \`\`\`scenescript code block, with no explanation. Do not use any tools.`;

function extractCode(text: string): string {
  const m = /```[a-zA-Z]*\s*\n([\s\S]*?)```/.exec(text);
  return (m ? m[1] : text).trim();
}

/** Runs the model, validates the output with `validate`, and retries once with the error. */
async function generateValidated(user: string, validate: (code: string) => string): Promise<string> {
  let prompt = user;
  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await callModel({ system: SYSTEM, user: prompt });
    const code = extractCode(raw);
    try {
      return validate(code);
    } catch (e) {
      lastError = (e as Error).message;
      prompt = `${user}\n\nYour previous answer was invalid SceneScript:\n${code}\n\nError: ${lastError}\nReturn corrected SceneScript only.`;
    }
  }
  throw new Error(`The model did not produce valid SceneScript: ${lastError}`);
}

/** [model generate]~ — processes 1 and 6: generation_input → scene. */
export async function generateScene(input: GenerationInput): Promise<string> {
  const user =
    input.mode === 'create'
      ? `${LANGUAGE_SPEC}\n\nWrite a SceneScript scene for this request:\n${input.prompt}`
      : `${LANGUAGE_SPEC}\n\nHere is the current scene:\n\`\`\`scenescript\n${input.currentScene}\n\`\`\`\n\n` +
        `Rewrite the whole scene to apply this request, keeping everything else unchanged:\n${input.prompt}`;
  return generateValidated(user, canonicalize);
}

/** [model modify]~ — process 5: scoped_input → subtree_2. Only the target subtree may change. */
export async function modifySubtree(input: ScopedInput): Promise<string> {
  const isRoot = input.target.nodeId === '0';
  const user =
    `${LANGUAGE_SPEC}\n\nThe full scene, for context only (do not return it):\n\`\`\`scenescript\n${input.sceneContext}\n\`\`\`\n\n` +
    `Modify only this part, the ${input.target.type} "${input.target.name}":\n\`\`\`scenescript\n${input.subtree}\n\`\`\`\n\n` +
    `Request: ${input.request}\n\n` +
    `Return exactly one ${isRoot ? "'scene'" : 'node'} that replaces the part above (with its children). ` +
    `Keep its position in the parent's coordinate frame unless the request says otherwise.` +
    (isRoot ? '' : ` Do not return a 'scene' node.`);
  return generateValidated(user, (code) => {
    const n = parseNode(code);
    if (isRoot && n.type !== 'scene') throw new Error("must be a single 'scene' node");
    if (!isRoot && n.type === 'scene') throw new Error("must not be a 'scene' node");
    return serializeNode(n) + '\n';
  });
}
