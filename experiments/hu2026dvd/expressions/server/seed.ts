import type { Project, Scene } from '../shared/types';

const sc = (id: string, s: Omit<Scene, 'id' | 'factIndexes'>): Scene => ({ id, factIndexes: [], ...s });

export function seedProject(): Project {
  return {
    topic: 'How fast is solar power growing around the world?',
    dataFacts: [
      'Global solar capacity was about 40 GW in 2010.',
      'Global solar capacity passed 1,000 GW (1 TW) in 2022.',
      'Solar module prices fell by roughly 90% between 2010 and 2020.',
      'China installed about 40% of the world\'s new solar capacity in 2022.',
      'Solar generated about 4.5% of global electricity in 2022.',
    ],
    guidelines: [
      { id: 'g1', title: 'Open with a hook', text: 'Start with a surprising number or a question so the viewer wants to keep watching.' },
      { id: 'g2', title: 'One idea per scene', text: 'Each scene should communicate a single data point or comparison; split scenes that try to say two things.' },
      { id: 'g3', title: 'Give numbers context', text: 'Compare a value with a familiar reference, an earlier year, or another group so the scale is understandable.' },
      { id: 'g4', title: 'Make comparisons visual', text: 'When contrasting two values, show them side by side with bars of proportional length rather than as text.' },
      { id: 'g5', title: 'Keep text short', text: 'On-screen text should be readable in two seconds; leave detail to narration.' },
      { id: 'g6', title: 'Use consistent colour', text: 'Use one accent colour for the main subject throughout the video, and neutral colours for everything else.' },
      { id: 'g7', title: 'Pace by complexity', text: 'Give charts with several bars more time on screen than a single headline number.' },
      { id: 'g8', title: 'End with a takeaway', text: 'Close with a memorable sentence that summarises what the data means for the viewer.' },
    ],
    scripts: [],
    references: [
      {
        id: 'r1',
        title: 'Big-number opener',
        description: 'Opens with a single huge percentage that counts up, then explains what it means. Hook, big number, context.',
        tags: ['hook', 'big number', 'opening', 'percentage'],
        scenes: [
          sc('r1a', { title: 'Hook', narration: '', onScreenText: 'Guess how much it dropped', visual: { kind: 'big_number', label: 'price drop since 2010', value: '90%', items: [] }, background: '#10172a', accent: '#f59e0b', durationSec: 4 }),
          sc('r1b', { title: 'Context', narration: '', onScreenText: 'Cheaper than coal in most places', visual: { kind: 'headline', label: 'Cheaper than ever', value: '', items: [] }, background: '#10172a', accent: '#f59e0b', durationSec: 3 }),
        ],
      },
      {
        id: 'r2',
        title: 'Side-by-side comparison',
        description: 'Two bars grow side by side to compare a before and after value, with the accent colour on the subject.',
        tags: ['comparison', 'before after', 'bars', 'contrast'],
        scenes: [
          sc('r2a', { title: 'Then vs now', narration: '', onScreenText: '2010 vs 2022', visual: { kind: 'comparison', label: 'Solar capacity (GW)', value: '', items: [{ label: '2010', value: 40 }, { label: '2022', value: 1000 }] }, background: '#0b1f1a', accent: '#34d399', durationSec: 5 }),
        ],
      },
      {
        id: 'r3',
        title: 'Ranking bar chart',
        description: 'A bar chart that ranks countries or groups, bars grow one after another with labels; shares and rankings.',
        tags: ['bar chart', 'ranking', 'share', 'countries'],
        scenes: [
          sc('r3a', { title: 'Who leads', narration: '', onScreenText: 'Share of new capacity', visual: { kind: 'bar', label: 'Share of new solar, 2022 (%)', value: '', items: [{ label: 'China', value: 40 }, { label: 'EU', value: 17 }, { label: 'USA', value: 9 }, { label: 'India', value: 7 }] }, background: '#1a1030', accent: '#a78bfa', durationSec: 6 }),
        ],
      },
      {
        id: 'r4',
        title: 'Quote closer',
        description: 'Ends the video on a single memorable takeaway sentence, centred, with a slow fade. Closing, takeaway, summary.',
        tags: ['ending', 'takeaway', 'quote', 'summary'],
        scenes: [
          sc('r4a', { title: 'Takeaway', narration: '', onScreenText: '', visual: { kind: 'quote', label: 'The cheapest electricity in history is now the sun.', value: '', items: [] }, background: '#111827', accent: '#fbbf24', durationSec: 5 }),
        ],
      },
      {
        id: 'r5',
        title: 'Title card with question',
        description: 'A headline title card posing a question to the viewer before revealing data. Question, title, opening.',
        tags: ['title', 'question', 'opening', 'headline'],
        scenes: [
          sc('r5a', { title: 'Question', narration: '', onScreenText: 'A question for you', visual: { kind: 'headline', label: 'Where does your power come from?', value: '', items: [] }, background: '#0f172a', accent: '#38bdf8', durationSec: 4 }),
        ],
      },
    ],
    versions: [],
    chartData: {
      columns: ['Year', 'Solar GW'],
      rows: [
        ['2010', 40],
        ['2013', 140],
        ['2016', 300],
        ['2019', 590],
        ['2022', 1050],
      ],
    },
    chartType: undefined,
    composites: [],
  };
}
