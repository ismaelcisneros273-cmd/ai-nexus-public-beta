import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../dist/app.js',import.meta.url),'utf8');
const preferences=source.slice(0,source.indexOf('const memoryFields='));
const recipients=source.slice(source.indexOf('function recipients(){'),source.indexOf('function selectedRecipients(){'));
function cookieJar(){
 const values=new Map();
 return {get cookie(){return [...values].map(([key,value])=>key+'='+value).join('; ');},
  set cookie(value){const [pair]=value.split(';'),index=pair.indexOf('=');values.set(pair.slice(0,index),pair.slice(index+1));}};
}
function page(storage,connected=true,document=cookieJar()){
 const inputs=[{dataset:{groupAgent:'ChatGPT'},checked:false},{dataset:{groupAgent:'ChatGPT'},checked:false}];
 document.querySelectorAll=()=>inputs;
 let redraws=0;
 const context={
  localStorage:storage,document,location:{protocol:'https:'},
  renderMembers(){redraws++;},updateRoom(){},updateSend(){},toast(){},
  agentStatus:{ChatGPT:{connected},Claude:{connected:true},'Claude Code':{connected:true},Codex:{connected:true},DeepSeek:{connected:true}}
 };
 vm.runInNewContext(preferences+recipients+'\nglobalThis.ui={enabled,setGroupEnabled,syncGroupEnabled,recipients};',context);
 context.ui.inputs=inputs;context.ui.redraws=()=>redraws;
 return context.ui;
}

test('ChatGPT opt-in survives reload and reopening, status refresh, and explicit opt-out',()=>{
 const data=new Map(),storage={getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value)};
 const cookies=cookieJar();
 let ui=page(storage,true,cookies);
 assert.equal(ui.enabled.ChatGPT,false); // No stored preference: preserve the former opt-in default.
 ui.setGroupEnabled('ChatGPT',true);
 assert.equal(ui.enabled.ChatGPT,true);
 assert.ok(ui.inputs.every(input=>input.checked));
 assert.equal(ui.redraws(),0); // A click must not destroy its own checkbox.
 assert.equal(JSON.parse(data.get('ai-nexus-group-enabled-v1')).values.ChatGPT,true);
 assert.ok(ui.recipients().includes('ChatGPT'));
 ui=page(storage,true,cookies); // Refresh or close and reopen the same browser profile.
 assert.equal(ui.enabled.ChatGPT,true);
 ui.syncGroupEnabled(); // Asynchronous connection check must not reset the choice.
 assert.equal(ui.enabled.ChatGPT,true);
 assert.ok(ui.recipients().includes('ChatGPT'));
 assert.ok(!page(storage,false,cookies).recipients().includes('ChatGPT')); // Backend says disconnected.
 ui.setGroupEnabled('ChatGPT',false);
 assert.equal(page(storage,true,cookies).enabled.ChatGPT,false);
 assert.ok(!page(storage,true,cookies).recipients().includes('ChatGPT'));
 assert.equal(JSON.parse(data.get('ai-nexus-group-enabled-v1')).values.ChatGPT,false);
});

test('new DeepSeek member stays off in old preferences until explicitly enabled',()=>{
 const data=new Map([['ai-nexus-group-enabled-v1',JSON.stringify({values:{ChatGPT:false,'Claude Code':true,Codex:true}})]]);
 const storage={getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value)};
 let ui=page(storage);
 assert.equal(ui.enabled.DeepSeek,false);
 assert.ok(!ui.recipients().includes('DeepSeek'));
 ui.setGroupEnabled('DeepSeek',true);
 ui=page(storage);
 assert.equal(ui.enabled.DeepSeek,true);
 assert.ok(ui.recipients().includes('DeepSeek'));
 ui.setGroupEnabled('DeepSeek',false);
 assert.equal(page(storage).enabled.DeepSeek,false);
});

