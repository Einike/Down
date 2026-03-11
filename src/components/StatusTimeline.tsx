"use client";
const STEPS = [
  { key: 'LOCKED',          label: 'Locked',         icon: '🔒' },
  { key: 'BUYER_SUBMITTED', label: 'Meal chosen',     icon: '🍽️' },
  { key: 'SELLER_ACCEPTED', label: 'Seller accepted', icon: '✅' },
  { key: 'QR_UPLOADED',     label: 'QR uploaded',     icon: '📲' },
  { key: 'COMPLETED',       label: 'Picked up',       icon: '🎉' },
] as const;

export default function StatusTimeline({ status }: { status: string }) {
  const idx = STEPS.findIndex(s => s.key === status);
  return (
    <div className="flex items-center gap-0 overflow-x-auto pb-1">
      {STEPS.map((s, i) => {
        const done    = i < idx;
        const current = i === idx;
        const future  = i > idx;
        return (
          <div key={s.key} className="flex items-center">
            <div className={`flex flex-col items-center ${future ? 'opacity-30' : ''}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm border-2 transition
                ${current ? 'border-blue-400 bg-blue-950 scale-110' : done ? 'border-emerald-500 bg-emerald-950' : 'border-slate-600 bg-slate-800'}`}>
                {done ? '✓' : s.icon}
              </div>
              <p className={`text-[9px] mt-1 whitespace-nowrap font-medium ${current ? 'text-blue-300' : done ? 'text-emerald-400' : 'text-slate-500'}`}>
                {s.label}
              </p>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`w-6 h-0.5 mx-0.5 mb-4 ${i < idx ? 'bg-emerald-500' : 'bg-slate-700'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}
