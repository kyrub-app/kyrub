export const NINETY_NINE_FOOD_BINDING_REMEDIATION_EVENT =
  'kyrub:99food-binding-remediation-requested';

export interface NinetyNineFoodBindingRemediationContext {
  externalProductIds: string[];
}

let pendingContext: NinetyNineFoodBindingRemediationContext | null = null;

const normalizeExternalProductIds = (values: string[]): string[] =>
  Array.from(new Set(
    values
      .map(value => value.trim())
      .filter(Boolean)
  ));

export const requestNinetyNineFoodBindingRemediation = (
  externalProductIds: string[]
): NinetyNineFoodBindingRemediationContext | null => {
  const normalized = normalizeExternalProductIds(externalProductIds);
  if (normalized.length === 0) return null;
  pendingContext = { externalProductIds: normalized };
  window.dispatchEvent(new CustomEvent<NinetyNineFoodBindingRemediationContext>(
    NINETY_NINE_FOOD_BINDING_REMEDIATION_EVENT,
    { detail: pendingContext }
  ));
  return pendingContext;
};

export const consumeNinetyNineFoodBindingRemediation = ():
  | NinetyNineFoodBindingRemediationContext
  | null => {
  const current = pendingContext;
  pendingContext = null;
  return current;
};