test('old Claude selection migrates to Claude, leaves Claude Code off, and respects explicit opt-out',()=>{
 const data=new Map([['ai-nexus-group-enabled-v1',JSON.stringify({values:{'Claude Code':true,Codex:true}})]]);
 const storage={getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value)};
 let ui=page(storage);
 assert.equal(ui.enabled.Claude,true);
 assert.equal(ui.enabled['Claude Code'],false);
 assert.equal(JSON.parse(data.get('ai-nexus-group-enabled-v1')).values.Claude,true);
 ui.setGroupEnabled('Claude',false);
 ui=page(storage);
 assert.equal(ui.enabled.Claude,false);
 assert.equal(ui.enabled['Claude Code'],false);
 ui.setGroupEnabled('Claude Code',true);
 assert.ok(page(storage).recipients().includes('Claude Code'));
 assert.ok(!page(storage).recipients().includes('Claude'));
});

test('paused DeepSeek stays out of group recipients even with a saved opt-in',()=>{
 const saved=JSON.stringify({values:{DeepSeek:true,ChatGPT:true,'Claude Code':true,Codex:true}});
 const storage={getItem:()=>saved,setItem(){}};
 const ui=page(storage);
 assert.equal(ui.enabled.DeepSeek,true);
 assert.ok(ui.recipients().includes('DeepSeek'));
 // A paused server always reports connected:false, so the saved preference cannot route requests.
 const offline=page(storage);
 // The page helper normally injects a connected test stub; test its actual recipient predicate separately.
 const expression=recipients+'\nglobalThis.available=recipients;';
 const context={realAgents:['DeepSeek','ChatGPT'],enabled:{DeepSeek:true,ChatGPT:true},agentStatus:{DeepSeek:{connected:false,paused:true},ChatGPT:{connected:true}}};
 vm.runInNewContext(expression,context);
 assert.deepEqual([...context.available()],['ChatGPT']);
 assert.equal(offline.enabled.DeepSeek,true);
});

test('invalid old settings are ignored and failed storage does not pretend a change was saved',()=>{
 const data=new Map([['ai-nexus-group-enabled-v1',JSON.stringify({ChatGPT:false,'Claude Code':false,unknown:true})]]);
 const storage={getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value)};
 const ui=page(storage);
 assert.equal(ui.enabled.ChatGPT,false);
 assert.equal(ui.enabled['Claude Code'],false);
 assert.equal(ui.enabled.Codex,true);
 const unavailable=page({getItem:()=>null,setItem:()=>{throw Error('storage unavailable');}},true,
  {get cookie(){return '';},set cookie(_value){throw Error('cookies unavailable');}});
 unavailable.setGroupEnabled('ChatGPT',true);
 assert.equal(unavailable.enabled.ChatGPT,false);
});

test('each browser keeps its own opt-in and cookie can save when localStorage is unavailable',()=>{
 const failedStorage={getItem:()=>null,setItem:()=>{throw Error('storage unavailable');}};
 const phoneCookie=cookieJar(),macCookie=cookieJar();
 const phone=page(failedStorage,true,phoneCookie);
 phone.setGroupEnabled('ChatGPT',true);
 assert.equal(page(failedStorage,true,phoneCookie).enabled.ChatGPT,true);
 assert.equal(page(failedStorage,true,macCookie).enabled.ChatGPT,false);
});

test('localStorage wins an old cookie conflict; cookie migrates only when no usable local choice exists',()=>{
 const local=new Map([['ai-nexus-group-enabled-v1',JSON.stringify({values:{ChatGPT:false,'Claude Code':true,Codex:true}})]]);
 const storage={getItem:key=>local.get(key)||null,setItem:(key,value)=>local.set(key,value)};
 const cookie=cookieJar();
 cookie.cookie='ai_nexus_group_enabled='+encodeURIComponent(JSON.stringify({values:{ChatGPT:true}}))+'; Path=/';
 assert.equal(page(storage,true,cookie).enabled.ChatGPT,false);
 local.clear();
 const migrated=page(storage,true,cookie);
 assert.equal(migrated.enabled.ChatGPT,true);
 assert.equal(JSON.parse(local.get('ai-nexus-group-enabled-v1')).values.ChatGPT,true);
 migrated.setGroupEnabled('ChatGPT',false);
 assert.equal(JSON.parse(local.get('ai-nexus-group-enabled-v1')).values.ChatGPT,false);
 assert.equal(page(storage,true,cookie).enabled.ChatGPT,false);
});

