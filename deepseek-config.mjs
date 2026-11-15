import { chmod, lstat, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { DEEPSEEK_CONFIG_FILE } from './deepseek.mjs';

async function config(){
 const folder=dirname(DEEPSEEK_CONFIG_FILE),dir=await lstat(folder),file=await lstat(DEEPSEEK_CONFIG_FILE);
 if(!dir.isDirectory()||dir.uid!==process.getuid()||(dir.mode&0o077)||
    !file.isFile()||file.uid!==process.getuid()||(file.mode&0o077))throw Error('私有配置权限不安全，未读取。');
 const value=JSON.parse(await readFile(DEEPSEEK_CONFIG_FILE,'utf8'));
 if(typeof value.apiKey!=='string'||!value.apiKey.trim()||typeof value.enabled!=='boolean')throw Error('DeepSeek 配置格式无效。');
 return value;
}
async function save(value){
 const folder=dirname(DEEPSEEK_CONFIG_FILE),temp=DEEPSEEK_CONFIG_FILE+'.'+randomUUID()+'.tmp';
 await mkdir(folder,{recursive:true,mode:0o700});await chmod(folder,0o700);
 let file;
 try{
  file=await open(temp,'wx',0o600);
  await file.writeFile(JSON.stringify(value)+'\n','utf8');
  await file.sync();await file.close();file=null;
  await rename(temp,DEEPSEEK_CONFIG_FILE);
 }finally{if(file)await file.close();await unlink(temp).catch(()=>{});}
}
async function hiddenKey(){
 if(!process.stdin.isTTY)throw Error('请在 Mac 终端中运行，不要在命令参数或聊天中输入 API Key。');
 process.stdout.write('请输入 DeepSeek API Key（输入不显示）：');
 const input=process.stdin,wasRaw=input.isRaw;let answer='';
 input.setRawMode(true);input.resume();
 try{
  await new Promise((resolve,reject)=>{
   const onData=chunk=>{
    for(const char of chunk.toString('utf8')){
     if(char==='\r'||char==='\n'){input.off('data',onData);process.stdout.write('\n');resolve();return;}
     if(char==='\u0003'){input.off('data',onData);reject(Error('已取消'));return;}
     if(char==='\u007f')answer=answer.slice(0,-1);
     else if(char>=' '&&answer.length<256)answer+=char;
    }
   };input.on('data',onData);
  });
 }finally{input.setRawMode(wasRaw);input.pause();}
 if(!answer.trim())throw Error('API Key 不能为空。');
 return answer.trim();
}

try{
 const command=process.argv[2];
 if(command==='setup'){
  try{await lstat(DEEPSEEK_CONFIG_FILE);throw Error('配置已存在，未覆盖原 API Key。');}
  catch(error){if(error.code!=='ENOENT')throw error;}
  const apiKey=await hiddenKey();
  await save({enabled:false,apiKey});
  console.log('DeepSeek Key 已安全保存，仍保持暂停。');
 }else if(command==='enable'||command==='pause'){
  const value=await config();await save({...value,enabled:command==='enable'});
  console.log(command==='enable'?'DeepSeek 已标记为启用；重启 Nexus 后生效。':'DeepSeek 已标记为暂停；重启 Nexus 后生效。');
 }else if(command==='status'){
  try{console.log((await config()).enabled?'DeepSeek 配置：已启用，需以 Nexus 当前状态为准。':'DeepSeek 配置：已暂停。');}
  catch(error){if(error.code==='ENOENT')console.log('DeepSeek 配置：未设置，保持暂停。');else throw error;}
 }else throw Error('用法：node deepseek-config.mjs {setup|enable|pause|status}');
}catch(error){console.error(error.message);process.exitCode=1;}
