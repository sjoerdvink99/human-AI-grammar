export function Citation({ text, format, mono = false }: { text: string; format: string; mono?: boolean }) {
  return (
    <div className="relative rounded border border-line bg-wash">
      <pre
        className={`px-3 pt-2.5 pb-8 leading-6 break-words whitespace-pre-wrap ${mono ? "font-mono text-[13px]" : "font-sans text-[14px]"}`}
      >
        {text}
      </pre>
      <span className="absolute right-3 bottom-2 text-[11px] font-medium tracking-wide text-faint uppercase">{format}</span>
    </div>
  );
}
