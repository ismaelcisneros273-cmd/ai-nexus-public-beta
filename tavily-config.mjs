import {readTavilyConfig,savePrivateJson,TAVILY_CONFIG_FILE,TavilySearch} from './tavily.mjs';

async function hiddenKey(){
 if(!process.stdin.isTTY)throw Error('请在 Mac 终端交互输入，不要把 API Key 写进命令参数、聊天或网页。');
 const input=process.stdin,wasRaw=input.isRaw;let answer='';
 process.stdout.write('请输入 Tavily API Key（输入不会显示）：');input.setRawMode(true);input.resume();
 try{
  await new Promise((resolve,reject)=>{
   const onData=chunk=>{for(const char of chunk.toString('utf8')){
    if(char==='\r'||char==='\n'){input.off('data',onData);process.stdout.write('\n');resolve();return;}
    if(char==='\u0003'){input.off('data',onData);reject(Error('已取消'));return;}
    if(char==='\u007f')answer=answer.slice(0,-1);else if(char>=' '&&answer.length<256)answer+=char;
   }};input.on('data',onData);
  });
 }finally{input.setRawMode(wasRaw);input.pause();}
 if(!answer.trim())throw Error('API Key 不能为空。');return answer.trim();
}

try{
 const command=process.argv[2];
 if(command==='setup'){
  if(await readTavilyConfig())throw Error('Tavily 配置已存在，未覆盖原密钥。');
  const apiKey=await hiddenKey();
  await savePrivateJson(TAVILY_CONFIG_FILE,{apiKey,dailyLimit:10},{overwrite:false});
  console.log('Tavily API Key 已保存在私有配置中；每日本地上限为 10 次。未发送测试请求。');
 }else if(command==='replace'){
  const current=await readTavilyConfig();
  if(!current)throw Error('尚无配置，请先运行 setup。');
  const apiKey=await hiddenKey();
  await savePrivateJson(TAVILY_CONFIG_FILE,{apiKey,dailyLimit:current.dailyLimit});
  console.log('Tavily API Key 已替换；未发送测试请求。');
 }else if(command==='limit'){
  const value=Number(process.argv[3]),config=await readTavilyConfig();
  if(!config)throw Error('请先运行 setup。');
  if(!Number.isSafeInteger(value)||value<1||value>1000||process.argv.length!==4)throw Error('上限需为 1–1000 次/日。');
  await savePrivateJson(TAVILY_CONFIG_FILE,{...config,dailyLimit:value});
  console.log('Tavily 本地每日搜索上限已更新为 '+value+' 次。');
 }else if(command==='status'){
  const state=await new TavilySearch().status();
  console.log(state.configured?'Tavily 已配置；本地今日已发起 '+state.used+' / '+state.dailyLimit+' 次。':'Tavily 尚未配置。');
 }else throw Error('用法：node tavily-config.mjs {setup|replace|limit 次数|status}');
}catch(error){console.error(error.message);process.exitCode=1;}
