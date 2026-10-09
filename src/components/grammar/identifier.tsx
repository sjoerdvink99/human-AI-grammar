const indexed = /^(.*[^_])_([^_]+)$/;

export function Identifier({ name }: { name: string }) {
  const match = indexed.exec(name);
  if (!match) return <>{name}</>;
  return (
    <span aria-label={name}>
      {match[1]}
      <sub>{match[2]}</sub>
    </span>
  );
}