test('a failed write cannot display enabled when an older local opt-out remains authoritative',()=>{
 const saved=JSON.stringify({values:{ChatGPT:false,'Claude Code':true,Codex:true}});
 const storage={getItem:()=>saved,setItem:()=>{throw Error('write blocked');}};
 const ui=page(storage,true,cookieJar());
 ui.setGroupEnabled('ChatGPT',true);
 assert.equal(ui.enabled.ChatGPT,false);
 assert.ok(ui.inputs.every(input=>!input.checked));
 assert.ok(!ui.recipients().includes('ChatGPT'));
});

test('authorization status refresh preserves ChatGPT choice without replacing member controls',async()=>{
 const storage=new Map(),elements=new Map();let redraws=0,connected=true;
 const document=cookieJar();
 document.getElementById=id=>{if(!elements.has(id))elements.set(id,{});return elements.get(id);};
 document.querySelector=()=>({textContent:''});
 document.querySelectorAll=()=>[];
 const statusCode=source.slice(source.indexOf('async function status(){'),source.indexOf('async function request('));
 const context={document,location:{protocol:'https:'},
  localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},
  fetch:async()=>({ok:true,json:async()=>({agents:{ChatGPT:{connected},'Claude Code':{connected:true},Codex:{connected:true}}})}),
  renderMembers:()=>redraws++,updateRoom(){},updateSend(){},
  agentStatus:{},toast(){}};
 vm.runInNewContext(preferences+statusCode+'\nglobalThis.ui={enabled,setGroupEnabled,status};',context);
 await context.ui.status();
 assert.equal(redraws,1); // First connection result creates the enabled controls.
 context.ui.setGroupEnabled('ChatGPT',true);
 await context.ui.status();
 assert.equal(context.ui.enabled.ChatGPT,true);
 assert.equal(redraws,1); // Polling the same authorization state keeps the clicked DOM node.
 connected=false;await context.ui.status();
 assert.equal(redraws,2); // A real connection change still updates disabled controls.
 assert.equal(context.ui.enabled.ChatGPT,true); // The saved opt-in is retained while offline.
});

test('mobile visual viewport follows keyboard height and clears the offset after dismissal',()=>{
 const code=source.slice(source.indexOf('let expandedViewportHeight='),source.indexOf('function resizeComposer(){'));
 const styles=new Map(),style={setProperty:(name,value)=>styles.set(name,value),removeProperty:name=>styles.delete(name)};
 const message={},viewport={height:700,offsetTop:0,scale:1};let activeElement=null,resetCount=0;
 const context={window:{visualViewport:viewport,innerHeight:700,matchMedia:()=>({matches:true}),scrollTo:()=>resetCount++},
  document:{documentElement:{style},get activeElement(){return activeElement;}},$:()=>message};
 vm.runInNewContext(code+'\nglobalThis.ui={syncMobileViewport,restoreMobileViewport};',context);
 context.ui.syncMobileViewport();
 assert.equal(styles.size,0);
 activeElement=message;viewport.height=350;viewport.offsetTop=40;
 context.ui.syncMobileViewport();
 assert.equal(styles.get('--nexus-visible-height'),'350px');
 assert.equal(styles.get('--nexus-visible-top'),'40px');
 viewport.height=700;viewport.offsetTop=0; // Keyboard hidden, even if Safari keeps focus.
 context.ui.syncMobileViewport();
 assert.equal(styles.size,0);
 activeElement=null;context.ui.restoreMobileViewport(); // Focus ended or session changed.
 assert.equal(styles.size,0);
 assert.equal(resetCount,1);
});
