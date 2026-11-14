import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

test("the composer model popup has a bounded original component closure",async()=>{
  const report=JSON.parse(await readFile(new URL('../dist-next/route-budgets.json',import.meta.url)));
  const models=report.routes.find(route=>route.entry==='routes/models.js');
  assert.ok(models);
  assert.ok(models.initialJavaScriptBytes<400_000,JSON.stringify({bytes:models.initialJavaScriptBytes}));
  const inputs=models.inputs.join('\n');
  for(const unrelated of ['@xterm/','ui-trajectory/','ui-plugin-manager/','node_modules/katex/','node_modules/@shikijs/'])assert.equal(inputs.includes(unrelated),false,unrelated);
  assert.ok(inputs.includes('ui-model-selection/src/client/ModelSelect.tsx'));
  const styles=models.cssInputs.join('\n');
  assert.ok(styles.includes('ui-theme/src/styles/gradient-shadow-text.css'));
  assert.ok(styles.includes('ui-theme/src/styles/design-platform.css'));
  assert.ok(models.cssBytes>0);
});
