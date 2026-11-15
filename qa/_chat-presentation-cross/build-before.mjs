import {build} from '../../compat/node_modules/esbuild/lib/main.js';
import path from 'node:path';
await build({entryPoints:['qa/checkpoints/_chat-presentation-helper-next/source/remote/projection.mjs'],outfile:'qa/_chat-presentation-cross/build/before-projection.mjs',bundle:true,format:'esm',platform:'node',target:'node24',plugins:[{name:'existing-pinned-upstream-only',setup(b){b.onResolve({filter:/\/dist\/upstream\.mjs$/},()=>({path:path.resolve('remote/dist/upstream.mjs')}))}}]});
