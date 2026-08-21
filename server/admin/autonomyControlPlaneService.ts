import {
  KYRUB_AUTONOMY_REGISTRY,
  type KyrubAutonomyRuntimeControls,
} from '../../shared/kyrubAutonomy.js';
import type { KyrubAutonomyLease } from '../../shared/kyrubAutonomyLeases.js';
import type { KyrubReconciliationFinding } from '../../shared/kyrubReconciliation.js';
import {
  KYRUB_AUTONOMY_CONTROL_PLANE_SCHEMA_VERSION,
  type KyrubAutonomyControlPlaneSnapshot,
} from '../../shared/kyrubAutonomyControlPlane.js';

export const buildKyrubAutonomyControlPlaneSnapshot = (input: {
  controls?: KyrubAutonomyRuntimeControls;
  leases?: KyrubAutonomyLease[];
  findings?: KyrubReconciliationFinding[];
  now?: Date;
}): KyrubAutonomyControlPlaneSnapshot => {
  const controls = input.controls ?? {};
  const now = input.now ?? new Date();
  const actions = Object.values(KYRUB_AUTONOMY_REGISTRY)
    .map(definition => {
      const killed = controls.globalKillSwitch === true ||
        controls.domainKillSwitches?.[definition.domain] === true ||
        controls.actionKillSwitches?.[definition.actionType] === true;
      const enabled = !killed &&
        controls.featureFlags?.[definition.featureFlag] !== false;
      return {
        actionType: definition.actionType,
        domain: definition.domain,
        maximumLevel: definition.maximumLevel,
        enabled,
        killed,
      };
    })
    .sort((left, right) => left.actionType.localeCompare(right.actionType));

  const activeLeases = (input.leases ?? [])
    .filter(lease => Date.parse(lease.expiresAt) > now.getTime() && lease.remainingUses > 0)
    .map(lease => ({
      leaseId: lease.leaseId,
      actorUid: lease.actorUid,
      allowedActions: [...lease.allowedActions],
      scopeRef: lease.scopeRef,
      expiresAt: lease.expiresAt,
      remainingUses: lease.remainingUses,
    }))
    .slice(0, 200);

  const reconciliationFindings = (input.findings ?? [])
    .map(finding => ({
      findingId: finding.findingId,
      correlationId: finding.correlationId,
      code: finding.code,
      severity: finding.severity,
    }))
    .slice(0, 200);

  return {
    schemaVersion: KYRUB_AUTONOMY_CONTROL_PLANE_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    globalKillSwitch: controls.globalKillSwitch === true,
    domainKillSwitches: { ...(controls.domainKillSwitches ?? {}) },
    actions,
    activeLeases,
    reconciliationFindings,
  };
};
