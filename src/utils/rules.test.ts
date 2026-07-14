/**
 * Rules Testing Suite for Kyrub Super App
 * Validates Tenant Isolation and Security Policies using @firebase/rules-unit-testing.
 */
declare const describe: any;
declare const beforeAll: any;
declare const afterAll: any;
declare const beforeEach: any;
declare const it: any;

import {
  initializeTestEnvironment,
  RulesTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import * as fs from "fs";
import * as path from "path";

describe("Kyrub Security Rules: Tenant Isolation", () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    // Read the firestore.rules file
    const rulesContent = fs.readFileSync(
      path.resolve(__dirname, "../../../firestore.rules"),
      "utf8"
    );

    // Initialize test environment
    testEnv = await initializeTestEnvironment({
      projectId: "kyrub-prod-9a2cf",
      firestore: {
        rules: rulesContent,
        host: "127.0.0.1",
        port: 8080,
      },
    });
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
  });

  it("should allow Tenant A to read and write its own documents", async () => {
    const tenantAContext = testEnv.authenticatedContext("tenant_a", {
      email: "owner@tenant-a.com",
      email_verified: true,
    });

    const dbA = tenantAContext.firestore();
    const selfTenantDocRef = doc(dbA, "tenants", "tenant_a");
    const selfProductDocRef = doc(dbA, "tenants", "tenant_a", "products", "prod_1");

    // Pre-populate self tenant profile
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "tenants", "tenant_a"), {
        id: "tenant_a",
        name: "Tenant A Enterprise",
        email: "owner@tenant-a.com",
      });
    });

    // Write should succeed
    await assertSucceeds(
      setDoc(selfProductDocRef, {
        id: "prod_1",
        name: "High Tech Headphones",
        price: 299.9,
        stock: 50,
        category: "Electronics",
      })
    );

    // Read should succeed
    await assertSucceeds(getDoc(selfTenantDocRef));
  });

  it("should strictly REJECT Tenant A from reading or accessing Tenant B's data (Cross-Tenant Isolation)", async () => {
    // Pre-populate Tenant B's data using administrative bypass (rules disabled)
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const dbAdmin = context.firestore();
      
      // Tenant B profiles
      await setDoc(doc(dbAdmin, "tenants", "tenant_b"), {
        id: "tenant_b",
        name: "Tenant B Boutique",
        email: "owner@tenant-b.com",
      });

      // Tenant B products
      await setDoc(doc(dbAdmin, "tenants", "tenant_b", "products", "secret_jacket"), {
        id: "secret_jacket",
        name: "Exclusive Leather Jacket",
        price: 999.0,
        stock: 2,
        category: "Fashion",
      });
    });

    // Create Tenant A Client
    const tenantAContext = testEnv.authenticatedContext("tenant_a", {
      email: "owner@tenant-a.com",
      email_verified: true,
    });
    const dbA = tenantAContext.firestore();

    // Tenant A attempts to read Tenant B's tenant profile
    const maliciousTenantRead = getDoc(doc(dbA, "tenants", "tenant_b"));
    await assertFails(maliciousTenantRead);

    // Tenant A attempts to read Tenant B's private product collection
    const maliciousProductRead = getDoc(
      doc(dbA, "tenants", "tenant_b", "products", "secret_jacket")
    );
    await assertFails(maliciousProductRead);
  });

  it("should prevent unauthorized edits and deletions on Audit Logs", async () => {
    // Populate an audit log record
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const dbAdmin = context.firestore();
      await setDoc(doc(dbAdmin, "tenants", "tenant_a", "audit_logs", "log_abc"), {
        id: "log_abc",
        tenantId: "tenant_a",
        timestamp: new Date(),
        action: "SPLIT_PAYMENT",
        preSplitState: { total: 100 },
        postSplitState: { supplier: 80, platform: 20 },
      });
    });

    const tenantAContext = testEnv.authenticatedContext("tenant_a", {
      email: "owner@tenant-a.com",
      email_verified: true,
    });
    const dbA = tenantAContext.firestore();
    const auditDocRef = doc(dbA, "tenants", "tenant_a", "audit_logs", "log_abc");

    // Tenant A attempts to update or overwrite audit records
    await assertFails(
      setDoc(auditDocRef, {
        id: "log_abc",
        action: "TAMPERED_LOG",
      })
    );
  });
});
