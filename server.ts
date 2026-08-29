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
import { createDeliveryOpportunityRouter } from "./server/delivery/deliveryOpportunityRouter";
import { createDeliveryTrackingRouter } from "./server/delivery/deliveryTrackingRouter";
import { createOperationsHealthRouter } from "./server/admin/operationsHealthRouter";
import { createOrderInventoryRouter } from "./server/inventory/orderInventoryRouter";
import { createKyrubAiConsultantRouter } from "./server/ai/consultantRouter";
import { createKyrubActionExecutionRouter } from "./server/actions/actionExecutionRouter";
import { createStoreCustomerChatRouter } from "./server/chat/storeCustomerChatRouter";
import { createStoreCampaignRouter } from "./server/campaigns/storeCampaignRouter";
import { createUserCommunicationPreferenceRouter } from "./server/notifications/userCommunicationPreferenceRouter";
import { createUserNotificationRouter } from "./server/notifications/userNotificationRouter";
import { createPaymentIntentRouter } from "./server/payments/paymentIntentRouter";
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
  "/api/orders",
  integrationRateLimiter,
  createOrderInventoryRouter()
);

app.use(
  "/api/payments",
  integrationRateLimiter,
  createPaymentIntentRouter()
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
  "/api/store-campaigns",
  integrationRateLimiter,
  createStoreCampaignRouter()
);

app.use(
  "/api/store-identity",
  integrationRateLimiter,
  createStoreInstitutionalIdentityRouter()
);

app.use(
  "/api/store-chat",
  integrationRateLimiter,
  createStoreCustomerChatRouter()
);

app.use(
  "/api/notifications",
  integrationRateLimiter,
  createUserNotificationRouter()
);

app.use(
  "/api/communication-preferences",
  integrationRateLimiter,
  createUserCommunicationPreferenceRouter()
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
  enforceDeliveryWorkEligibility,
  createDeliveryTrackingRouter()
);

app.use(
  "/api/admin/operations/health",
  integrationRateLimiter,
  createOperationsHealthRouter()
);

app.use(
  "/api/actions",
  integrationRateLimiter,
  createKyrubActionExecutionRouter()
);

app.all(
  "/api/consultor-kyrub",
  consultantRateLimiter,
  async (request, response) => {
    await handleKyrubAiConsultant(request, response);
  }
);

app.use(
  "/api/ai/consultant",
  consultantRateLimiter,
  createKyrubAiConsultantRouter()
);

app.post("/api/gemini/generate", geminiRateLimiter, async (req: express.Request, res: express.Response) => {
  const { prompt } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: "O campo 'prompt' é obrigatório." });
  }

  if (!ai) {
    return res.status(503).json({
      error: "A inteligência do Kyrub ainda não foi configurada neste ambiente.",
      code: "AI_NOT_CONFIGURED",
    });
  }

  try {
    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash",
      contents: prompt,
      config: {
        systemInstruction: `Você é o Consultor Kyrub. Responda em português do Brasil, de forma clara e prática. Nunca diga que executou ações no aplicativo quando apenas gerou texto. Nunca invente dados do usuário.`,
        temperature: 0.7,
      },
    });
    res.json({ text: response.text });
  } catch (error: any) {
    console.error("[Kyrub Server] Gemini generation error:", error);
    res.status(500).json({ error: "Erro interno ao processar inteligência do Kyrub: " + (error.message || String(error)) });
  }
});

app.get(
  "/api/media/drive",
  driveMediaRateLimiter,
  async (req: express.Request, res: express.Response) =>
    proxyPublicGoogleDriveImage(req.query.fileId, res)
);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", app: "Kyrub", version: "1.5.0" });
});

async function bootstrap() {
  if (process.env.NODE_ENV !== "production") {
    console.log("[Kyrub Server] Running in DEVELOPMENT mode. Initializing Vite middleware...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("[Kyrub Server] Running in PRODUCTION mode. Serving static assets...");
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Kyrub Server] Running and accessible on http://0.0.0.0:${PORT}`);
  });
}

bootstrap().catch((err) => {
  console.error("[Kyrub Server] Critical bootstrapping failure:", err);
});
