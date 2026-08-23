export function LogoMark({ compact = false, inverse = false }: { compact?: boolean; inverse?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5" aria-label="Cg Ai">
      <div className={`relative grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-[14px] border ${inverse ? "border-white/15 bg-white/10 text-white" : "border-[#d8ddd8] bg-[#142927] text-white"}`}>
        <span className="text-[16px] font-black tracking-[-.08em]">Cg</span>
        <span className="absolute bottom-1 right-1 rounded-[5px] bg-[#cfb074] px-1 text-[7px] font-black leading-[12px] tracking-[-.03em] text-[#142927]">Ai</span>
      </div>
      {!compact && (
        <div className="min-w-0 leading-none">
          <div className={`flex items-baseline gap-1 font-black tracking-[-.055em] ${inverse ? "text-white" : "text-[#142927]"}`}>
            <span className="text-[19px]">Cg</span><span className="text-[12px] font-bold tracking-[-.03em] text-[#a1834e]">Ai</span>
          </div>
          <div className={`mt-1.5 truncate text-[9px] font-bold uppercase tracking-[.17em] ${inverse ? "text-white/50" : "text-[#7a8580]"}`}>property intelligence</div>
        </div>
      )}
    </div>
  );
}
