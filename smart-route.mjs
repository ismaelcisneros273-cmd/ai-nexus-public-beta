const labels={Codex:'Codex',Claude:'Claude','Claude Code':'Claude Code',ChatGPT:'ChatGPT',DeepSeek:'DeepSeek'};
const rules=[
 {label:'Claude Code 项目实现建议',agent:'Claude Code',tests:[/Claude\s*Code|项目执行|落地实现/i],fallback:['Codex','ChatGPT','DeepSeek']},
 {label:'代码开发与调试',agent:'Codex',tests:[/代码|编程|开发|程序|函数|脚本|接口|前端|后端|数据库|算法/i,/调试|报错|错误|修复|测试|bug|debug|python|javascript|typescript|node\.js|git/i],fallback:['Claude Code','ChatGPT','DeepSeek']},
 {label:'文字创作与视觉建议',agent:'Claude',tests:[/写作|文案|文章|润色|改写|故事|标题|语气|翻译/i,/视觉|设计|配色|排版|海报|插画|标志|logo|界面|风格/i],fallback:['ChatGPT','Claude Code','Codex','DeepSeek']},
 {label:'规划、分析与综合讨论',agent:'ChatGPT',tests:[/规划|计划|分析|比较|对比|权衡|评估|策略|方案/i,/总结|梳理|讨论|综合|决策|建议|优先级|利弊/i],fallback:['Claude','DeepSeek','Codex','Claude Code']},
 {label:'数学推理与 DeepSeek',agent:'DeepSeek',tests:[/数学|算式|方程|证明|演算|逻辑推理/i,/DeepSeek|deepseek-flash/i],fallback:['ChatGPT','Codex','Claude','Claude Code']}
];

export function routeSmart(text,candidates){
 // A request explicitly asking for a local/offline model must never route to paid cloud DeepSeek.
 const localOnly=/本地模型|离线模型|Ollama/i.test(text);
 const available=[...new Set(candidates)].filter(agent=>Object.hasOwn(labels,agent)&&!(localOnly&&agent==='DeepSeek'));
 if(!available.length)return {agents:[],reason:localOnly?'本地模型已暂停，未调用云端 DeepSeek。':'没有已启用且已连接的成员。'};
 const matches=rules.map((rule,index)=>({...rule,index,score:rule.tests.filter(test=>test.test(text)).length}))
  .filter(rule=>rule.score>0).sort((a,b)=>b.score-a.score||a.index-b.index);
 if(!matches.length){
  const agent=['ChatGPT','Claude','Codex','Claude Code','DeepSeek'].find(name=>available.includes(name));
  return {agents:[agent],reason:'任务类型不明确，选择一位可用成员。'};
 }
 const domains=matches.slice(0,2),desired=domains.map(rule=>rule.agent),limit=domains.length;
 const order=[...desired,...domains.flatMap(rule=>rule.fallback),...available];
 const selected=[];
 for(const agent of new Set(order)){
  if(!available.includes(agent))continue;
  if(['Claude','Claude Code'].includes(agent)&&selected.some(name=>['Claude','Claude Code'].includes(name)))continue;
  selected.push(agent);if(selected.length===limit)break;
 }
 const fallback=selected.some(agent=>!desired.includes(agent))||desired.some(agent=>!available.includes(agent));
 return {agents:selected,reason:'识别为'+domains.map(rule=>rule.label).join('、')+(fallback?'；首选成员不可用，已改选可用成员。':'。')};
}
