/** Calendar dates are stored without a time or timezone. */
export function normalizeLifeDate(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) return;
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return;
  return value;
}

export function lifeDateError(birth: string, death: string): "invalidLifeDate" | "deathBeforeBirth" | undefined {
  if ((birth && !normalizeLifeDate(birth)) || (death && !normalizeLifeDate(death))) return "invalidLifeDate";
  if (birth && death && death < birth) return "deathBeforeBirth";
}

export function formatLifeDate(value: string): string {
  return value.split("-").reverse().join(".");
}

export function personLifeDates(person: { birth_date?: string; death_date?: string }): string[] {
  const birth = normalizeLifeDate(person.birth_date);
  const death = normalizeLifeDate(person.death_date);
  return [birth ? `° ${formatLifeDate(birth)}` : "", death ? `† ${formatLifeDate(death)}` : ""].filter(Boolean);
}
