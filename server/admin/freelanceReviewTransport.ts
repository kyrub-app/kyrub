import {decideFreelanceReview,listFreelanceReviews} from './freelanceReviewService.js';
type Request={method?:string;headers:Record<string,string|string[]|undefined>;query?:Record<string,string|string[]|undefined>;body?:unknown};
type Response={setHeader(name:string,value:string):unknown;status(code:number):{json(body:unknown):unknown}};
type Dependencies={list:typeof listFreelanceReviews;decide:typeof decideFreelanceReview;enabled:()=>boolean};
const defaults:Dependencies={list:listFreelanceReviews,decide:decideFreelanceReview,
  enabled:()=>process.env.KYRUB_FREELANCE_ADMIN_REVIEW_ENABLED==='true'&&process.env.VERCEL_ENV==='production'};
export async function handleFreelanceReview(request:Request,response:Response,deps:Dependencies=defaults){
  response.setHeader('Cache-Control','private, no-store, max-age=0');
  if(!deps.enabled()){response.status(503).json({code:'FREELANCE_REVIEW_DISABLED'});return;}
  if(request.method!=='GET'&&request.method!=='POST'){response.setHeader('Allow','GET, POST');response.status(405).json({code:'METHOD_NOT_ALLOWED'});return;}
  const authorization=request.headers.authorization??request.headers.Authorization;
  if(typeof authorization!=='string'||!/^Bearer [^\s]+$/i.test(authorization)||authorization.length>8199){response.status(401).json({code:'AUTH_REQUIRED'});return;}
  try{
    if(request.method==='GET'){
      response.status(200).json(await deps.list(authorization,request.query?.cursor));return;
    }
    const media=request.headers['content-type'];
    if(typeof media!=='string'||!/^application\/json(?:\s*;|$)/i.test(media)){response.status(415).json({code:'JSON_REQUIRED'});return;}
    if(Buffer.byteLength(JSON.stringify(request.body)??'','utf8')>8192){response.status(413).json({code:'PAYLOAD_TOO_LARGE'});return;}
    response.status(200).json(await deps.decide(authorization,request.body));
  }catch(error){
    const code=error instanceof Error?error.message:'';
    if(['second_factor_required','reauthentication_required','FORBIDDEN','FREELANCE_FORBIDDEN'].includes(code)){response.status(403).json({code});return;}
    if(code==='authentication_required'||code==='AUTH_REQUIRED'){response.status(401).json({code:'AUTH_REQUIRED'});return;}
    if(code==='FREELANCE_INVALID'){response.status(400).json({code});return;}
    if(code==='FREELANCE_CONFLICT'){response.status(409).json({code});return;}
    response.status(503).json({code:'FREELANCE_REVIEW_UNAVAILABLE'});
  }
}
