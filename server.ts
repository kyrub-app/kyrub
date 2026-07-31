import express from "express";
import path from "path";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { createServer as createViteServer } from "vite";
import { proxyPublicGoogleDriveImage } from "./server/driveMediaProxy";
import {
  createNinetyNineFoodRouter,
  type RawBodyRequest,
} from "./server/integrations/ninetyNineFoodRouter";
import { createDeliveryOpportunityRouter } from "./server/delivery/deliveryOpportunityRouter";
import { createOperationsHealthRouter } from "./server/admin/operationsHealthRouter";
import { createOrderInventoryRouter } from "./server/inventory/orderInventoryRouter";
import { createKyrubAiConsultantRouter } from "./server/ai/consultantRouter";

// Load environment variables
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

// Initialize the legacy server-side Gemini endpoint.
// Never expose process.env.GEMINI_API_KEY to the client/browser bundle.
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

// ==========================================
// 5. RATE LIMITING & API PROTECTION
// ==========================================
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
  "/api/delivery-opportunities",
  integrationRateLimiter,
  createDeliveryOpportunityRouter()
);

app.use(
  "/api/admin/operations/health",
  integrationRateLimiter,
  createOperationsHealthRouter()
);

app.use(
  "/api/ai/consultant",
  consultantRateLimiter,
  createKyrubAiConsultantRouter()
);

// Legacy Gemini Assistant Endpoint kept for compatibility with older screens.
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

// Simple health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", app: "Kyrub", version: "1.5.0" });
});

// Serve static assets in production, hook Vite dev server in development
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
