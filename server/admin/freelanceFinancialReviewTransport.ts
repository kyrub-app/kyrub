import {financialReviewAdminEnabled,listFreelanceFinancialReviews} from './freelanceFinancialReviewService.js';
type Request={method?:string;headers:Record<string,string|string[]|undefined>;query?:Record<string,unknown>};
type Response={setHeader(name:string,value:string):unknown;status(code:number):{json(body:unknown):unknown}};
export async function handleFreelanceFinancialReview(req:Request,res:Response){
 res.setHeader('Cache-Control','private, no-store, max-age=0');
 res.setHeader('X-Content-Type-Options','nosniff');
 try{if(!financialReviewAdminEnabled())throw Error('DISABLED');}catch{res.status(503).json({code:'FREELANCE_FINANCIAL_REVIEW_DISABLED'});return;}
 if(req.method!=='GET'){res.setHeader('Allow','GET');res.status(405).json({code:'METHOD_NOT_ALLOWED'});return;}
 const h=req.headers.authorization;
 if(typeof h!=='string'||h.length>8199||!/^Bearer [^\s]+$/i.test(h)){res.status(401).json({code:'AUTH_REQUIRED'});return;}
 if(Object.keys(req.query??{}).some(k=>k!=='cursor')){res.status(400).json({code:'FREELANCE_INVALID'});return;}
 try{res.status(200).json(await listFreelanceFinancialReviews(h,req.query?.cursor));}
 catch(e){
  const code=e instanceof Error?e.message:'';
  const status=['second_factor_required','reauthentication_required','FORBIDDEN','FREELANCE_FORBIDDEN'].includes(code)?403:
   ['authentication_required','AUTH_REQUIRED'].includes(code)||code.startsWith('Firebase ID token')?401:code==='FREELANCE_INVALID'?400:
   ['FREELANCE_FINANCIAL_REVIEW_CONFLICT','FREELANCE_RESTRICTION_CONFLICT','FREELANCE_PAYMENT_OBLIGATION_CONFLICT'].includes(code)?409:503;
  res.status(status).json({code:status===503?'FREELANCE_FINANCIAL_REVIEW_UNAVAILABLE':status===401?'AUTH_REQUIRED':code});
 }
}
