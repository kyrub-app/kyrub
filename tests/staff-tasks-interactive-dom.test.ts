import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

test('the third Central card assigns a checklist and employee can check off a step', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url:'https://www.kyrub.com/staff',pretendToBeVisual:true,
  });
  const original=new Map<string,PropertyDescriptor | undefined>();
  for(const [key,value] of Object.entries({
    window:dom.window,document:dom.window.document,
    navigator:dom.window.navigator,
    HTMLElement:dom.window.HTMLElement,Element:dom.window.Element,
    Event:dom.window.Event,MutationObserver:dom.window.MutationObserver,
    IS_REACT_ACT_ENVIRONMENT:true,
  })) {
    original.set(key,Object.getOwnPropertyDescriptor(globalThis,key));
    Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  }
  const priorFetch=globalThis.fetch;
  const storeId='tasks_dom_emulated';
  const managerId='manager_123456';
  const assigneeId='employee_123456';
  let records:any[]=[];
  const calls:any[]=[];
  globalThis.fetch=async (resource:RequestInfo | URL,init?:RequestInit):Promise<Response> => {
    const url=String(resource), method=init?.method || 'GET';
    assert.equal(new Headers(init?.headers).get('authorization'),'Bearer staff-fake-token');
    const payload=init?.body?JSON.parse(String(init.body)):null;
    calls.push({url,method,payload});
    const json=(data:unknown)=>new Response(JSON.stringify(data),{
      status:200,headers:{'content-type':'application/json'},
    });
    if(url.startsWith('/api/staff/tasks/assignees?')&&method==='GET')
      return json({assignees:[
        {userId:managerId,role:'manager',label:'Gerente'},
        {userId:assigneeId,role:'seller',label:'Vendedor'},
      ]});
    if(url.startsWith('/api/staff/tasks?')&&method==='GET')
      return json({tasks:records});
    if(url==='/api/staff/tasks'&&method==='POST') {
      assert.equal(payload.storeId,storeId);
      assert.equal(payload.assignedTo,assigneeId);
      assert.deepEqual(payload.steps,['Verificar máquinas','Conferir o caixa']);
      records=[{
        id:payload.requestId,canonicalStoreId:storeId,legacyStoreId:storeId,
        title:payload.title,details:payload.details,
        assignedTo:payload.assignedTo,assignedRole:'seller',dueDate:payload.dueDate,
        steps:payload.steps.map((label:string,i:number)=>({
          id:String(i+1),label,completedAt:'',completedBy:'',
        })),
        createdBy:managerId,createdAt:'2026-11-22T23:00:00.000Z',
        updatedAt:'2026-11-22T23:00:00.000Z',completedAt:'',
        version:1,status:'open',
      }];
      return json({task:records[0]});
    }
    if(url==='/api/staff/tasks/step'&&method==='POST') {
      assert.equal(payload.storeId,storeId);
      assert.equal(payload.taskId,records[0].id);
      assert.equal(payload.stepId,'1');
      assert.equal(payload.expectedVersion,1);
      records[0]={...records[0],version:2,steps:records[0].steps.map((step:any,i:number)=>
        i===0?{...step,completedAt:'2026-11-23T00:00:00.000Z',completedBy:assigneeId}:step)};
      return json({task:records[0]});
    }
    throw Error('UNEXPECTED_NETWORK_ACCESS:'+url);
  };
  const bundle=await build({
    stdin:{
      contents:"export { StoreStaffCentralWorkspace } from './src/components/store/StoreStaffCentralWorkspace.tsx'; export { StoreStaffTasksInbox } from './src/components/store/StoreStaffTasksInbox.tsx';",
      resolveDir:process.cwd(),sourcefile:'tasks-dom-entry.ts',loader:'ts',
    },
    bundle:true,platform:'node',format:'esm',packages:'external',write:false,
    plugins:[{name:'staff-auth-stub',setup(b) {
      b.onResolve({filter:/firebase$/},args=>
        (args.importer.includes('/src/utils/') || args.importer.includes('/src/components/store/'))
          ? {path:'staff-tasks-auth',namespace:'isolated'} : undefined);
      b.onLoad({filter:/.*/,namespace:'isolated'},()=>({
        contents:`export const auth={currentUser:{uid:'${assigneeId}',getIdToken:async()=> 'staff-fake-token'}};`,
        loader:'js',
      }));
    }}],
  });
  const filename=new URL('../.staff-tasks-dom-'+randomUUID()+'.mjs',import.meta.url);
  let root:{render:(element:unknown)=>void;unmount:()=>void}|undefined;
  try {
    await writeFile(filename,bundle.outputFiles[0].text);
    const {createElement,act}=await import('react');
    const {createRoot}=await import('react-dom/client');
    const {StoreStaffCentralWorkspace,StoreStaffTasksInbox}=await import(filename.href);
    root=createRoot(dom.window.document.getElementById('root')!);
    const settle=async()=>{await act(async()=>{await new Promise(resolve=>setTimeout(resolve,40));});};
    const press=async(title:string)=>{
      const button=[...dom.window.document.querySelectorAll<HTMLButtonElement>('button')]
        .find(item=>item.textContent?.includes(title));
      assert.ok(button,'Missing button '+title);
      await act(async()=>button.click());
      await settle();
    };
    const change=async(selector:string,value:string)=>{
      const input=dom.window.document.querySelector<HTMLInputElement|HTMLTextAreaElement>(selector);
      assert.ok(input,'Missing input '+selector);
      const prototype=selector.startsWith('textarea')
        ?dom.window.HTMLTextAreaElement.prototype:dom.window.HTMLInputElement.prototype;
      const descriptor=Object.getOwnPropertyDescriptor(prototype,'value');
      await act(async()=>{
        descriptor!.set!.call(input,value);
        input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
        input.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
      });
    };
    await act(async()=>root!.render(createElement(StoreStaffCentralWorkspace,{storeId})));
    assert.equal(dom.window.document.querySelectorAll('[data-kyrub-staff-central-card]').length,4);
    await press('Gerenciar tarefas');
    assert.ok(dom.window.document.querySelector('[data-kyrub-staff-tasks-manager]'));
    await change('input#staff-task-title','Checklist de abertura');
    await change('textarea#staff-task-steps','Verificar máquinas\nConferir o caixa');
    const select=dom.window.document.querySelector<HTMLSelectElement>('#staff-task-assignee');
    assert.ok(select);
    await act(async()=>{
      select!.value=assigneeId;
      select!.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
    });
    await press('Atribuir tarefa');
    assert.equal(records.length,1);
    assert.equal(records[0].steps.length,2);
    await act(async()=>root!.render(createElement(StoreStaffTasksInbox,{storeId})));
    await settle();
    assert.ok(dom.window.document.querySelector('[data-kyrub-staff-tasks-inbox]'));
    const checkbox=dom.window.document.querySelector<HTMLInputElement>('input[type="checkbox"]');
    assert.ok(checkbox);
    await act(async()=>checkbox.click());
    await settle();
    assert.equal(records[0].version,2);
    assert.equal(records[0].steps[0].completedBy,assigneeId);
    assert.equal(calls.filter(item=>item.url==='/api/staff/tasks/step').length,1);
  } finally {
    if(root){const {act}=await import('react');await act(async()=>root!.unmount());}
    await unlink(filename).catch(()=>{});
    globalThis.fetch=priorFetch;
    for(const [key,descriptor] of original) {
      if(descriptor)Object.defineProperty(globalThis,key,descriptor);
      else delete (globalThis as any)[key];
    }
    dom.window.close();
  }
});
