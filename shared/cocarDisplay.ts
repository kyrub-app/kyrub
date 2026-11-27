/** Public terminology only. Persisted XP fields, balances, grants, thresholds
 * and conversion API remain unchanged. Never infer a balance from this label. */
export function formatCocarCount(value:number):string{
 if(!Number.isSafeInteger(value)||value<0)throw Error('COCAR_DISPLAY_INVALID');
 return value.toLocaleString('pt-BR')+' '+(value===1?'Cocar':'Cocares');
}
export function formatCocarCompact(value:number):string{
 if(!Number.isSafeInteger(value)||value<0)throw Error('COCAR_DISPLAY_INVALID');
 return value.toLocaleString('pt-BR')+'X';
}
