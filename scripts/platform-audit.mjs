import {open,readdir,writeFile,readFile} from 'node:fs/promises';
import {resolve,join,relative} from 'node:path';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),app=resolve(process.argv[2]),out=resolve(process.argv[3]);
let files=0,bundleBytes=0;const machO=[];
const magic=new Set(['cffaedfe','feedfacf','cefaedfe','feedface','cafebabe','bebafeca','cafebabf','bfbafeca']);
async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const path=join(dir,entry.name);if(entry.isDirectory()){await walk(path);continue}if(!entry.isFile())continue;const h=await open(path);let head;try{const b=Buffer.alloc(4),r=await h.read(b,0,4,0);head=b.subarray(0,r.bytesRead).toString('hex');const s=await h.stat();files++;bundleBytes+=s.size;}finally{await h.close()}if(!magic.has(head))continue;
const architecture=execFileSync('file',['-b',path],{encoding:'utf8'}).trim();assert.match(architecture,/arm64/);assert.doesNotMatch(architecture,/x86_64/);
const build=execFileSync('xcrun',['vtool','-show-build',path],{encoding:'utf8'}),minimumMacOS=build.match(/minos\s+([\d.]+)/)?.[1];assert.ok(minimumMacOS,'missing Mach-O minimum OS');const [major,minor]=minimumMacOS.split('.').map(Number);assert.ok(major<15||(major===15&&minor<=8),'binary requires newer than macOS15.8');
const dependencies=execFileSync('otool',['-L',path],{encoding:'utf8'}).split('\n').slice(1).map(v=>v.trim()).filter(Boolean);machO.push({file:relative(app,path),architecture,minimumMacOS,dependencies});}}
await walk(app);assert.equal(machO.length,3,'unexpected bundled native component (NSText proof must not enter GUI8)');
const minimumSystemVersion=execFileSync('plutil',['-extract','LSMinimumSystemVersion','raw','-o','-',join(app,'Contents/Info.plist')],{encoding:'utf8'}).trim();assert.equal(minimumSystemVersion,'15.8');
const report={sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),target:'macOS15.8+ arm64',minimumSystemVersion,files,bundleBytes,machO,goBuild:execFileSync('go',['version','-m',join(app,'Contents/MacOS/native-dsh')],{encoding:'utf8'}).trim(),apiAudit:{scope:'Static SDK boundary previously checked for GUI7; no additional native APIs introduced in table/header/menu-positioning slice.',ImageIO:'thumbnail options/source declarations 10.4+',CoreGraphics:'CGBitmapContextCreate/CGContextDrawImage declarations 10.0+',AppFocus:'existing MyGo Activate uses activateIgnoringOtherApps selector, 10.0+'},actualAcceptance:'No app launched by this audit. macOS15.8 and M1 actual acceptance remain pending. Bundle bytes describe disk, not runtime memory.'};
await writeFile(out,JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(out);
