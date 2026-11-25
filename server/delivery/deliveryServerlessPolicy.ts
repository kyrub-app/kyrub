export type DeliveryWorkAction =
  | {kind:'publish';id:string}
  | {kind:'status';id:string}
  | {kind:'pickup-code';id:string}
  | {kind:'secure-pickup';id:string}
  | {kind:'customer-arrival';id:string}
  | {kind:'buyer-confirmation';id:string}
  | {kind:'earnings'};

const validId=(value:string)=>/^[A-Za-z0-9_-]{1,180}$/.test(value);

export function parseDeliveryWorkRoute(method:string,path:string):DeliveryWorkAction|null{
  const verb=method.toUpperCase(),clean=path.trim().replace(/^\/+|\/+$/g,'');
  if(verb==='GET'&&clean==='earnings')return {kind:'earnings'};
  const publish=/^orders\/([^/]+)\/publish$/.exec(clean);
  if(verb==='POST'&&publish&&validId(publish[1]))return {kind:'publish',id:publish[1]};
  const single=/^([^/]+)\/(status|pickup-code|secure-pickup|customer-arrival|buyer-confirmation)$/.exec(clean);
  if(!single||!validId(single[1]))return null;
  const kind=single[2];
  if((kind==='pickup-code'&&verb==='GET')||(kind!=='pickup-code'&&verb==='POST'))
    return {kind:kind as Exclude<DeliveryWorkAction['kind'],'publish'|'earnings'>,id:single[1]};
  return null;
}
