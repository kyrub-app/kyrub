/** Instant, local contact-name matching; no directory expansion or network request. */
function normalize(value:string):string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR').trim().replace(/\s+/g,' ');
}
export function matchesTribeContactName(name:string,search:string):boolean {
  const term=normalize(search);
  if(!term)return true;
  const normalized=normalize(name);
  return term.split(' ').every(part=>normalized.includes(part));
}
