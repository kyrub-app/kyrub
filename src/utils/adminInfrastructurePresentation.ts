// Display emulator-only amounts as fixtures, never as actual cost or cost/MAU.
export function presentInfrastructureDiagnostic(value:unknown,expectedMonth:unknown):{month:string|null;fixturePaidMinor:number|null;fixtureCount:number|null}{
  const missing={month:null,fixturePaidMinor:null,fixtureCount:null};
  if(!value||typeof value!=='object'||Array.isArray(value))return missing;
  const d=value as Record<string,unknown>;
  if(d.scope!=='emulator_only'||d.status!=='fixture_partial'||d.timeZone!=='America/Sao_Paulo'||d.basis!=='cash'||
     d.actualInfrastructureCostMinor!==null||d.realMau!==null||typeof d.month!=='string'||d.month!==expectedMonth||
     !/^\d{4}-(0[1-9]|1[0-2])$/.test(d.month)||
     typeof d.registeredPaidMinor!=='number'||!Number.isSafeInteger(d.registeredPaidMinor)||d.registeredPaidMinor<=0||
     typeof d.matchedCount!=='number'||!Number.isSafeInteger(d.matchedCount)||d.matchedCount<=0||d.matchedCount>500)return missing;
  return {month:d.month,fixturePaidMinor:d.registeredPaidMinor,fixtureCount:d.matchedCount};
}
