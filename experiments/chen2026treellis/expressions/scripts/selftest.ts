// Self-test for the deterministic tool steps (translate, extract, modify).
import assert from 'node:assert/strict';
import { canonicalize, extractSubtree, translateScene, parseScene, SceneParseError } from '../shared/scene';
import { applyParameterEdit, applyStructureEdit, replaceSubtree } from '../shared/edits';
import { composeGenerationInput, composeScopedInput } from '../shared/compose';

const src = `scene "Test" {
  // comment
  plane "floor" size=[4, 4] color=#777
  group "table" position=[0,0,0] {
    box "top" size=[1, 0.1, 1] position=[0, 0.7, 0] color=#8b5a2b
    cylinder "leg" radius=0.05 height=0.7 position=[0.4, 0.35, 0.4]
  }
}`;
const code = canonicalize(src);
const { tree, parameters } = translateScene(code);
assert.equal(tree.children.length, 2);
assert.equal(tree.children[1].children[0].name, 'top');
assert.equal(tree.children[1].startLine, 3);
assert.deepEqual(parameters['0.1.1'].attrs.scale, [1, 1, 1]);
assert.equal(parameters['0.0'].attrs.color, '#777777');

const c2 = applyParameterEdit(code, { nodeId: '0.1.0', key: 'color', value: '#ff0000' });
assert.equal(translateScene(c2).tree.children[1].children[0].attrs.color, '#ff0000');
assert.throws(() => applyParameterEdit(code, { nodeId: '0.1', key: 'radius', value: 1 }));

const dup = applyStructureEdit(code, { op: 'duplicate', nodeId: '0.1.1' });
assert.equal(translateScene(dup.code).tree.children[1].children.length, 3);
assert.equal(dup.selectId, '0.1.2');
const add = applyStructureEdit(code, { op: 'add-child', nodeId: '0', childType: 'sphere' });
assert.equal(translateScene(add.code).tree.children[2].type, 'sphere');
const del = applyStructureEdit(code, { op: 'delete', nodeId: '0.0' });
assert.equal(translateScene(del.code).tree.children[0].name, 'table');
const wrap = applyStructureEdit(code, { op: 'wrap-in-group', nodeId: '0.0' });
assert.equal(translateScene(wrap.code).tree.children[0].children[0].name, 'floor');

const sub = extractSubtree(code, '0.1');
assert.ok(sub.startsWith('group "table"'));
const replaced = replaceSubtree(code, '0.1', 'group "table" { sphere "ball" radius=0.2 }');
assert.equal(translateScene(replaced).tree.children[1].children[0].type, 'sphere');
assert.throws(() => replaceSubtree(code, '0.1', 'scene "x" {}'));

assert.throws(() => parseScene('box "a" {}'), SceneParseError);
assert.throws(() => parseScene('scene "a" { box "b" size=[1,2] }'), SceneParseError);
assert.throws(() => composeGenerationInput('   '));
assert.equal(composeGenerationInput('hi', code).mode, 'followup');
assert.equal(composeScopedInput('x', sub, { nodeId: '0.1', name: 'table', type: 'group' }, code).subtree, sub);
console.log('selftest ok');
