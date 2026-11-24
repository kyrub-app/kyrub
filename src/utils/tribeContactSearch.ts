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

/** Deliberate unlock command in the existing search field. The marker is not
 * part of the code; do not normalize, log or forward it to ordinary search.
 * This parser has no network access and cannot unlock anything on its own.
 */
export function splitTribeSearchInput(value:string,unlockAvailable:boolean):
 {kind:'search';term:string}|{kind:'unlock';code:string}{
 return unlockAvailable&&value.startsWith('!')?{kind:'unlock',code:value.slice(1)}:{kind:'search',term:value};
}
