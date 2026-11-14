import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

// Static discovery index, deliberately not a claim that every plugin is enabled.
const root = path.resolve(import.meta.dirname, '../..');
const repo = path.join(root, 'deepseek-harness');
const files = execFileSync('rg', ['--files', 'packages'], {cwd:repo,encoding:'utf8'}).trim().split('\n');
const lineAt = (s,n) => s.slice(0,n).split('\n').length;
const bridge = fs.readFileSync(path.join(root,'desktop/remote_reference/packages/plugin/src/harness-remote-bridge.ts'),'utf8');
const allow = [...bridge.match(/HARNESS_REMOTE_ALLOWLIST = \[([\s\S]*?)\] as const/)[1].matchAll(/'([^']+)'/g)].map(x=>x[1]);
const packageIndex = new Map();
const remoteCalls = [], contributions = [], hostMethods = [], labels = [], shortcuts = [];
for (const file of files) {
  if (!/\.(tsx?|json)$/.test(file) || file.includes('/tests/')) continue;
  const source = fs.readFileSync(path.join(repo,file),'utf8');
  const client = file.includes('/src/client/') || /packages\/client\/[^/]+\/locale\/zh\.json$/.test(file);
  if (client) {
    const pkg = file.split('/').slice(0,3).join('/');
    const entry = packageIndex.get(pkg) ?? {path:pkg,files:[],remoteEndpoints:[],contributions:[]};
    entry.files.push(file); packageIndex.set(pkg,entry);
    for (const m of source.matchAll(/(?:ctx\.)?remote\.([\w$]+)\.([\w$]+)\s*\(/g)) {
      const endpoint=`${m[1]}/${m[2]}`;
      remoteCalls.push({file,line:lineAt(source,m.index),endpoint,allowed:allow.includes(endpoint)});
      if(!entry.remoteEndpoints.includes(endpoint))entry.remoteEndpoints.push(endpoint);
    }
    for(const m of source.matchAll(/(?:name|id|commandId|shortcutId):\s*['"]([^'"\n]+)['"]/g)) {
      if(!/(slot|register|shortcut|command|menu|panel|tab|sidebar|conversation|settings|shell)/i.test(source.slice(Math.max(0,m.index-160),m.index+100)))continue;
      const row={file,line:lineAt(source,m.index),key:m[1]}; contributions.push(row);entry.contributions.push(row.key);
    }
    source.split('\n').forEach((text,i)=>{if(/(?:shortcut|keybinding|defaultKeys|key:|keys:|Mod\+|Meta\+|Cmd\+)/i.test(text))shortcuts.push({file,line:i+1,text:text.trim()});});
    if(file.endsWith('/locale/zh.json')) {
      try { const walk=(o,p='')=>Object.entries(o).forEach(([k,v])=> typeof v==='string'?labels.push({file,key:p+k,label:v}):v&&typeof v==='object'?walk(v,p+k+'.'):null);walk(JSON.parse(source)); }catch{}
    }
  }
  if(!source.includes('@Remote'))continue;
  const namespace = source.match(/namespace:\s*['"]([^'"]+)['"]/)?.[1]
    ?? source.match(/super\(ctx,\s*['"]([^'"]+)['"]/)?.[1];
  for(const m of source.matchAll(/@Remote(?:\([^\n]*\))?\s*(?:\/\*[\s\S]*?\*\/\s*)?(?:async\s+)?(?:\*\s*)?([\w$]+)\s*\(/g)) {
    let depth=1,i=m.index+m[0].length; const start=i;
    // Generic/static index. Signatures are retained verbatim for manual review;
    // lookups may rename wire fields and must be inspected before invocation.
    for(;i<source.length&&depth;i++){if(source[i]==='(')depth++;if(source[i]===')')depth--;}
    const signature=source.slice(start,i-1).replace(/\s+/g,' ');
    const endpoint=namespace?`${namespace}/${m[1]}`:null;
    hostMethods.push({file,line:lineAt(source,m.index),namespace:namespace??null,method:m[1],signature,endpoint,allowed:endpoint?allow.includes(endpoint):null});
  }
}
const output={generatedAt:new Date().toISOString(),frozenHead:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),method:'Static source discovery, with verbatim signatures and source locations. Not runtime enablement or automatic proof of completeness; aliases, dynamic contributions and lookup wire renames require manual domain review.',remoteAllowlist:allow,clientPackages:[...packageIndex.values()].sort((a,b)=>a.path.localeCompare(b.path)),remoteCalls,contributions,shortcuts,labels,hostMethods};
fs.writeFileSync(path.join(import.meta.dirname,'source-inventory.json'),JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({packages:output.clientPackages.length,clientFiles:output.clientPackages.reduce((s,x)=>s+x.files.length,0),remoteCalls:remoteCalls.length,contributions:contributions.length,shortcutReferences:shortcuts.length,labels:labels.length,hostMethods:hostMethods.length,allowlist:allow.length}));
