// Mutable, body-free augmented treap. One record per step; O(log steps) update
// and numeric-prefix aggregation avoids rescanning a growing active Turn.
const minimum = (node) => node?.minimum ?? Infinity;
const count = (node) => node?.total ?? 0;
function refresh(node) {
  node.minimum = Math.min(
    node.evidence,
    minimum(node.left),
    minimum(node.right),
  );
  node.total = node.count + count(node.left) + count(node.right);
  return node;
}
function priority(key) {
  let value = (key ^ Math.floor(key / 4294967296)) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return (value ^ (value >>> 16)) >>> 0;
}
const before = (a, b) =>
  a.priority < b.priority || (a.priority === b.priority && a.key < b.key);
export class StepSummaryIndex {
  constructor(visit = () => {}) {
    this.visit = visit;
  }
  set(key, evidence, messages) {
    const insert = (node) => {
      if (!node)
        return {
          key,
          evidence,
          count: messages,
          minimum: evidence,
          total: messages,
          priority: priority(key),
        };
      this.visit();
      if (key === node.key) {
        node.evidence = evidence;
        node.count = messages;
      } else if (key < node.key) {
        node.left = insert(node.left);
        if (before(node.left, node)) {
          const top = node.left;
          node.left = top.right;
          top.right = refresh(node);
          node = top;
        }
      } else {
        node.right = insert(node.right);
        if (before(node.right, node)) {
          const top = node.right;
          node.right = top.left;
          top.left = refresh(node);
          node = top;
        }
      }
      return refresh(node);
    };
    this.root = insert(this.root);
  }
  get minimum() {
    return minimum(this.root);
  }
  get total() {
    return count(this.root);
  }
  before(key) {
    let node = this.root,
      evidence = Infinity,
      messages = 0;
    while (node) {
      this.visit();
      if (node.key >= key) node = node.left;
      else {
        evidence = Math.min(evidence, node.evidence, minimum(node.left));
        messages += node.count + count(node.left);
        node = node.right;
      }
    }
    return { evidence, messages };
  }
}
