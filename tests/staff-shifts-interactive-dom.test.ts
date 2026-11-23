import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {writeFile,unlink} from 'node:fs/promises';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';

test('the fourth Central card publishes a work shift and employee can read it',async()=>{
  const dom=new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',{
    url:'https://www.kyrub.com/staff',pretendToBeVisual:true,
  });
  const originals=new Map<string,PropertyDescriptor|undefined>();
  for(const [key,value] of Object.entries({
    window:dom.window,document:dom.window.document,
    navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,
    Element:dom.window.Element,Event:dom.window.Event,
    MutationObserver:dom.window.MutationObserver,
    IS_REACT_ACT_ENVIRONMENT:true,
  })){
    originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));
    Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  }
  const oldFetch=globalThis.fetch;
  const storeId='shifts_dom_fake_store';
  const assigneeId='staff_seller_12345';
  let shifts:any[]=[];
  const requests:any[]=[];
  globalThis.fetch=async(resource:RequestInfo|URL,init?:RequestInit):Promise<Response>=>{
    const url=String(resource),method=init?.method||'GET';
    assert.equal(new Headers(init?.headers).get('authorization'),'Bearer shifts-fake-token');
    const payload=init?.body?JSON.parse(String(init.body)):null;
    requests.push({url,method,payload});
    const json=(data:unknown)=>new Response(JSON.stringify(data),{
      status:200,headers:{'content-type':'application/json'},
    });
    if(url.startsWith('/api/staff/shifts/assignees?')&&method==='GET'){
      return json({assignees:[{userId:assigneeId,role:'seller',label:'Vendedor'}]});
    }
    if(url.startsWith('/api/staff/shifts?')&&method==='GET')return json({shifts});
    if(url==='/api/staff/shifts'&&method==='POST'){
      assert.equal(payload.storeId,storeId);
      assert.equal(payload.assignedTo,assigneeId);
      assert.equal(payload.kind,'shift');
      shifts=[{
        ...payload,id:payload.requestId,canonicalStoreId:storeId,legacyStoreId:storeId,
        assignedRole:'seller',status:'published',
        createdBy:'manager_12345',createdAt:'2026-11-23T03:00:00.000Z',
        updatedAt:'2026-11-23T03:00:00.000Z',
        cancelledAt:'',cancelledBy:'',cancelReason:'',version:1,
      }];
      return json({shift:shifts[0]});
    }
    if(url==='/api/staff/shifts/cancel'&&method==='POST'){
      assert.equal(payload.expectedVersion,1);
      shifts=[{...shifts[0],status:'cancelled',version:2,cancelReason:payload.reason,
        cancelledAt:'2026-11-23T04:00:00.000Z'}];
      return json({shift:shifts[0]});
    }
    throw Error('UNEXPECTED_NETWORK_ACCESS:'+url);
  };
  const bundle=await build({
    stdin:{
      contents:"export { StoreStaffCentralWorkspace } from './src/components/store/StoreStaffCentralWorkspace.tsx'; export { StoreStaffShiftInbox } from './src/components/store/StoreStaffShiftInbox.tsx';",
      resolveDir:process.cwd(),sourcefile:'shift-dom-entry.ts',loader:'ts',
    },
    bundle:true,platform:'node',format:'esm',packages:'external',write:false,
    plugins:[{name:'staff-shifts-auth-mock',setup(b){
      b.onResolve({filter:/firebase$/},args=>
        args.importer.includes('/src/utils/')||args.importer.includes('/src/components/store/')
          ?{path:'shifts-auth',namespace:'isolated'}:undefined);
      b.onLoad({filter:/.*/,namespace:'isolated'},()=>({
        contents:`export const auth={currentUser:{uid:'${assigneeId}',getIdToken:async()=> 'shifts-fake-token'}};`,
        loader:'js',
      }));
    }}],
  });
  const filename=new URL('../.staff-shifts-dom-'+randomUUID()+'.mjs',import.meta.url);
  let root:{render:(element:unknown)=>void;unmount:()=>void}|undefined;
  try{
    await writeFile(filename,bundle.outputFiles[0].text);
    const {createElement,act}=await import('react');
    const {createRoot}=await import('react-dom/client');
    const {StoreStaffCentralWorkspace,StoreStaffShiftInbox}=await import(filename.href);
    root=createRoot(dom.window.document.getElementById('root')!);
    const settle=async()=>{await act(async()=>{await new Promise(resolve=>setTimeout(resolve,40));});};
    const press=async(title:string)=>{
      const button=[...dom.window.document.querySelectorAll<HTMLButtonElement>('button')]
        .find(item=>item.textContent?.includes(title));
      assert.ok(button,'Missing button '+title+': '+dom.window.document.body.textContent?.slice(0,800));
      await act(async()=>button.click());
      await settle();
    };
    const change=async(selector:string,value:string)=>{
      const input=dom.window.document.querySelector<HTMLInputElement>(selector);
      assert.ok(input,'Missing input '+selector);
      const descriptor=Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value');
      await act(async()=>{
        descriptor!.set!.call(input,value);
        input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
        input.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
      });
    };
    await act(async()=>root!.render(createElement(StoreStaffCentralWorkspace,{storeId})));
    assert.equal(dom.window.document.querySelectorAll('[data-kyrub-staff-central-card]').length,4);
    await press('Gerenciar escalas');
    assert.ok(dom.window.document.querySelector('[data-kyrub-staff-shifts-manager]'));
    const select=dom.window.document.querySelector<HTMLSelectElement>('#staff-shift-assignee');
    assert.ok(select);
    await act(async()=>{
      select!.value=assigneeId;
      select!.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
    });
    await change('input#staff-shift-date','2026-12-15');
    await change('input#staff-shift-sector','Atendimento');
    await press('Publicar escala');
    assert.equal(shifts.length,1);
    assert.equal(shifts[0].sector,'Atendimento');
    assert.equal(shifts[0].scheduledDate,'2026-12-15');
    await act(async()=>root!.render(createElement(StoreStaffShiftInbox,{storeId})));
    await settle();
    assert.ok(dom.window.document.querySelector('[data-kyrub-staff-shifts-inbox]'));
    assert.ok(dom.window.document.body.textContent?.includes('Atendimento'));
    assert.ok(dom.window.document.body.textContent?.includes('15/12/2026'));
    await act(async()=>root!.render(createElement(StoreStaffCentralWorkspace,{storeId})));
    await press('Gerenciar escalas');
    await press('Cancelar escala');
    await press('Confirmar cancelamento');
    assert.equal(shifts[0].status,'cancelled');
    assert.ok(dom.window.document.body.textContent?.includes('Cancelada'));
    assert.equal(requests.filter(item=>item.url==='/api/staff/shifts').length,1);
    assert.equal(requests.filter(item=>item.url==='/api/staff/shifts/cancel').length,1);
  }finally{
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
