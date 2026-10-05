// Normalize only explicit typed declarations. This changes representation, never verification level.
const BOOLEAN_FACTS = new Set([
  'fees_known', 'litigation_pending_declared', 'entity_identity_verified',
  'equipment_ownership_verified', 'equipment_exists_observed',
]);

export function normalizeDeclaredValue(factKey, value) {
  if (!BOOLEAN_FACTS.has(factKey) || typeof value !== 'string') return value;
  const text = value.trim().toLowerCase();
  return text === 'true' ? true : text === 'false' ? false : value;
}
