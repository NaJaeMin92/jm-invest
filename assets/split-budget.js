// Allocate whole cents. Earlier units receive any indivisible cents.
export function splitBudget(amount, units, perBuy) {
  if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(amount)) return null;
  const [whole, fraction=""] = amount.split(".");
  const cents = Number(whole)*100 + Number(fraction.padEnd(2,"0"));
  if (!Number.isSafeInteger(units) || !Number.isSafeInteger(perBuy) ||
      perBuy < 1 || units < perBuy || units > cents) return null;
  const base = Math.floor(cents/units), extra = cents%units;
  const rounds = Math.ceil(units/perBuy);
  const ranges = [];
  // Group identical consecutive orders, including plans with many small units.
  const cuts = [0,Math.floor(extra/perBuy),Math.ceil(extra/perBuy),Math.floor(units/perBuy),rounds];
  for (const end of new Set(cuts)) {
    const start = ranges.at(-1)?.end ?? 0;
    if (end <= start) continue;
    const from = start*perBuy, to = Math.min(units,from+perBuy);
    const size = to-from;
    const cost = base*size + Math.min(extra,to)-Math.min(extra,from);
    const last = ranges.at(-1);
    if (last && last.size===size && last.cents===cost) last.end=end;
    else ranges.push({first:start+1,end,size,cents:cost});
  }
  return {rounds,ranges};
}
