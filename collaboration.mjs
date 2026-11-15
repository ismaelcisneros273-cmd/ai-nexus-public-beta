// A proposal is a suggestion in a model reply, never authority to call another agent.
export const collaborationInstruction='用户已明确开启本轮协作建议模式。你可以像平常一样回答；仅当另一位成员的意见确实有帮助时，在回复末尾单独附上一行：<nexus-collaboration>{"targetAgent":"Codex","reason":"为什么邀请","task":"请对方具体做什么"}</nexus-collaboration>。只建议一次，不能调用其他成员、文件或命令。目标只能是当前群聊中的其他 AI，用户必须另行批准才会执行。';

export function parseCollaboration(reply,sourceAgent,available){
 const match=reply.match(/<nexus-collaboration>([^\n]{1,1800})<\/nexus-collaboration>\s*$/);
 if(!match)return {text:reply,proposal:null};
 const text=reply.slice(0,match.index).trim()||'我建议邀请另一位成员继续看这个问题。';
 try{
  const item=JSON.parse(match[1]);
  if(!item||Object.keys(item).sort().join()!=='reason,targetAgent,task'||
    typeof item.targetAgent!=='string'||item.targetAgent===sourceAgent||!available.includes(item.targetAgent)||
    typeof item.reason!=='string'||!item.reason.trim()||item.reason.length>500||
    typeof item.task!=='string'||!item.task.trim()||item.task.length>1000)return {text,proposal:null};
  return {text,proposal:{targetAgent:item.targetAgent,reason:item.reason.trim(),task:item.task.trim(),status:'pending',updatedAt:new Date().toISOString()}};
 }catch{return {text,proposal:null};}
}
