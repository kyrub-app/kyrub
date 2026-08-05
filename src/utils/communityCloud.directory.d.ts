import type { CloudCommunityMembership } from './communityCloud';
import './communityCloud';

declare module './communityCloud' {
  interface CloudCommunity {
    membership?: CloudCommunityMembership | null;
    isOwner?: boolean;
    isActiveMember?: boolean;
    isPendingMember?: boolean;
  }
}
