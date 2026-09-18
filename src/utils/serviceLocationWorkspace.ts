import type { ResolvedOrderServiceLocation } from '../../shared/serviceLocation';

export const SERVICE_LOCATION_WORKSPACE_OPEN_EVENT =
  'kyrub-service-location-workspace-open';

export interface ServiceLocationWorkspaceOpenRequest {
  storeId: string;
  location: ResolvedOrderServiceLocation;
}

export const requestServiceLocationWorkspaceOpen = (
  detail: ServiceLocationWorkspaceOpenRequest
): void => {
  window.dispatchEvent(
    new CustomEvent<ServiceLocationWorkspaceOpenRequest>(
      SERVICE_LOCATION_WORKSPACE_OPEN_EVENT,
      { detail }
    )
  );
};
