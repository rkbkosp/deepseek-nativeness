import{build}from'../../remote/node_modules/esbuild/lib/main.js';
const outfile=process.argv[2];if(!outfile)throw Error('output path required');
await build({entryPoints:['qa/composer-wire-fixture.mjs'],outfile,bundle:true,platform:'node',format:'esm',target:'node24',external:['@roamhq/wrtc','werift'],banner:{js:'import { createRequire as __fixtureCreateRequire } from "node:module"; const require = __fixtureCreateRequire(import.meta.url);'},logLevel:'warning'});
