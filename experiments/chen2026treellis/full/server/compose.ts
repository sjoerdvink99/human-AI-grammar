// [tool compose] steps: build the instruction records sent to the model.
import { pathTo, serializeScene, type Scene, type SceneNode } from '../src/shared/scene.ts';

export const SCENE_FORMAT_SPEC = `SCENE FORMAT ("systemx-scene/1", JSON):
{
  "format": "systemx-scene/1",
  "title": string,
  "root": Node
}
Node = {
  "id": string,            // short unique snake_case id, e.g. "front_left_leg"
  "name": string,          // human-readable part name, e.g. "Front left leg"
  "kind": "group" | "part",// group = subassembly with no geometry; part = one primitive
  "geometry": Geometry,    // parts only
  "position": [x, y, z],   // relative to parent, units ~ metres, Y is up
  "rotation": [x, y, z],   // Euler XYZ in DEGREES, relative to parent
  "scale": [x, y, z],      // usually [1, 1, 1]
  "color": "#rrggbb",      // parts only
  "children": Node[]       // sub-parts / sub-assemblies (may be empty)
}
Geometry is one of (all primitives centred on their own origin, axis along Y):
  {"shape":"box","width":w,"height":h,"depth":d}
  {"shape":"sphere","radius":r}
  {"shape":"cylinder","radiusTop":r1,"radiusBottom":r2,"height":h}
  {"shape":"cone","radius":r,"height":h}
  {"shape":"torus","radius":r,"tube":t}     // ring lies in the XY plane; rotate [90,0,0] to lie flat
  {"shape":"capsule","radius":r,"length":l}`;

const MODELING_RULES = `MODELING RULES:
- Build a meaningful assembly tree: group related parts into named subassemblies (e.g. "Legs", "Seat", "Backrest"), 2-4 levels deep where it makes sense.
- Every part has a clear, specific name. Ids are unique across the whole scene.
- The object rests on the ground plane y = 0 and is centred on x = 0, z = 0; overall size 0.5–5 units.
- Parts must touch or overlap plausibly — no floating pieces. Children positions are relative to their parent.
- Use realistic, harmonious colors. Use between 3 and 60 parts.
- Output ONLY the JSON object, no prose, no markdown fences.`;

/** generation_input: the user's description plus instructions constraining the output format. */
export interface GenerationInput {
  system: string;
  user: string;
}

/** Process 1 (no current scene) and process 6 (with current scene as context). */
export function composeGenerationInput(prompt: string, currentScene?: Scene): GenerationInput {
  const system = `You are a 3D modeling assistant that writes scenes as editable assembly trees of primitive shapes.\n\n${SCENE_FORMAT_SPEC}\n\n${MODELING_RULES}`;
  if (!currentScene) {
    return { system, user: `Create a complete scene for this object:\n\n${prompt.trim()}` };
  }
  return {
    system,
    user:
      `Here is the CURRENT scene:\n\n${serializeScene(currentScene)}\n\n` +
      `Produce a complete REPLACEMENT scene for this new description of the whole object, using the current scene as context ` +
      `(keep the parts, names, ids, proportions and colors that the description does not ask to change):\n\n${prompt.trim()}`,
  };
}

/** scoped_input: the subtree plus the change description (with its location in the assembly as context). */
export function composeScopedInput(scene: Scene, targetId: string, subtree: SceneNode, request: string): GenerationInput {
  const path = pathTo(scene, targetId).map((n) => n.name);
  const system =
    `You are a 3D modeling assistant editing ONE subtree of a larger assembly scene. ` +
    `You receive the subtree as a JSON Node and a change request, and return a replacement Node.\n\n${SCENE_FORMAT_SPEC}\n\n` +
    `LOCAL EDIT RULES:\n` +
    `- Return ONLY the replacement Node JSON object (not a whole scene), no prose, no markdown fences.\n` +
    `- Keep the root node's id, and keep its position/rotation/scale unless the request asks to move it, so the subtree stays attached to the rest of the object.\n` +
    `- Change only what the request asks for; keep other parts, ids, names and colors.\n` +
    `- Child positions are relative to their parent; Y is up; rotations are in degrees.`;
  const user =
    `Object: "${scene.title}". Location of this subtree in the assembly: ${path.join(' > ')}\n\n` +
    `SUBTREE:\n${JSON.stringify(subtree, null, 2)}\n\nCHANGE REQUEST:\n${request.trim()}`;
  return { system, user };
}
