// label_taxonomy_1: a tree of iconographic labels for units inside artworks.
const T = (id, label, parent, definition) => ({ id, label, parent, definition });

export const labelTaxonomy = {
  name: 'Iconographic units',
  nodes: [
    T('root', 'Unit', null, 'Any depicted unit inside an artwork.'),
    T('figure', 'Human figure', 'root', 'A depicted person.'),
    T('figure.standing', 'Standing figure', 'figure', 'Upright person, arms at rest or holding something.'),
    T('figure.orant', 'Orant (raised arms)', 'figure', 'Person with both arms raised, a gesture of prayer, praise or alarm.'),
    T('figure.kneeling', 'Kneeling figure', 'figure', 'Person kneeling or bowing, often in devotion or supplication.'),
    T('figure.seated', 'Seated figure', 'figure', 'Person sitting, e.g. enthroned, resting or reading.'),
    T('figure.rider', 'Rider', 'figure', 'Person on horseback.'),
    T('figure.child', 'Child', 'figure', 'Clearly smaller, younger person.'),
    T('animal', 'Animal', 'root', 'A depicted animal.'),
    T('animal.horse', 'Horse', 'animal', 'Horse, with or without rider.'),
    T('animal.dog', 'Dog', 'animal', 'Dog or hound.'),
    T('animal.bird', 'Bird', 'animal', 'Bird in flight or perched.'),
    T('animal.fish', 'Fish', 'animal', 'Fish or sea creature.'),
    T('nature', 'Nature', 'root', 'Natural elements of the setting.'),
    T('nature.tree', 'Tree', 'nature', 'Single tree.'),
    T('nature.mountain', 'Mountain', 'nature', 'Mountain or hill.'),
    T('nature.sun', 'Sun', 'nature', 'Sun disc, possibly with rays.'),
    T('nature.moon', 'Moon', 'nature', 'Moon or crescent.'),
    T('nature.star', 'Star', 'nature', 'Star, often symbolic.'),
    T('architecture', 'Architecture', 'root', 'Built structures.'),
    T('architecture.house', 'House', 'architecture', 'Dwelling.'),
    T('architecture.tower', 'Tower', 'architecture', 'Tall narrow structure: watchtower, lighthouse, campanile.'),
    T('architecture.temple', 'Temple / church', 'architecture', 'Sacred building, often with a dome or cross.'),
    T('vessel', 'Vessel', 'root', 'Boats and ships.'),
    T('vessel.sailboat', 'Sailboat', 'vessel', 'Boat with a sail.'),
    T('vessel.rowboat', 'Rowboat', 'vessel', 'Small boat without sail.'),
    T('symbol', 'Symbolic object', 'root', 'Objects carrying symbolic meaning.'),
    T('symbol.halo', 'Haloed figure', 'symbol', 'Figure marked with a halo: saint or holy person.'),
    T('symbol.cross', 'Cross', 'symbol', 'Cross as a symbol, freestanding or on a building.'),
  ],
};

export function taxonomyOutline(tax = labelTaxonomy) {
  const kids = (p) => tax.nodes.filter((n) => n.parent === p);
  const lines = [];
  const walk = (n, d) => {
    lines.push(`${'  '.repeat(d)}- ${n.id}: ${n.label} — ${n.definition}`);
    kids(n.id).forEach((c) => walk(c, d + 1));
  };
  kids(null).forEach((r) => walk(r, 0));
  return lines.join('\n');
}

export function leafIds(tax = labelTaxonomy) {
  const parents = new Set(tax.nodes.map((n) => n.parent));
  return tax.nodes.filter((n) => !parents.has(n.id)).map((n) => n.id);
}
