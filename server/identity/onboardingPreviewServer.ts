import express from 'express';
import { createServer } from 'vite';
import { ageScreeningEmulatorsReady, createAgeScreeningRouter } from './ageScreeningRouter.js';
if (!ageScreeningEmulatorsReady(process.env) || process.env.VITE_KYRUB_ONBOARDING_EMULATOR !== 'true') throw Error('ONBOARDING_PREVIEW_REQUIRES_EMULATORS');
const app = express();
app.use('/api/onboarding/age',createAgeScreeningRouter());
// Only the explicitly isolated personal workspace may be mounted here.
if(process.env.KYRUB_PERSONAL_PREVIEW_ENABLED==='true'){
 const {createPrivatePersonalPreviewRouter}=await import('./privatePersonalPreviewRouter.js');
 app.use('/api/onboarding/personal',createPrivatePersonalPreviewRouter());
}
// Do not mount any legacy application backend in this harness.
app.use('/api',(_req,res)=>res.sendStatus(404));
const vite = await createServer({server:{middlewareMode:true},appType:'spa'});
app.use(vite.middlewares);
app.listen(Number(process.env.PORT||3000),'127.0.0.1');
