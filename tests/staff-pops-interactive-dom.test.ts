import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

test('the approved four-card Central exposes the real POP editor and employee reading receipt', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url:'https://www.kyrub.com/staff', pretendToBeVisual:true,
  });
  const originals = new Map<string,PropertyDescriptor | undefined>();
  for (const [key,value] of Object.entries({
    window:dom.window,document:dom.window.document,
    navigator:dom.window.navigator,
    HTMLElement:dom.window.HTMLElement,Element:dom.window.Element,
    Event:dom.window.Event,MutationObserver:dom.window.MutationObserver,
    IS_REACT_ACT_ENVIRONMENT:true,
  })) {
    originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));
    Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  }
  const oldFetch=globalThis.fetch;
  const storeId='isolated_pop_store';
  const records:any[]=[];
  let receipt='';
  const requests:any[]=[];
  globalThis.fetch=async (resource:RequestInfo | URL,init?:RequestInit):Promise<Response> => {
    const url=String(resource),method=init?.method || 'GET';
    const bearer=new Headers(init?.headers).get('authorization');
    assert.equal(bearer,'Bearer pop-fake-token');
    const payload=init?.body ? JSON.parse(String(init.body)) : null;
    requests.push({url,method,payload});
    const json=(data:unknown)=>new Response(JSON.stringify(data),{
      status:200,headers:{'content-type':'application/json'}
    });
    if(url.startsWith('/api/staff/pops?') && method==='GET') {
      assert.ok(url.includes('storeId='+storeId));
      return json({procedures:records.map(item=>({...item,readAt:receipt}))});
    }
    if(url==='/api/staff/pops' && method==='POST') {
      assert.equal(payload.storeId,storeId);
      assert.equal(payload.expectedVersion,records[0]?.currentVersion || 0);
      assert.deepEqual(payload.audienceRoles,['seller']);
      const version=(records[0]?.currentVersion || 0)+1;
      records[0]={
        id:payload.procedureId,title:payload.title,currentVersion:version,
        audienceRoles:payload.audienceRoles,
        publishedAt:'2026-11-22T23:00:00.000Z',
        revision:{
          id:payload.procedureId,version,title:payload.title,body:payload.body,
          audienceRoles:payload.audienceRoles,attachment:null,
          publishedAt:'2026-11-22T23:00:00.000Z'
        },
      };
      receipt='';
      return json({procedure:records[0]});
    }
    if(url==='/api/staff/pops/read' && method==='POST') {
      assert.equal(payload.storeId,storeId);
      assert.equal(payload.procedureId,records[0].id);
      assert.equal(payload.version,records[0].currentVersion);
      receipt='2026-11-22T23:20:00.000Z';
      return json({readAt:receipt});
    }
    if(url.startsWith('/api/staff/pops/history?') && method==='GET') {
      return json({versions:[records[0].revision]});
    }
    throw Error('UNEXPECTED_NETWORK_ACCESS:'+url);
  };
  const bundle=await build({
    stdin:{
      contents:"export { StoreStaffCentralWorkspace } from './src/components/store/StoreStaffCentralWorkspace.tsx'; export { StoreStaffPopInbox } from './src/components/store/StoreStaffPopInbox.tsx';",
      resolveDir:process.cwd(),sourcefile:'pop-dom-entry.ts',loader:'ts',
    },bundle:true,platform:'node',format:'esm',packages:'external',write:false,
    plugins:[{name:'local-firebase-identity-mock',setup(b) {
      b.onResolve({filter:/^\.\/firebase$/},args=>args.importer.endsWith('/src/utils/staffProcedures.ts')
        ? {path:'staff-pop-auth',namespace:'isolated'} : undefined);
      b.onLoad({filter:/.*/,namespace:'isolated'},()=>({
        contents:"export const auth={currentUser:{uid:'staff-tester',getIdToken:async()=> 'pop-fake-token'}};",
        loader:'js',
      }));
    }}]
  });
  const filename=new URL('../.staff-pops-dom-'+randomUUID()+'.mjs',import.meta.url);
  let root:{render:(element:unknown)=>void;unmount:()=>void}|undefined;
  try {
    await writeFile(filename,bundle.outputFiles[0].text);
    const {createElement,act}=await import('react');
    const {createRoot}=await import('react-dom/client');
    const {StoreStaffCentralWorkspace,StoreStaffPopInbox}=await import(filename.href);
    root=createRoot(dom.window.document.getElementById('root')!);
    const settle=async()=>{await act(async()=>{await new Promise(resolve=>setTimeout(resolve,30));})};
    const press=async(text:string)=>{
      const button=[...dom.window.document.querySelectorAll<HTMLButtonElement>('button')]
        .find(item=>item.textContent?.includes(text));
      assert.ok(button,'Missing button '+text+': '+dom.window.document.body.textContent?.slice(0,800));
      await act(async()=>button.click());
      await settle();
    };
    const change=async(selector:string,value:string)=>{
      const input=dom.window.document.querySelector<HTMLInputElement|HTMLTextAreaElement>(selector);
      assert.ok(input,'Missing input '+selector);
      const descriptor=Object.getOwnPropertyDescriptor(
        selector.startsWith('textarea') ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype,
        'value');
      await act(async()=>{
        descriptor!.set!.call(input,value);
        input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
        input.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
      });
    };
    await act(async()=>root!.render(createElement(StoreStaffCentralWorkspace,{storeId})));
    assert.equal(dom.window.document.querySelectorAll('[data-kyrub-staff-central-card]').length,4);
    assert.ok(dom.window.document.body.textContent?.includes('Avisos e comunicados'));
    await press('Gerenciar manuais');
    assert.ok(dom.window.document.querySelector('[data-kyrub-staff-pops-manager]'));
    await press('Criar manual POP');
    await change('input#staff-pop-title','POP de conferência');
    await change('textarea#staff-pop-body','Verifique as máquinas.');
    const select=dom.window.document.querySelector<HTMLSelectElement>('select#staff-pop-audience');
    assert.ok(select);
    await act(async()=>{
      select!.value='seller';
      select!.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
    });
    await press('Publicar manual POP');
    assert.equal(records.length,1);
    assert.equal(records[0].title,'POP de conferência');
    assert.equal(records[0].currentVersion,1);
    assert.ok(dom.window.document.body.textContent?.includes('Procedimentos publicados'));
    await act(async()=>root!.render(createElement(StoreStaffPopInbox,{storeId})));
    await settle();
    assert.ok(dom.window.document.querySelector('[data-kyrub-staff-pops-inbox]'));
    assert.ok(dom.window.document.body.textContent?.includes('Pendente'));
    await press('Confirmar leitura desta versão');
    assert.ok(dom.window.document.body.textContent?.includes('Leitura confirmada'));
    assert.equal(receipt,'2026-11-22T23:20:00.000Z');
    assert.equal(requests.filter(x=>x.method==='POST').length,2);
  } finally {
    if(root){const {act}=await import('react');await act(async()=>root!.unmount());}
    await unlink(filename).catch(()=>{});
    globalThis.fetch=oldFetch;
    for(const [key,descriptor] of originals){
      if(descriptor)Object.defineProperty(globalThis,key,descriptor);
      else delete (globalThis as any)[key];
    }
    dom.window.close();
  }
});
