import type { WordCloudItem } from '../types';

/** (word_cloud_1: artifact visual) — clicking a word specifies it as the concept */
export function WordCloud({ items, onPick, width = 420, height = 220, active }: {
  items: WordCloudItem[]; onPick?: (w: string) => void; width?: number; height?: number; active?: string;
}) {
  return (
    <svg className="wordcloud" viewBox={`0 0 ${width} ${height}`} width={width} height={height}>
      {items.map((w) => (
        <text
          key={w.word}
          x={w.x}
          y={w.y}
          fontSize={w.size}
          fill={w.color}
          textAnchor="middle"
          fontWeight={active === w.word ? 800 : 600}
          textDecoration={active === w.word ? 'underline' : undefined}
          style={{ cursor: onPick ? 'pointer' : 'default' }}
          onClick={() => onPick?.(w.word)}
        >
          {w.word}
        </text>
      ))}
    </svg>
  );
}
