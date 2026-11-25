import express from 'express';
import {createServer} from 'vite';
import {freelanceNotificationPreviewEnabled} from './freelanceNotificationService.js';
import {createUserNotificationRouter} from './userNotificationRouter.js';
import {createUserCommunicationPreferenceRouter} from './userCommunicationPreferenceRouter.js';

if(!freelanceNotificationPreviewEnabled()||process.env.VITE_KYRUB_FREELANCE_BROWSER_EMULATOR!=='true'||process.env.VITE_KYRUB_FIREBASE_EMULATOR_E2E!=='true'||process.env.VITE_KYRUB_FREELANCE_CLOUD_PREVIEW!=='true'||process.env.VITE_KYRUB_FREELANCE_NOTIFICATION_PREVIEW!=='true'||process.env.NODE_ENV==='production'||process.env.FIREBASE_SERVICE_ACCOUNT_JSON||process.env.GOOGLE_APPLICATION_CREDENTIALS)throw Error('FREELANCE_BROWSER_REQUIRES_ISOLATION');
const app=express();
app.use(express.json({limit:'32kb'}));
const permitted=new Set(['/','/read','/read-all','/freelance-applications/action','/freelance-messages/send']);
app.use('/api/notifications',(req,res,next)=>permitted.has(req.path)?next():res.sendStatus(404),createUserNotificationRouter());
app.use('/api/communication-preferences',createUserCommunicationPreferenceRouter());
app.use('/api',(_req,res)=>res.sendStatus(404));
const vite=await createServer({server:{middlewareMode:true},appType:'spa'});
app.use(vite.middlewares);
app.listen(Number(process.env.PORT||3000),'127.0.0.1');
