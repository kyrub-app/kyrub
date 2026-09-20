import express from "express";
import path from "path";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { createServer as createViteServer } from "vite";
import handleKyrubAiConsultant from "./api/consultor-kyrub";
import { proxyPublicGoogleDriveImage } from "./server/driveMediaProxy";
import {
  createNinetyNineFoodRouter,
  type RawBodyRequest,
} from "./server/integrations/ninetyNineFoodRouter";
import { createNinetyNineFoodAdaptiveOnboardingRouter } from "./server/integrations/ninetyNineFoodAdaptiveOnboardingRouter";
import { createStoreConnectionOnboardingRouter } from "./server/integrations/storeConnectionOnboardingRouter";
import { createMercadoLivreRouter } from "./server/integrations/mercadoLivreRouter";
import { createMercadoLivreStockExecutionRouter } from "./server/integrations/mercadoLivreStockExecutionRouter";
import { createMercadoLivreE2ETestRouter } from "./server/integrations/mercadoLivreE2ETestRouter";
import { createDeliveryOpportunityRouter } from "./server/delivery/deliveryOpportunityRouter";
import { createDeliveryTrackingRouter } from "./server/delivery/deliveryTrackingRouter";
import { createPaidWaitingFundingResponsibilityRouter } from "./server/delivery/paidWaitingFundingResponsibilityRouter";
import { createOperationsHealthRouter } from "./server/admin/operationsHealthRouter";
import { createPlatformEconomyRouter } from "./server/admin/platformEconomyRouter";
import { createMercadoLivrePlatformCredentialRouter } from "./server/admin/mercadoLivrePlatformCredentialRouter";
import { createNinetyNineFoodPlatformCredentialRouter } from "./server/admin/ninetyNineFoodPlatformCredentialRouter";
import { createNinetyNineFoodStatusSyncExecutionRouter } from "./server/inventory/ninetyNineFoodStatusSyncExecutionRouter";
import { createOrderInventoryRouter } from "./server/inventory/orderInventoryRouter";
import { createKyrubAiConsultantRouter } from "./server/ai/consultantRouter";
import { createKyrubActionExecutionRouter } from "./server/actions/actionExecutionRouter";
import { createLocalAttendanceRouter } from "./server/attendance/localAttendanceRouter";
import { createStoreCustomerChatRouter } from "./server/chat/storeCustomerChatRouter";
import { createStoreCampaignRouter } from "./server/campaigns/storeCampaignRouter";
import { createUserCommunicationPreferenceRouter } from "./server/notifications/userCommunicationPreferenceRouter";
import { createUserNotificationRouter } from "./server/notifications/userNotificationRouter";
import { createPaymentIntentRouter } from "./server/payments/paymentIntentRouter";
import { createStorePromotionManagementRouter } from "./server/payments/storePromotionManagementRouter";
import { createStoreRewardRouter } from "./server/payments/storeRewardRouter";
import { createStoreRelationshipRouter } from "./server/payments/storeRelationshipRouter";
import { createMarketplaceDiscoveryRouter } from "./server/payments/marketplaceDiscoveryRouter";
import { createStoreCrmRouter } from "./server/payments/storeCrmRouter";
import { enforceDeliveryWorkEligibility } from "./server/identity/workEligibilityMiddleware";
import { createStoreInstitutionalIdentityRouter } from "./server/store/storeInstitutionalIdentityRouter";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.set("trust proxy", 1);
app.use(
  express.json({
    limit: "2mb",
    verify: (request, _response, buffer) => {
      (request as RawBodyRequest).rawBody = Buffer.from(buffer);
    },
  })
);

const apiKey = process.env.GEMINI_API_KEY || "";
let ai: GoogleGenAI | null = null;

if (apiKey) {
  ai = new GoogleGenAI({
    apiKey: apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });
  console.log("[Kyrub Server] Google GenAI SDK initialized successfully.");
} else {
  console.warn("[Kyrub Server] WARNING: GEMINI_API_KEY environment variable is not set. AI features are unavailable until it is configured.");
}

const geminiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: {
    error: "Limite de taxa excedido. Requisições para o Mentor Kyrub estão limitadas a 20 por minuto para controle de custos.",
    code: "TOO_MANY_REQUESTS"
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const consultantRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 12,
  message: {
    error: "Você enviou muitas solicitações ao Consultor Kyrub. Aguarde um instante.",
    code: "TOO_MANY_REQUESTS"
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const driveMediaRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 180,
  message: {
    error: "Muitas solicitações de imagens. Tente novamente em instantes.",
    code: "TOO_MANY_MEDIA_REQUESTS",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const integrationRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  message: {
    error: "Muitas solicitações de integração. Tente novamente em instantes.",
    code: "TOO_MANY_INTEGRATION_REQUESTS",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(
  "/api/integrations/99food",
  integrationRateLimiter,
  createNinetyNineFoodRouter()
);

app.use(
  "/api/integrations/99food",
  integrationRateLimiter,
  createNinetyNineFoodAdaptiveOnboardingRouter()
);

app.use(
  "/api/store-connections/mercado-livre",
  integrationRateLimiter,
  createMercadoLivreRouter()
);

app.use(
  "/api/store-connections/mercado-livre",
  integrationRateLimiter,
  createMercadoLivreStockExecutionRouter()
);

app.use(
  "/api/store-connections/mercado-livre",
  integrationRateLimiter,
  createMercadoLivreE2ETestRouter()
);

app.use(
  "/api/store-connections",
  integrationRateLimiter,
  createStoreConnectionOnboardingRouter()
);

app.use(
  "/api/orders",
  integrationRateLimiter,
  createNinetyNineFoodStatusSyncExecutionRouter(),
  createOrderInventoryRouter()
);

app.use(
  "/api/payments",
  integrationRateLimiter,
  createPaymentIntentRouter()
);

app.use(
  "/api/store-promotions",
  integrationRateLimiter,
  createStorePromotionManagementRouter()
);

app.use(
  "/api/store-rewards",
  integrationRateLimiter,
  createStoreRewardRouter()
);

app.use(
  "/api/store-relationship",
  integrationRateLimiter,
  createStoreRelationshipRouter()
);

app.use(
  "/api/marketplace-discovery",
  integrationRateLimiter,
  createMarketplaceDiscoveryRouter()
);

app.use(
  "/api/store-crm",
  integrationRateLimiter,
  createStoreCrmRouter()
);

app.use(
  "/api/store-identity",
  integrationRateLimiter,
  createStoreInstitutionalIdentityRouter()
);

app.use(
  "/api/local-attendance",
  integrationRateLimiter,
  createLocalAttendanceRouter()
);

app.use(
  "/api/store-chat",
  integrationRateLimiter,
  createStoreCustomerChatRouter()
);

app.use(
  "/api/store-campaigns",
  integrationRateLimiter,
  createStoreCampaignRouter()
);

app.use(
  "/api/communication-preferences",
  integrationRateLimiter,
  createUserCommunicationPreferenceRouter()
);

app.use(
  "/api/notifications",
  integrationRateLimiter,
  createUserNotificationRouter()
);

app.use(
  "/api/delivery-opportunities",
  integrationRateLimiter,
  enforceDeliveryWorkEligibility,
  createDeliveryOpportunityRouter()
);

app.use(
  "/api/delivery-tracking",
  integrationRateLimiter,
  createDeliveryTrackingRouter()
);

app.use(
  "/api/paid-waiting",
  integrationRateLimiter,
  createPaidWaitingFundingResponsibilityRouter()
);

app.use(
  "/api/admin/operations",
  integrationRateLimiter,
  createOperationsHealthRouter()
);

app.use(
  "/api/admin/platform-economy",
  integrationRateLimiter,
  createPlatformEconomyRouter()
);

app.use(
  "/api/admin/mercado-livre",
  integrationRateLimiter,
  createMercadoLivrePlatformCredentialRouter()
);

app.use(
  "/api/admin/99food",
  integrationRateLimiter,
  createNinetyNineFoodPlatformCredentialRouter()
);

app.use(
  "/api/ai/consultant",
  consultantRateLimiter,
  createKyrubAiConsultantRouter()
);

app.use(
  "/api/actions",
  integrationRateLimiter,
  createKyrubActionExecutionRouter()
);

app.post("/api/consultor-kyrub", consultantRateLimiter, handleKyrubAiConsultant);

app.get("/api/drive-media", driveMediaRateLimiter, proxyPublicGoogleDriveImage);

app.post("/api/gemini", geminiRateLimiter, async (req, res) => {
  if (!ai) {
    res.status(503).json({ error: "Serviço de IA indisponível: GEMINI_API_KEY não configurada." });
    return;
  }

  try {
    const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
    if (!prompt) {
      res.status(400).json({ error: "Prompt obrigatório." });
      return;
    }
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });
    res.json({ text: response.text ?? "" });
  } catch (error) {
    console.error("[Kyrub Server] Gemini request failed", error);
    res.status(500).json({ error: "Falha ao consultar IA." });
  }
});

async function startServer() {
  if (process.env.NODE_ENV === "production") {
    app.use(express.static(path.resolve("dist")));
    app.get("*", (_req, res) => {
      res.sendFile(path.resolve("dist", "index.html"));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Kyrub Server] Running and accessible on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch(error => {
  console.error("[Kyrub Server] Failed to start", error);
  process.exit(1);
});
