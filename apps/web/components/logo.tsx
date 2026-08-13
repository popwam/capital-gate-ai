export function LogoMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5" aria-label="Maqar home">
      <div className="grid h-9 w-9 place-items-center rounded-[12px] bg-forest text-white shadow-sm">
        <svg viewBox="0 0 32 32" className="h-5 w-5" fill="none" aria-hidden="true">
          <path d="M7 25V13.5L16 7l9 6.5V25" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M12 25v-7h8v7M10 11l6 5 6-5" stroke="#f3b79f" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
      {!compact && <div><div className="text-[17px] font-bold tracking-[-.04em]">maqar</div><div className="-mt-1 text-[9px] font-semibold uppercase tracking-[.18em] text-[#72817b]">AI property advisor</div></div>}
    </div>
  );
}
