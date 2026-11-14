import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const desktop=path.resolve(import.meta.dirname,'..');
const overlay={Replace:{[path.join(desktop,'qa_parity_overlay_test.go')]:path.join(import.meta.dirname,'parity-acceptance.gotest')}};
const proveInf=process.argv.includes('--prove-inf-regression');
if(proveInf){
 const sourceFile=path.join(desktop,'markdown_parity.go');const source=fs.readFileSync(sourceFile,'utf8');
 if(!source.includes('.Basis(190)'))throw Error('Expected finite table baseline changed; update the regression fixture explicitly.');
 const faulty=path.join(import.meta.dirname,'markdown-parity-inf-regression.gosource');
 fs.writeFileSync(faulty,source.replace('.Basis(190)','.Basis(ui.Auto)'));
 overlay.Replace[sourceFile]=faulty;
}
const filename=path.join(import.meta.dirname,proveInf?'parity-inf-overlay.json':'parity-overlay.json');
fs.writeFileSync(filename,JSON.stringify(overlay,null,2)+'\n');
const result=spawnSync('go',['test','-overlay='+filename,'.','-run',proveInf?'^TestQATableAndLongTextHaveFiniteOffscreenLayoutAndDrawGeometry$':'^TestQA','-count=1','-timeout=30s','-v'],{cwd:desktop,env:{...process.env,CGO_ENABLED:'0'},encoding:'utf8'});
console.log(result.stdout);if(result.stderr)console.error(result.stderr);
if(proveInf){const detected=result.status!==0&&(result.stdout+result.stderr).includes('nonfinite geometry');console.log(JSON.stringify({deliberatelyFaultyOverlay:true,regressionDetected:detected,originalImplementationUnchanged:true}));process.exitCode=detected?0:1;}
else process.exitCode=result.status??1;
