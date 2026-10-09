// skill_library_1 and knowledge_base_1: the starting skills and knowledge.
export const initialSkills = [
  {
    id: 'skill-pose',
    name: 'Group figures by pose',
    description: 'Cluster human figures by body posture and gesture rather than by colour or size.',
    whenToUse: 'Tasks about gestures, poses, devotion, or the role of figures.',
    procedure: 'Read each unit description for arm position, kneeling/sitting/standing, and what the figure holds. Put figures with the same posture in the same cluster; keep riders separate.',
    origin: 'seed',
  },
  {
    id: 'skill-category-first',
    name: 'Coarse category first',
    description: 'Split units by their basic category (figure, animal, nature, building, vessel) before finer grouping.',
    whenToUse: 'Mixed collections where units span many categories.',
    procedure: 'Partition by basic category, then within each partition split by the most salient visual difference.',
    origin: 'seed',
  },
  {
    id: 'skill-context',
    name: 'Use artwork context',
    description: 'Use the scene the unit appears in (title, setting, neighbouring units) to disambiguate.',
    whenToUse: 'When a unit is ambiguous on its own, e.g. a small figure, a tower vs. a lighthouse.',
    procedure: 'Look at the artwork description and the other units in the same artwork; prefer readings consistent with the scene.',
    origin: 'seed',
  },
  {
    id: 'skill-symbols',
    name: 'Attend to symbolic markers',
    description: 'Halos, crosses and stars change the iconographic meaning of a unit.',
    whenToUse: 'Religious or allegorical scenes; any task about meaning or symbolism.',
    procedure: 'Check unit descriptions for halos, crosses, stars, golden light. Keep marked units in their own cluster.',
    origin: 'seed',
  },
  {
    id: 'skill-small-clusters',
    name: 'Prefer small, coherent clusters',
    description: 'Avoid catch-all clusters; a reviewer should be able to label a cluster with one label.',
    whenToUse: 'Always, when the goal is to assign one label per cluster.',
    procedure: 'If a cluster would need two different labels, split it. Merge clusters that would get the same label.',
    origin: 'seed',
  },
];

export const initialKnowledgeBase = {
  entries: [
    { id: 'kb-1', topic: 'Annotation unit', content: 'A unit is one bounding box in an artwork. Labels are assigned per unit, using leaves of the iconographic taxonomy where possible.', source: 'seed' },
    { id: 'kb-2', topic: 'Orant gesture', content: 'Both arms raised above the shoulders is labelled Orant, regardless of whether the figure is standing or kneeling.', source: 'seed' },
    { id: 'kb-3', topic: 'Halo precedence', content: 'If a figure has a halo, the label Haloed figure takes precedence over pose labels.', source: 'seed' },
  ],
};
