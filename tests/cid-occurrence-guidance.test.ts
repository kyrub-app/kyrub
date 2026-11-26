import assert from 'node:assert/strict';
import {test} from 'node:test';
import {classifyCidOccurrence,assessCidReturnMessage} from '../server/identity/cidOccurrenceGuidance';
test('categorias reconhecidas sem depender de IA ou alterar o alerta',()=>{
 for(const [reason,category] of [
  ['Encontrei um cachorro','animal-found'],['Tag encontrada','object-found'],
  ['Acidente de trânsito','accident'],['Pessoa passando mal','illness'],
  ['Foi um teste','test-or-mistake'],['Preciso explicar','unclear']
 ]){
  const result=classifyCidOccurrence(reason);
  assert.equal(result.category,category);assert.equal(result.advisoryOnly,true);assert.ok(result.prompt);
 }
});
test('emergência potencial continua sinalizada mesmo com categoria divergente ou teste',()=>{
 const mixed=classifyCidOccurrence('Foi um teste, pessoa ferida');
 assert.equal(mixed.category,'unclear');assert.equal(mixed.possibleEmergency,true);
 const selected=classifyCidOccurrence('Acidente','test-or-mistake');
 assert.equal(selected.source,'participant-confirmed');assert.equal(selected.possibleEmergency,true);
 assert.match(selected.prompt,/perigo imediato/);
 assert.equal(classifyCidOccurrence('Acidente','invalid').category,'accident');
});
test('pagamento condicionado gera orientação privada, sem acusação',()=>{
 const result=assessCidReturnMessage('Só devolvo seu cachorro se pagar 500 reais','owner');
 assert.equal(result?.kind,'possible-conditional-payment');
 assert.equal(result?.privateTo,'owner');
 assert.match(result?.text??'',/não comprova uma infração/);
 assert.equal(assessCidReturnMessage('Só devolvo o animal se fizer o Pix','contact'),null);
 assert.equal(assessCidReturnMessage('Só devolvo o animal se fizer o Pix','emitter'),null);
 assert.equal(assessCidReturnMessage('Quero oferecer uma recompensa pela devolução','owner'),null);
 assert.equal(assessCidReturnMessage('Encontrei o animal e posso devolver sem pagamento','owner'),null);
 assert.equal(assessCidReturnMessage('Só entrego quando você chegar','owner'),null);
});
