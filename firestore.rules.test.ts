/**
 * Security Rules Verification Suite for LYRICAL (Dirty Dozen Adversarial Payloads)
 * Verifies that all 12 adversarial payloads defined in security_spec.md are blocked.
 */
export interface AdversarialPayloadTest {
  id: number;
  name: string;
  collection: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  expectedOutcome: 'PERMISSION_DENIED';
  payload: Record<string, unknown>;
}

export const DIRTY_DOZEN_SECURITY_TESTS: AdversarialPayloadTest[] = [
  {
    id: 1,
    name: 'Self-Assigned Admin Role on User Profile Creation',
    collection: 'users/u_attacker',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
    payload: {
      uid: 'u_attacker',
      email: 'attacker@example.com',
      name: 'Attacker',
      role: 'admin',
      suspended: false,
    },
  },
  {
    id: 2,
    name: 'Shadow Field Injection on User Profile',
    collection: 'users/u_attacker',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
    payload: {
      uid: 'u_attacker',
      email: 'attacker@example.com',
      name: 'Attacker',
      role: 'user',
      suspended: false,
      isSuperAdmin: true,
    },
  },
  {
    id: 3,
    name: 'Cross-User PII Profile Read',
    collection: 'users/u_victim',
    operation: 'get',
    expectedOutcome: 'PERMISSION_DENIED',
    payload: {},
  },
  {
    id: 4,
    name: 'Denial of Wallet Oversized Bot Name (>64 chars)',
    collection: 'bots/bot_1',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
    payload: {
      id: 'bot_1',
      ownerId: 'u_attacker',
      name: 'A'.repeat(5000),
    },
  },
  {
    id: 5,
    name: 'Orphaned Bot Creation Without User Document',
    collection: 'bots/bot_orphan',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
    payload: {
      id: 'bot_orphan',
      ownerId: 'u_nonexistent',
    },
  },
  {
    id: 6,
    name: 'Identity Spoofing on Bot Creation',
    collection: 'bots/bot_spoof',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
    payload: {
      id: 'bot_spoof',
      ownerId: 'u_victim',
    },
  },
  {
    id: 7,
    name: 'Client Timestamp Forgery on Bot Creation',
    collection: 'bots/bot_time',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
    payload: {
      id: 'bot_time',
      ownerId: 'u_attacker',
      createdAt: '2020-01-01T00:00:00Z',
    },
  },
  {
    id: 8,
    name: 'Immutable ownerId Mutation on Bot Update',
    collection: 'bots/bot_1',
    operation: 'update',
    expectedOutcome: 'PERMISSION_DENIED',
    payload: {
      ownerId: 'u_new_owner',
    },
  },
  {
    id: 9,
    name: 'Unfiltered List Query Scraping on Bots',
    collection: 'bots',
    operation: 'list',
    expectedOutcome: 'PERMISSION_DENIED',
    payload: {},
  },
  {
    id: 10,
    name: 'Terminal State Mutation on Completed Deployment',
    collection: 'deployments/dep_done',
    operation: 'update',
    expectedOutcome: 'PERMISSION_DENIED',
    payload: {
      status: 'running',
    },
  },
  {
    id: 11,
    name: 'Unverified Email Admin Claim Spoof',
    collection: 'adminActions/aud_1',
    operation: 'get',
    expectedOutcome: 'PERMISSION_DENIED',
    payload: {
      email: 'ssmu1720@gmail.com',
      email_verified: false,
    },
  },
  {
    id: 12,
    name: 'Unauthorized Admin Audit Log Injection',
    collection: 'adminActions/aud_fake',
    operation: 'create',
    expectedOutcome: 'PERMISSION_DENIED',
    payload: {
      id: 'aud_fake',
      adminId: 'u_attacker',
      action: 'DELETE_USER',
    },
  },
];
