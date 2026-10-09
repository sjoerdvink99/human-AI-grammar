// Smoke test: runs the authoring model ops (P1, P3) end to end on a sample story.
import * as ops from '../server/ops';
import { getLayout } from '../shared/layouts';
import { placeObjects } from '../shared/tool1';
import { composeVignette, initRuntime } from '../shared/runtime';
import fs from 'node:fs';

const story = `Every Sunday evening I visit my grandmother Rosa. When I arrive she is already in the kitchen stirring a pot of soup on the stove. I set the table while my little brother Leo plays with his toy cars on the living room rug. Grandma calls us to eat and we all sit at the dining table. After dinner Leo falls asleep on the sofa, and Grandma and I wash the dishes at the sink while she tells me stories about her childhood.`;
const characters = await ops.extractCharacters(story);
console.log(characters.map((c) => `${c.name}${c.isPlayer ? '*' : ''}`));
const { layoutId, reason } = await ops.selectLayout(story, characters);
console.log(layoutId, reason);
const roomLabels = await ops.assignRoomLabels(story, layoutId, characters);
console.log(roomLabels);
const objects1 = await ops.generateObjects(story, layoutId, characters, roomLabels);
let env = placeObjects(getLayout(layoutId)!, roomLabels, objects1);
console.log('unplaced', env.objects.filter((o) => !o.pos).map((o) => o.name));
const objects2 = await ops.assignObjectAffordances(story, env, characters, env.objects);
env = { ...env, objects: objects2 };
const activities = await ops.extractActivities(story, env, characters);
console.log(activities.map((a) => `${a.id} ${a.characterId} ${a.action} ${a.objectId}`));
const events1 = await ops.composeEvents(story, characters, activities);
const events = await ops.orderEvents(story, events1, activities, characters);
console.log(events.map((e) => `${e.order}. ${e.title} ${e.activityIds}`));
const { vignette, errors } = composeVignette({ story, characters, layoutId, layoutReason: reason, roomLabels, objects: objects2, environment: env, activities, events, vignetteId: null }, 'smoke', 'Sunday soup');
console.log(errors);
fs.writeFileSync('scripts/smoke-vignette.json', JSON.stringify(vignette, null, 2));
const plans = await ops.planNpcs(vignette!, initRuntime(vignette!));
console.log(JSON.stringify(plans, null, 1));
