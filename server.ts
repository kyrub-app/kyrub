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

// Initialize server-side Gemini SDK (as per the gemini-api skill instructions)
// Never expose process.env.GEMINI_API_KEY to the client/browser bundle!
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
  console.warn("[Kyrub Server] WARNING: GEMINI_API_KEY environment variable is not set. AI features will run in mock mode.");
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
  "/api/delivery-opportunities",
  integrationRateLimiter,
  createDeliveryOpportunityRouter()
);

// Gemini Assistant Endpoint
app.post("/api/gemini/generate", geminiRateLimiter, async (req: express.Request, res: express.Response) => {
  const { prompt } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: "O campo 'prompt' é obrigatório." });
  }

  // If API key is missing, respond with a helpful mock dialogue under Kyrub brand
  if (!ai) {
    const mockResponses = [
      `Olá! Sou o Mentor Kyrub. Para ativar minhas respostas inteligentes reais alimentadas pelo Gemini 3.5, configure sua GEMINI_API_KEY no painel de Secrets da plataforma. No momento, estou simulando em modo offline!`,
      `Como Mentor Kyrub, aconselho você a verificar os splits de pagamento do Fator MD. Cada centavo deve ser auditável para evitar atritos entre fornecedores e lojistas no ecossistema Kyrub.`,
      `Estratégia de Produto Kyrub: No modelo multi-tenant, limite os lojistas do plano grátis a 5 produtos. Isso cria um funil perfeito de conversão para o plano Business de R$ 99/mês.`,
    ];
    const randomIndex = Math.floor(Math.random() * mockResponses.length);
    return res.json({ text: mockResponses[randomIndex] + `\n\n[SIMULAÇÃO OFFLINE - ADICIONE A API KEY PARA RESPOSTA REAL]` });
  }

  try {
    // Basic Q&A / assistant task -> Use gemini-3.5-flash as per skill guide
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        systemInstruction: `Você é o Mentor Kyrub, um assistente virtual especialista em negócios, inteligência de mercado, ERP, split de pagamentos e arquitetura cloud de alto desempenho.
Você faz parte do Kyrub Super App (anteriormente Uhub / Fator MD).
Sua linguagem deve ser profissional, inspiradora, focada em resolver problemas de lojistas, fornecedores e donos de plataforma (B2B2C).
Nunca mencione as marcas antigas "Uhub", "Fator MD" ou "Mentor Fator MD", apenas o "Kyrub" e "Mentor Kyrub".
Ajude o usuário com conselhos realistas sobre concorrência no Firestore, estratégias de precificação, tributação de split de pagamentos e otimização de logística.`,
        temperature: 0.7,
      },
    });

    res.json({ text: response.text });
  } catch (error: any) {
    console.error("[Kyrub Server] Gemini generation error:", error);
    res.status(500).json({ error: "Erro interno ao processar inteligência do Mentor Kyrub: " + (error.message || String(error)) });
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
  res.json({ status: "ok", app: "Kyrub", version: "1.4.0" });
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
