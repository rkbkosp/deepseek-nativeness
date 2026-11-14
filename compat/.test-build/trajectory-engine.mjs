// deepseek-harness/packages/client/ui-conversation/src/client/contract/conversation.ts
function conversationContextKey(kind, id) {
  return `${kind.length}:${kind}${id}`;
}

// desktop/compat/node_modules/zustand/esm/vanilla.mjs
var createStoreImpl = (createState) => {
  let state;
  const listeners = /* @__PURE__ */ new Set();
  const setState = (partial, replace) => {
    const nextState = typeof partial === "function" ? partial(state) : partial;
    if (!Object.is(nextState, state)) {
      const previousState = state;
      state = (replace != null ? replace : typeof nextState !== "object" || nextState === null) ? nextState : Object.assign({}, state, nextState);
      listeners.forEach((listener) => listener(state, previousState));
    }
  };
  const getState = () => state;
  const getInitialState = () => initialState2;
  const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const destroy = () => {
    if ((import.meta.env ? import.meta.env.MODE : void 0) !== "production") {
      console.warn(
        "[DEPRECATED] The `destroy` method will be unsupported in a future version. Instead use unsubscribe function returned by subscribe. Everything will be garbage-collected if store is garbage-collected."
      );
    }
    listeners.clear();
  };
  const api = { setState, getState, getInitialState, subscribe, destroy };
  const initialState2 = state = createState(setState, getState, api);
  return api;
};
var createStore = (createState) => createState ? createStoreImpl(createState) : createStoreImpl;

// desktop/compat/node_modules/zustand/esm/middleware.mjs
var subscribeWithSelectorImpl = (fn) => (set2, get, api) => {
  const origSubscribe = api.subscribe;
  api.subscribe = (selector, optListener, options) => {
    let listener = selector;
    if (optListener) {
      const equalityFn = (options == null ? void 0 : options.equalityFn) || Object.is;
      let currentSlice = selector(api.getState());
      listener = (state) => {
        const nextSlice = selector(state);
        if (!equalityFn(currentSlice, nextSlice)) {
          const previousSlice = currentSlice;
          optListener(currentSlice = nextSlice, previousSlice);
        }
      };
      if (options == null ? void 0 : options.fireImmediately) {
        optListener(currentSlice, currentSlice);
      }
    }
    return origSubscribe(listener);
  };
  const initialState2 = fn(set2, get, api);
  return initialState2;
};
var subscribeWithSelector = subscribeWithSelectorImpl;

// desktop/compat/node_modules/immer/dist/immer.mjs
var NOTHING = Symbol.for("immer-nothing");
var DRAFTABLE = Symbol.for("immer-draftable");
var DRAFT_STATE = Symbol.for("immer-state");
var errors = process.env.NODE_ENV !== "production" ? [
  // All error codes, starting by 0:
  function(plugin) {
    return `The plugin for '${plugin}' has not been loaded into Immer. To enable the plugin, import and call \`enable${plugin}()\` when initializing your application.`;
  },
  function(thing) {
    return `produce can only be called on things that are draftable: plain objects, arrays, Map, Set or classes that are marked with '[immerable]: true'. Got '${thing}'`;
  },
  "This object has been frozen and should not be mutated",
  function(data) {
    return "Cannot use a proxy that has been revoked. Did you pass an object from inside an immer function to an async process? " + data;
  },
  "An immer producer returned a new value *and* modified its draft. Either return a new value *or* modify the draft.",
  "Immer forbids circular references",
  "The first or second argument to `produce` must be a function",
  "The third argument to `produce` must be a function or undefined",
  "First argument to `createDraft` must be a plain object, an array, or an immerable object",
  "First argument to `finishDraft` must be a draft returned by `createDraft`",
  function(thing) {
    return `'current' expects a draft, got: ${thing}`;
  },
  "Object.defineProperty() cannot be used on an Immer draft",
  "Object.setPrototypeOf() cannot be used on an Immer draft",
  "Immer only supports deleting array indices",
  "Immer only supports setting array indices and the 'length' property",
  function(thing) {
    return `'original' expects a draft, got: ${thing}`;
  }
  // Note: if more errors are added, the errorOffset in Patches.ts should be increased
  // See Patches.ts for additional errors
] : [];
function die(error, ...args) {
  if (process.env.NODE_ENV !== "production") {
    const e = errors[error];
    const msg = typeof e === "function" ? e.apply(null, args) : e;
    throw new Error(`[Immer] ${msg}`);
  }
  throw new Error(
    `[Immer] minified error nr: ${error}. Full error at: https://bit.ly/3cXEKWf`
  );
}
var getPrototypeOf = Object.getPrototypeOf;
function isDraft(value) {
  return !!value && !!value[DRAFT_STATE];
}
function isDraftable(value) {
  if (!value)
    return false;
  return isPlainObject(value) || Array.isArray(value) || !!value[DRAFTABLE] || !!value.constructor?.[DRAFTABLE] || isMap(value) || isSet(value);
}
var objectCtorString = Object.prototype.constructor.toString();
function isPlainObject(value) {
  if (!value || typeof value !== "object")
    return false;
  const proto = getPrototypeOf(value);
  if (proto === null) {
    return true;
  }
  const Ctor = Object.hasOwnProperty.call(proto, "constructor") && proto.constructor;
  if (Ctor === Object)
    return true;
  return typeof Ctor == "function" && Function.toString.call(Ctor) === objectCtorString;
}
function each(obj, iter) {
  if (getArchtype(obj) === 0) {
    Reflect.ownKeys(obj).forEach((key) => {
      iter(key, obj[key], obj);
    });
  } else {
    obj.forEach((entry, index) => iter(index, entry, obj));
  }
}
function getArchtype(thing) {
  const state = thing[DRAFT_STATE];
  return state ? state.type_ : Array.isArray(thing) ? 1 : isMap(thing) ? 2 : isSet(thing) ? 3 : 0;
}
function has(thing, prop) {
  return getArchtype(thing) === 2 ? thing.has(prop) : Object.prototype.hasOwnProperty.call(thing, prop);
}
function set(thing, propOrOldValue, value) {
  const t = getArchtype(thing);
  if (t === 2)
    thing.set(propOrOldValue, value);
  else if (t === 3) {
    thing.add(value);
  } else
    thing[propOrOldValue] = value;
}
function is(x, y) {
  if (x === y) {
    return x !== 0 || 1 / x === 1 / y;
  } else {
    return x !== x && y !== y;
  }
}
function isMap(target) {
  return target instanceof Map;
}
function isSet(target) {
  return target instanceof Set;
}
function latest(state) {
  return state.copy_ || state.base_;
}
function shallowCopy(base, strict) {
  if (isMap(base)) {
    return new Map(base);
  }
  if (isSet(base)) {
    return new Set(base);
  }
  if (Array.isArray(base))
    return Array.prototype.slice.call(base);
  const isPlain = isPlainObject(base);
  if (strict === true || strict === "class_only" && !isPlain) {
    const descriptors = Object.getOwnPropertyDescriptors(base);
    delete descriptors[DRAFT_STATE];
    let keys = Reflect.ownKeys(descriptors);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const desc = descriptors[key];
      if (desc.writable === false) {
        desc.writable = true;
        desc.configurable = true;
      }
      if (desc.get || desc.set)
        descriptors[key] = {
          configurable: true,
          writable: true,
          // could live with !!desc.set as well here...
          enumerable: desc.enumerable,
          value: base[key]
        };
    }
    return Object.create(getPrototypeOf(base), descriptors);
  } else {
    const proto = getPrototypeOf(base);
    if (proto !== null && isPlain) {
      return { ...base };
    }
    const obj = Object.create(proto);
    return Object.assign(obj, base);
  }
}
function freeze(obj, deep = false) {
  if (isFrozen(obj) || isDraft(obj) || !isDraftable(obj))
    return obj;
  if (getArchtype(obj) > 1) {
    obj.set = obj.add = obj.clear = obj.delete = dontMutateFrozenCollections;
  }
  Object.freeze(obj);
  if (deep)
    Object.entries(obj).forEach(([key, value]) => freeze(value, true));
  return obj;
}
function dontMutateFrozenCollections() {
  die(2);
}
function isFrozen(obj) {
  return Object.isFrozen(obj);
}
var plugins = {};
function getPlugin(pluginKey) {
  const plugin = plugins[pluginKey];
  if (!plugin) {
    die(0, pluginKey);
  }
  return plugin;
}
var currentScope;
function getCurrentScope() {
  return currentScope;
}
function createScope(parent_, immer_) {
  return {
    drafts_: [],
    parent_,
    immer_,
    // Whenever the modified draft contains a draft from another scope, we
    // need to prevent auto-freezing so the unowned draft can be finalized.
    canAutoFreeze_: true,
    unfinalizedDrafts_: 0
  };
}
function usePatchesInScope(scope, patchListener) {
  if (patchListener) {
    getPlugin("Patches");
    scope.patches_ = [];
    scope.inversePatches_ = [];
    scope.patchListener_ = patchListener;
  }
}
function revokeScope(scope) {
  leaveScope(scope);
  scope.drafts_.forEach(revokeDraft);
  scope.drafts_ = null;
}
function leaveScope(scope) {
  if (scope === currentScope) {
    currentScope = scope.parent_;
  }
}
function enterScope(immer2) {
  return currentScope = createScope(currentScope, immer2);
}
function revokeDraft(draft) {
  const state = draft[DRAFT_STATE];
  if (state.type_ === 0 || state.type_ === 1)
    state.revoke_();
  else
    state.revoked_ = true;
}
function processResult(result, scope) {
  scope.unfinalizedDrafts_ = scope.drafts_.length;
  const baseDraft = scope.drafts_[0];
  const isReplaced = result !== void 0 && result !== baseDraft;
  if (isReplaced) {
    if (baseDraft[DRAFT_STATE].modified_) {
      revokeScope(scope);
      die(4);
    }
    if (isDraftable(result)) {
      result = finalize(scope, result);
      if (!scope.parent_)
        maybeFreeze(scope, result);
    }
    if (scope.patches_) {
      getPlugin("Patches").generateReplacementPatches_(
        baseDraft[DRAFT_STATE].base_,
        result,
        scope.patches_,
        scope.inversePatches_
      );
    }
  } else {
    result = finalize(scope, baseDraft, []);
  }
  revokeScope(scope);
  if (scope.patches_) {
    scope.patchListener_(scope.patches_, scope.inversePatches_);
  }
  return result !== NOTHING ? result : void 0;
}
function finalize(rootScope, value, path) {
  if (isFrozen(value))
    return value;
  const state = value[DRAFT_STATE];
  if (!state) {
    each(
      value,
      (key, childValue) => finalizeProperty(rootScope, state, value, key, childValue, path)
    );
    return value;
  }
  if (state.scope_ !== rootScope)
    return value;
  if (!state.modified_) {
    maybeFreeze(rootScope, state.base_, true);
    return state.base_;
  }
  if (!state.finalized_) {
    state.finalized_ = true;
    state.scope_.unfinalizedDrafts_--;
    const result = state.copy_;
    let resultEach = result;
    let isSet2 = false;
    if (state.type_ === 3) {
      resultEach = new Set(result);
      result.clear();
      isSet2 = true;
    }
    each(
      resultEach,
      (key, childValue) => finalizeProperty(rootScope, state, result, key, childValue, path, isSet2)
    );
    maybeFreeze(rootScope, result, false);
    if (path && rootScope.patches_) {
      getPlugin("Patches").generatePatches_(
        state,
        path,
        rootScope.patches_,
        rootScope.inversePatches_
      );
    }
  }
  return state.copy_;
}
function finalizeProperty(rootScope, parentState, targetObject, prop, childValue, rootPath, targetIsSet) {
  if (process.env.NODE_ENV !== "production" && childValue === targetObject)
    die(5);
  if (isDraft(childValue)) {
    const path = rootPath && parentState && parentState.type_ !== 3 && // Set objects are atomic since they have no keys.
    !has(parentState.assigned_, prop) ? rootPath.concat(prop) : void 0;
    const res = finalize(rootScope, childValue, path);
    set(targetObject, prop, res);
    if (isDraft(res)) {
      rootScope.canAutoFreeze_ = false;
    } else
      return;
  } else if (targetIsSet) {
    targetObject.add(childValue);
  }
  if (isDraftable(childValue) && !isFrozen(childValue)) {
    if (!rootScope.immer_.autoFreeze_ && rootScope.unfinalizedDrafts_ < 1) {
      return;
    }
    finalize(rootScope, childValue);
    if ((!parentState || !parentState.scope_.parent_) && typeof prop !== "symbol" && Object.prototype.propertyIsEnumerable.call(targetObject, prop))
      maybeFreeze(rootScope, childValue);
  }
}
function maybeFreeze(scope, value, deep = false) {
  if (!scope.parent_ && scope.immer_.autoFreeze_ && scope.canAutoFreeze_) {
    freeze(value, deep);
  }
}
function createProxyProxy(base, parent) {
  const isArray = Array.isArray(base);
  const state = {
    type_: isArray ? 1 : 0,
    // Track which produce call this is associated with.
    scope_: parent ? parent.scope_ : getCurrentScope(),
    // True for both shallow and deep changes.
    modified_: false,
    // Used during finalization.
    finalized_: false,
    // Track which properties have been assigned (true) or deleted (false).
    assigned_: {},
    // The parent draft state.
    parent_: parent,
    // The base state.
    base_: base,
    // The base proxy.
    draft_: null,
    // set below
    // The base copy with any updated values.
    copy_: null,
    // Called by the `produce` function.
    revoke_: null,
    isManual_: false
  };
  let target = state;
  let traps = objectTraps;
  if (isArray) {
    target = [state];
    traps = arrayTraps;
  }
  const { revoke, proxy } = Proxy.revocable(target, traps);
  state.draft_ = proxy;
  state.revoke_ = revoke;
  return proxy;
}
var objectTraps = {
  get(state, prop) {
    if (prop === DRAFT_STATE)
      return state;
    const source = latest(state);
    if (!has(source, prop)) {
      return readPropFromProto(state, source, prop);
    }
    const value = source[prop];
    if (state.finalized_ || !isDraftable(value)) {
      return value;
    }
    if (value === peek(state.base_, prop)) {
      prepareCopy(state);
      return state.copy_[prop] = createProxy(value, state);
    }
    return value;
  },
  has(state, prop) {
    return prop in latest(state);
  },
  ownKeys(state) {
    return Reflect.ownKeys(latest(state));
  },
  set(state, prop, value) {
    const desc = getDescriptorFromProto(latest(state), prop);
    if (desc?.set) {
      desc.set.call(state.draft_, value);
      return true;
    }
    if (!state.modified_) {
      const current2 = peek(latest(state), prop);
      const currentState = current2?.[DRAFT_STATE];
      if (currentState && currentState.base_ === value) {
        state.copy_[prop] = value;
        state.assigned_[prop] = false;
        return true;
      }
      if (is(value, current2) && (value !== void 0 || has(state.base_, prop)))
        return true;
      prepareCopy(state);
      markChanged(state);
    }
    if (state.copy_[prop] === value && // special case: handle new props with value 'undefined'
    (value !== void 0 || prop in state.copy_) || // special case: NaN
    Number.isNaN(value) && Number.isNaN(state.copy_[prop]))
      return true;
    state.copy_[prop] = value;
    state.assigned_[prop] = true;
    return true;
  },
  deleteProperty(state, prop) {
    if (peek(state.base_, prop) !== void 0 || prop in state.base_) {
      state.assigned_[prop] = false;
      prepareCopy(state);
      markChanged(state);
    } else {
      delete state.assigned_[prop];
    }
    if (state.copy_) {
      delete state.copy_[prop];
    }
    return true;
  },
  // Note: We never coerce `desc.value` into an Immer draft, because we can't make
  // the same guarantee in ES5 mode.
  getOwnPropertyDescriptor(state, prop) {
    const owner = latest(state);
    const desc = Reflect.getOwnPropertyDescriptor(owner, prop);
    if (!desc)
      return desc;
    return {
      writable: true,
      configurable: state.type_ !== 1 || prop !== "length",
      enumerable: desc.enumerable,
      value: owner[prop]
    };
  },
  defineProperty() {
    die(11);
  },
  getPrototypeOf(state) {
    return getPrototypeOf(state.base_);
  },
  setPrototypeOf() {
    die(12);
  }
};
var arrayTraps = {};
each(objectTraps, (key, fn) => {
  arrayTraps[key] = function() {
    arguments[0] = arguments[0][0];
    return fn.apply(this, arguments);
  };
});
arrayTraps.deleteProperty = function(state, prop) {
  if (process.env.NODE_ENV !== "production" && isNaN(parseInt(prop)))
    die(13);
  return arrayTraps.set.call(this, state, prop, void 0);
};
arrayTraps.set = function(state, prop, value) {
  if (process.env.NODE_ENV !== "production" && prop !== "length" && isNaN(parseInt(prop)))
    die(14);
  return objectTraps.set.call(this, state[0], prop, value, state[0]);
};
function peek(draft, prop) {
  const state = draft[DRAFT_STATE];
  const source = state ? latest(state) : draft;
  return source[prop];
}
function readPropFromProto(state, source, prop) {
  const desc = getDescriptorFromProto(source, prop);
  return desc ? `value` in desc ? desc.value : (
    // This is a very special case, if the prop is a getter defined by the
    // prototype, we should invoke it with the draft as context!
    desc.get?.call(state.draft_)
  ) : void 0;
}
function getDescriptorFromProto(source, prop) {
  if (!(prop in source))
    return void 0;
  let proto = getPrototypeOf(source);
  while (proto) {
    const desc = Object.getOwnPropertyDescriptor(proto, prop);
    if (desc)
      return desc;
    proto = getPrototypeOf(proto);
  }
  return void 0;
}
function markChanged(state) {
  if (!state.modified_) {
    state.modified_ = true;
    if (state.parent_) {
      markChanged(state.parent_);
    }
  }
}
function prepareCopy(state) {
  if (!state.copy_) {
    state.copy_ = shallowCopy(
      state.base_,
      state.scope_.immer_.useStrictShallowCopy_
    );
  }
}
var Immer2 = class {
  constructor(config) {
    this.autoFreeze_ = true;
    this.useStrictShallowCopy_ = false;
    this.produce = (base, recipe, patchListener) => {
      if (typeof base === "function" && typeof recipe !== "function") {
        const defaultBase = recipe;
        recipe = base;
        const self = this;
        return function curriedProduce(base2 = defaultBase, ...args) {
          return self.produce(base2, (draft) => recipe.call(this, draft, ...args));
        };
      }
      if (typeof recipe !== "function")
        die(6);
      if (patchListener !== void 0 && typeof patchListener !== "function")
        die(7);
      let result;
      if (isDraftable(base)) {
        const scope = enterScope(this);
        const proxy = createProxy(base, void 0);
        let hasError = true;
        try {
          result = recipe(proxy);
          hasError = false;
        } finally {
          if (hasError)
            revokeScope(scope);
          else
            leaveScope(scope);
        }
        usePatchesInScope(scope, patchListener);
        return processResult(result, scope);
      } else if (!base || typeof base !== "object") {
        result = recipe(base);
        if (result === void 0)
          result = base;
        if (result === NOTHING)
          result = void 0;
        if (this.autoFreeze_)
          freeze(result, true);
        if (patchListener) {
          const p = [];
          const ip = [];
          getPlugin("Patches").generateReplacementPatches_(base, result, p, ip);
          patchListener(p, ip);
        }
        return result;
      } else
        die(1, base);
    };
    this.produceWithPatches = (base, recipe) => {
      if (typeof base === "function") {
        return (state, ...args) => this.produceWithPatches(state, (draft) => base(draft, ...args));
      }
      let patches, inversePatches;
      const result = this.produce(base, recipe, (p, ip) => {
        patches = p;
        inversePatches = ip;
      });
      return [result, patches, inversePatches];
    };
    if (typeof config?.autoFreeze === "boolean")
      this.setAutoFreeze(config.autoFreeze);
    if (typeof config?.useStrictShallowCopy === "boolean")
      this.setUseStrictShallowCopy(config.useStrictShallowCopy);
  }
  createDraft(base) {
    if (!isDraftable(base))
      die(8);
    if (isDraft(base))
      base = current(base);
    const scope = enterScope(this);
    const proxy = createProxy(base, void 0);
    proxy[DRAFT_STATE].isManual_ = true;
    leaveScope(scope);
    return proxy;
  }
  finishDraft(draft, patchListener) {
    const state = draft && draft[DRAFT_STATE];
    if (!state || !state.isManual_)
      die(9);
    const { scope_: scope } = state;
    usePatchesInScope(scope, patchListener);
    return processResult(void 0, scope);
  }
  /**
   * Pass true to automatically freeze all copies created by Immer.
   *
   * By default, auto-freezing is enabled.
   */
  setAutoFreeze(value) {
    this.autoFreeze_ = value;
  }
  /**
   * Pass true to enable strict shallow copy.
   *
   * By default, immer does not copy the object descriptors such as getter, setter and non-enumrable properties.
   */
  setUseStrictShallowCopy(value) {
    this.useStrictShallowCopy_ = value;
  }
  applyPatches(base, patches) {
    let i;
    for (i = patches.length - 1; i >= 0; i--) {
      const patch = patches[i];
      if (patch.path.length === 0 && patch.op === "replace") {
        base = patch.value;
        break;
      }
    }
    if (i > -1) {
      patches = patches.slice(i + 1);
    }
    const applyPatchesImpl = getPlugin("Patches").applyPatches_;
    if (isDraft(base)) {
      return applyPatchesImpl(base, patches);
    }
    return this.produce(
      base,
      (draft) => applyPatchesImpl(draft, patches)
    );
  }
};
function createProxy(value, parent) {
  const draft = isMap(value) ? getPlugin("MapSet").proxyMap_(value, parent) : isSet(value) ? getPlugin("MapSet").proxySet_(value, parent) : createProxyProxy(value, parent);
  const scope = parent ? parent.scope_ : getCurrentScope();
  scope.drafts_.push(draft);
  return draft;
}
function current(value) {
  if (!isDraft(value))
    die(10, value);
  return currentImpl(value);
}
function currentImpl(value) {
  if (!isDraftable(value) || isFrozen(value))
    return value;
  const state = value[DRAFT_STATE];
  let copy;
  if (state) {
    if (!state.modified_)
      return state.base_;
    state.finalized_ = true;
    copy = shallowCopy(value, state.scope_.immer_.useStrictShallowCopy_);
  } else {
    copy = shallowCopy(value, true);
  }
  each(copy, (key, childValue) => {
    set(copy, key, currentImpl(childValue));
  });
  if (state) {
    state.finalized_ = false;
  }
  return copy;
}
var immer = new Immer2();
var produce = immer.produce;
var produceWithPatches = immer.produceWithPatches.bind(
  immer
);
var setAutoFreeze = immer.setAutoFreeze.bind(immer);
var setUseStrictShallowCopy = immer.setUseStrictShallowCopy.bind(immer);
var applyPatches = immer.applyPatches.bind(immer);
var createDraft = immer.createDraft.bind(immer);
var finishDraft = immer.finishDraft.bind(immer);

// deepseek-harness/packages/client/store/src/index.ts
function notifySubscribers(listeners, label, ...args) {
  for (const listener of [...listeners]) {
    try {
      listener(...args);
    } catch (error) {
      console.error(`${label} subscriber failed:`, error);
    }
  }
}
function rafBatch(notify) {
  const schedule = typeof requestAnimationFrame === "function" ? (fn) => {
    requestAnimationFrame(() => {
      fn();
    });
  } : (fn) => {
    queueMicrotask(fn);
  };
  let scheduled = false;
  return () => {
    if (scheduled) return;
    scheduled = true;
    schedule(() => {
      scheduled = false;
      notify();
    });
  };
}
function createSnapshotStore(init, opts) {
  const withSelector = subscribeWithSelector(() => init);
  const api = createStore()(withSelector);
  if (opts?.persist) attachPersistence(api, opts.persist.name);
  let subscribe = (fn) => api.subscribe(() => {
    notifySubscribers([fn], "[client-store]");
  });
  if (opts?.flush === "raf") {
    const listeners = /* @__PURE__ */ new Set();
    const flush = rafBatch(() => {
      notifySubscribers(listeners, "[client-store]");
    });
    api.subscribe(flush);
    subscribe = (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    };
  }
  return {
    getSnapshot: () => api.getState(),
    subscribe: (fn) => subscribe(fn),
    update: (mutator) => {
      api.setState(produce(api.getState(), (draft) => {
        mutator(draft);
      }), true);
    },
    set: (next) => {
      api.setState(devFreeze(next), true);
    }
  };
}
function attachPersistence(api, name) {
  if (typeof localStorage === "undefined") return;
  try {
    const raw = localStorage.getItem(name);
    if (raw !== null) {
      api.setState(devFreeze(JSON.parse(raw)), true);
    }
  } catch (error) {
    console.error(`snapshot store '${name}' rehydration failed:`, error);
  }
  api.subscribe((state) => {
    try {
      localStorage.setItem(name, JSON.stringify(state));
    } catch (error) {
      console.error(`snapshot store '${name}' persistence failed:`, error);
    }
  });
}
function devFreeze(value) {
  if (process.env.NODE_ENV === "production") return value;
  return freeze(value, true);
}

// deepseek-harness/packages/util/values/src/partial-json.ts
var SIMPLE_ESCAPES = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "	"
};
var CONTENT_ESCAPE = /[\\\u0000-\u001f]/u;
function isWhitespace(c) {
  return c === " " || c === "\n" || c === "\r" || c === "	";
}
function isHex(c) {
  return c >= "0" && c <= "9" || c >= "a" && c <= "f" || c >= "A" && c <= "F";
}
var PartialArguments = class _PartialArguments {
  /** The view of a call with no arguments available. */
  static EMPTY = _PartialArguments.fromObject({});
  /**
   * View finished argument text without scanning it until a reader asks.
   * @param text - the complete argument JSON text.
   * @returns a sealed view.
   */
  static fromText(text) {
    const view = new _PartialArguments();
    view.append(text);
    view.sealed = true;
    return view;
  }
  /**
   * View an already parsed argument payload, such as a PTC dispatch object.
   * @param value - the parsed argument value.
   * @returns a sealed view; a non-object payload has no fields.
   */
  static fromObject(value) {
    const view = new _PartialArguments();
    view.object = typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
    view.sealed = true;
    return view;
  }
  /**
   * The source: text so far or a parsed object, plus whether it can still grow.
   * These are the only enumerable fields, so two views over the same source
   * compare equal structurally however far each has been read.
   */
  chunks = [];
  object;
  sealed = false;
  // Scan progress, located fields, and remembered reads are caches over the source.
  #ends = [];
  #size = 0;
  #consumed = 0;
  #mode = "root";
  #escape = false;
  #keyStart = 0;
  #keyEscaped = false;
  #key = "";
  #current = null;
  #nestedEnds = [];
  #nestedInString = false;
  #invalidAt;
  #invalidValue = false;
  #entries = /* @__PURE__ */ new Map();
  #order = [];
  #reads = /* @__PURE__ */ new Map();
  /** Whether this view rejects further appends; does not scan text or register reads. */
  get isSealed() {
    return this.sealed;
  }
  /** Whether indexing or a content read found invalid JSON; unread value contents are not validated. */
  get invalid() {
    this.scan();
    return this.#mode === "invalid" || this.#invalidValue;
  }
  /**
   * Retain streamed argument text without scanning or comparing observed answers.
   * @param fragment - the text following every fragment appended before.
   */
  append(fragment) {
    if (this.sealed) throw new Error("PartialArguments: cannot append to a sealed view");
    if (fragment.length === 0) return;
    this.chunks.push(fragment);
    this.#size += fragment.length;
    this.#ends.push(this.#size);
  }
  /**
   * Reconcile a streamed prefix with authoritative complete text without joining the fragments.
   * @param text - the final argument text, which replaces missing or conflicting deltas.
   * @returns this view sealed with its caches retained when every character matches; otherwise a new sealed view.
   */
  settle(text) {
    if (this.object !== void 0 || text.length !== this.#size) return _PartialArguments.fromText(text);
    let offset = 0;
    for (const chunk of this.chunks) {
      if (!text.startsWith(chunk, offset)) return _PartialArguments.fromText(text);
      offset += chunk.length;
    }
    this.chunks = text.length === 0 ? [] : [text];
    this.#ends = text.length === 0 ? [] : [text.length];
    this.sealed = true;
    return this;
  }
  /**
   * Compare observed answers and advance their publication baseline. Unread views remain unscanned.
   * @returns whether any observed answer changed since its first read or the preceding refresh.
   */
  refresh() {
    if (this.#reads.size === 0) return false;
    this.scan();
    let changed = false;
    let completions = false;
    for (const read of this.#reads.values()) {
      if (read.completion) {
        completions = true;
        continue;
      }
      changed = this.refreshRead(read) || changed;
    }
    if (completions) {
      for (const read of this.#reads.values()) if (read.completion) changed = this.refreshRead(read) || changed;
    }
    if (this.sealed) this.#reads.clear();
    return changed;
  }
  refreshRead(read) {
    const now = read.answer();
    if (Object.is(now, read.last)) return false;
    read.last = now;
    return true;
  }
  /**
   * Check whether no further fields can arrive.
   * @returns whether the outer object closed, indexing failed, or the view is sealed; unread values are not validated.
   */
  closed() {
    return this.remember("closed", "", () => this.closedNow());
  }
  /**
   * List discovered fields in first-appearance order.
   * @returns top-level keys seen so far, in first-appearance order.
   */
  keys() {
    return this.remember("keys", "", () => this.keysNow(), (keys) => keys.length);
  }
  /**
   * Check whether a top-level field has appeared.
   * @param key - argument name.
   * @returns whether the field has appeared (a string opened or another value began).
   */
  has(key) {
    return this.remember("has", key, () => this.hasNow(key));
  }
  /**
   * Check whether a field's closing delimiter has arrived, without validating its contents.
   * @param key - argument name.
   * @returns whether its delimiter arrived and no content reader has reported an error for this value.
   */
  complete(key) {
    return this.remember("complete", key, () => this.completeNow(key));
  }
  /**
   * Read string length without materializing its text.
   * @param key - argument name.
   * @param options - change granularity for a streaming string.
   * @returns decoded UTF-16 length of the string field so far; undefined when absent or not a string.
   */
  stringLength(key, options) {
    const step = Math.max(1, Math.floor(options?.step ?? 1));
    const offset = options?.offset ?? 0;
    return this.remember(
      `length:${step}:${offset}`,
      key,
      () => this.lengthNow(key),
      (length) => length === void 0 ? void 0 : Math.ceil((length + offset) / step)
    );
  }
  /**
   * Check a string against a decoded UTF-16 length limit without materializing it.
   * @param key - argument name.
   * @param maxLength - decoded UTF-16 limit, floored to at least zero.
   * @returns whether the string is longer than the limit; false when absent or not a string.
   */
  stringExceeds(key, maxLength) {
    const limit = Math.max(0, Math.floor(maxLength));
    return this.remember(
      `exceeds:${limit}`,
      key,
      () => (this.lengthNow(key, limit + 1) ?? 0) > limit
    );
  }
  /**
   * Read a decoded string, including a streaming prefix.
   * @param key - argument name.
   * @returns the string field's decoded text so far; undefined when absent or not a string.
   */
  text(key) {
    return this.remember("text", key, () => this.textNow(key));
  }
  /**
   * Read at most the first decoded UTF-16 units of a string.
   * @param key - argument name.
   * @param maxLength - maximum decoded UTF-16 length, floored to at least one.
   * @returns the bounded string prefix; undefined when absent or not a string.
   */
  textPrefix(key, maxLength) {
    const limit = Math.max(1, Math.floor(maxLength));
    return this.remember(
      `prefix:${limit}`,
      key,
      () => this.textPrefixNow(key, limit)
    );
  }
  /**
   * Read a completed non-string argument.
   * @param key - argument name.
   * @returns the parsed non-string value once it closed; undefined while open, absent, or a string.
   */
  value(key) {
    return this.remember("value", key, () => this.valueNow(key));
  }
  /** Answer a question and, on a streaming view, remember it for change detection. */
  remember(kind, key, read, comparison) {
    this.scan();
    const result = read();
    if (!this.sealed) {
      const id = `${kind}/${key}`;
      if (!this.#reads.has(id)) {
        this.#reads.set(id, {
          completion: kind === "complete",
          answer: comparison === void 0 ? read : () => comparison(read()),
          last: comparison === void 0 ? result : comparison(result)
        });
      }
    }
    return result;
  }
  closedNow() {
    return this.sealed || this.#mode === "closed" || this.#mode === "invalid";
  }
  keysNow() {
    return this.object === void 0 ? this.#order : Object.keys(this.object);
  }
  hasNow(key) {
    return this.object === void 0 ? this.#entries.has(key) : Object.hasOwn(this.object, key);
  }
  completeNow(key) {
    if (this.object !== void 0) return Object.hasOwn(this.object, key);
    const entry = this.#entries.get(key);
    return entry !== void 0 && entry.end >= 0 && (entry.kind === "string" ? entry.invalidAt === void 0 : !entry.invalid);
  }
  lengthNow(key, limit = Number.POSITIVE_INFINITY) {
    if (this.object !== void 0) {
      const field = Object.hasOwn(this.object, key) ? this.object[key] : void 0;
      return typeof field === "string" ? field.length : void 0;
    }
    const entry = this.#entries.get(key);
    if (entry?.kind !== "string") return void 0;
    if (entry.text !== void 0 && entry.text.at === entry.end) return entry.text.length;
    const read = entry.length ??= { at: entry.start, length: 0, text: "" };
    this.readString(entry, read, limit, false);
    return read.length;
  }
  textNow(key) {
    if (this.object !== void 0) {
      const field = Object.hasOwn(this.object, key) ? this.object[key] : void 0;
      return typeof field === "string" ? field : void 0;
    }
    const entry = this.#entries.get(key);
    if (entry?.kind !== "string") return void 0;
    if (entry.text === void 0 && entry.end >= 0 && entry.needsDecoding && entry.invalidAt === void 0) {
      let text;
      try {
        text = JSON.parse(`"${this.slice(entry.start, entry.end)}"`);
      } catch (_error) {
      }
      if (text !== void 0) entry.text = { at: entry.end, length: text.length, text };
    }
    const read = entry.text ??= { at: entry.start, length: 0, text: "" };
    this.readString(entry, read, Number.POSITIVE_INFINITY, true);
    return read.text;
  }
  textPrefixNow(key, maxLength) {
    if (this.object !== void 0) {
      const field = Object.hasOwn(this.object, key) ? this.object[key] : void 0;
      return typeof field === "string" ? field.slice(0, maxLength) : void 0;
    }
    const entry = this.#entries.get(key);
    if (entry?.kind !== "string") return void 0;
    const prefixes = entry.prefixes ??= /* @__PURE__ */ new Map();
    let read = prefixes.get(maxLength);
    if (read === void 0) {
      read = { at: entry.start, length: 0, text: "" };
      prefixes.set(maxLength, read);
    }
    this.readString(entry, read, maxLength, true);
    return read.text;
  }
  valueNow(key) {
    if (this.object !== void 0) {
      if (!Object.hasOwn(this.object, key)) return void 0;
      const field = this.object[key];
      return typeof field === "string" ? void 0 : field;
    }
    const entry = this.#entries.get(key);
    if (entry?.kind !== "value" || entry.end < 0 || entry.invalid) return void 0;
    if (entry.parsed === void 0) {
      try {
        entry.parsed = JSON.parse(this.slice(entry.start, entry.end));
      } catch (_error) {
        entry.invalid = true;
        this.#invalidValue = true;
      }
    }
    return entry.parsed;
  }
  chunkAt(at) {
    let low = 0;
    let high = this.#ends.length;
    while (low < high) {
      const mid = low + high >>> 1;
      if (this.#ends[mid] <= at) low = mid + 1;
      else high = mid;
    }
    return low;
  }
  /** Materialize only a requested range, never the cumulative source. */
  slice(start, end) {
    if (start >= end) return "";
    const first = this.chunkAt(start);
    const last = this.chunkAt(end - 1);
    const base = first === 0 ? 0 : this.#ends[first - 1];
    if (first === last) return this.chunks[first].slice(start - base, end - base);
    const parts = [this.chunks[first].slice(start - base)];
    for (let i = first + 1; i < last; i++) parts.push(this.chunks[i]);
    parts.push(this.chunks[last].slice(0, end - this.#ends[last - 1]));
    return parts.join("");
  }
  readString(entry, read, limit, materialize) {
    const end = Math.min(
      entry.end < 0 ? this.#consumed : entry.end,
      entry.invalidAt ?? Number.POSITIVE_INFINITY,
      this.#invalidAt ?? Number.POSITIVE_INFINITY
    );
    if (!entry.needsDecoding) {
      const length = Math.min(end - read.at, limit - read.length);
      if (length <= 0) return;
      if (materialize) read.text += this.slice(read.at, read.at + length);
      read.at += length;
      read.length += length;
      return;
    }
    let chunkIndex = this.chunkAt(read.at);
    while (read.at < end && read.length < limit) {
      const base = chunkIndex === 0 ? 0 : this.#ends[chunkIndex - 1];
      const chunk = this.chunks[chunkIndex];
      const remaining = chunk.slice(read.at - base, Math.min(chunk.length, end - base));
      const boundary = remaining.search(CONTENT_ESCAPE);
      const length = Math.min(boundary < 0 ? remaining.length : boundary, limit - read.length);
      if (length > 0) {
        if (materialize) read.text += remaining.slice(0, length);
        read.at += length;
        read.length += length;
        if (read.at === base + chunk.length) chunkIndex++;
        continue;
      }
      const type = remaining.length > 1 ? remaining[1] : read.at + 1 < end ? this.chunks[chunkIndex + 1][0] : void 0;
      let decoded;
      let width = 2;
      if (remaining[0] === "\\" && type === void 0 && entry.end < 0) return;
      if (remaining[0] === "\\" && type === "u") {
        const hex = this.slice(read.at + 2, Math.min(end, read.at + 6));
        let valid = true;
        for (let i = 0; i < hex.length; i++) if (!isHex(hex[i])) valid = false;
        if (valid) {
          if (hex.length < 4 && entry.end < 0) return;
          if (hex.length === 4) decoded = String.fromCharCode(Number.parseInt(hex, 16));
        }
        width = 6;
      } else if (remaining[0] === "\\" && type !== void 0) {
        decoded = SIMPLE_ESCAPES[type];
      }
      if (decoded === void 0) {
        entry.invalidAt = read.at;
        this.#invalidValue = true;
        return;
      }
      if (materialize) read.text += decoded;
      read.length++;
      read.at += width;
      while (chunkIndex < this.chunks.length && read.at >= this.#ends[chunkIndex]) chunkIndex++;
    }
  }
  /** Locate new field ranges without decoding or parsing their contents. */
  scan() {
    if (this.object !== void 0 || this.#consumed === this.#size) return;
    for (let i = this.chunkAt(this.#consumed); i < this.chunks.length && this.#invalidAt === void 0; i++) {
      const pending = this.chunks[i];
      const base = i === 0 ? 0 : this.#ends[i - 1];
      for (let index = this.#consumed - base; index < pending.length && this.#mode !== "invalid"; index++) {
        if (this.#mode === "string" || this.#mode === "nested" && this.#nestedInString) {
          const end = this.stringBoundary(pending, index);
          this.#consumed += end - index;
          index = end;
          if (index === pending.length) break;
        }
        this.step(pending[index], this.#consumed);
        this.#consumed++;
      }
    }
  }
  /** Only raw quotes and their preceding backslash runs can terminate a string. */
  stringBoundary(fragment, start) {
    let at = start;
    while (true) {
      const quote = fragment.indexOf('"', at);
      const end = quote < 0 ? fragment.length : quote;
      if (this.#mode === "string") {
        const entry = this.#current;
        if (!entry.needsDecoding && CONTENT_ESCAPE.test(fragment.slice(at, end))) entry.needsDecoding = true;
      }
      let slashStart = end;
      while (slashStart > at && fragment[slashStart - 1] === "\\") slashStart--;
      const escaped = (end - slashStart) % 2 === 1 !== (slashStart === at && this.#escape);
      this.#escape = quote < 0 && escaped;
      if (quote < 0 || !escaped) return end;
      at = quote + 1;
    }
  }
  step(c, at) {
    switch (this.#mode) {
      case "root":
        if (isWhitespace(c)) return;
        if (c === "{") {
          this.#mode = "key-or-end";
          return;
        }
        this.fail();
        return;
      case "key-or-end":
        if (isWhitespace(c)) return;
        if (c === "}") {
          this.#mode = "closed";
          return;
        }
        if (c === '"') {
          this.beginKey(at);
          return;
        }
        this.fail();
        return;
      case "key-only":
        if (isWhitespace(c)) return;
        if (c === '"') {
          this.beginKey(at);
          return;
        }
        this.fail();
        return;
      case "key":
        this.stepKey(c, at);
        return;
      case "colon":
        if (isWhitespace(c)) return;
        if (c === ":") {
          this.#mode = "value";
          return;
        }
        this.fail();
        return;
      case "value":
        this.beginValue(c, at);
        return;
      case "string": {
        const entry = this.#current;
        entry.end = at;
        this.#current = null;
        this.#mode = "comma-or-end";
        return;
      }
      case "scalar":
        this.stepScalar(c, at);
        return;
      case "nested":
        this.stepNested(c, at);
        return;
      case "comma-or-end":
        if (isWhitespace(c)) return;
        if (c === ",") {
          this.#mode = "key-only";
          return;
        }
        if (c === "}") {
          this.#mode = "closed";
          return;
        }
        this.fail();
        return;
      case "closed":
        if (isWhitespace(c)) return;
        this.fail();
        return;
      /* v8 ignore next 2 -- scan() stops stepping once the view is invalid. */
      case "invalid":
        return;
      /* v8 ignore next 2 -- Every scanner mode has a handler above. */
      default:
        assertNever(this.#mode);
    }
  }
  fail() {
    this.#invalidAt = this.#consumed;
    this.#mode = "invalid";
    this.#current = null;
  }
  beginKey(at) {
    this.#mode = "key";
    this.#keyStart = at + 1;
    this.#keyEscaped = false;
    this.#escape = false;
  }
  stepKey(c, at) {
    if (c < " ") {
      this.fail();
      return;
    }
    if (this.#escape) {
      this.#escape = false;
      return;
    }
    if (c === "\\") {
      this.#escape = true;
      this.#keyEscaped = true;
      return;
    }
    if (c !== '"') return;
    const raw = this.slice(this.#keyStart, at);
    if (this.#keyEscaped) {
      try {
        this.#key = JSON.parse(`"${raw}"`);
      } catch (_error) {
        this.fail();
        return;
      }
    } else {
      this.#key = raw;
    }
    this.#mode = "colon";
  }
  open(entry) {
    if (!this.#entries.has(this.#key)) this.#order.push(this.#key);
    this.#entries.set(this.#key, entry);
    this.#current = entry;
  }
  beginValue(c, at) {
    if (isWhitespace(c)) return;
    if (c === '"') {
      this.open({
        kind: "string",
        start: at + 1,
        end: -1,
        needsDecoding: false,
        invalidAt: void 0,
        length: void 0,
        text: void 0,
        prefixes: void 0
      });
      this.#escape = false;
      this.#mode = "string";
      return;
    }
    if (c === "}" || c === "," || c === ":" || c === "]") {
      this.fail();
      return;
    }
    this.open({ kind: "value", start: at, end: -1, parsed: void 0, invalid: false });
    if (c === "{" || c === "[") {
      this.#mode = "nested";
      this.#nestedEnds = [c === "{" ? "}" : "]"];
      this.#nestedInString = false;
      this.#escape = false;
      return;
    }
    this.#mode = "scalar";
  }
  stepScalar(c, at) {
    if (c !== "," && c !== "}" && !isWhitespace(c)) return;
    this.closeValue(at);
    this.#mode = c === "," ? "key-only" : c === "}" ? "closed" : "comma-or-end";
  }
  stepNested(c, at) {
    if (this.#nestedInString) {
      this.#nestedInString = false;
      return;
    }
    if (c === '"') {
      this.#nestedInString = true;
      return;
    }
    if (c === "{" || c === "[") {
      this.#nestedEnds.push(c === "{" ? "}" : "]");
      return;
    }
    if (c === "}" || c === "]") {
      if (this.#nestedEnds.pop() !== c) {
        this.fail();
        return;
      }
      if (this.#nestedEnds.length === 0) {
        this.closeValue(at + 1);
        this.#mode = "comma-or-end";
      }
    }
  }
  closeValue(end) {
    const entry = this.#current;
    entry.end = end;
    this.#current = null;
  }
};

// deepseek-harness/packages/util/values/src/index.ts
function assertNever(value, context) {
  const rendered = JSON.stringify(value) ?? String(value);
  throw new Error(`unreachable variant${context ? ` in ${context}` : ""}: ${rendered}`);
}
function hasIntrinsicConstructor(prototype, name) {
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "constructor");
  const constructor = descriptor?.value;
  if (typeof constructor !== "function") return false;
  try {
    return constructor.name === name && constructor.prototype === prototype && Function.prototype.toString.call(constructor) === Function.prototype.toString.call(name === "Array" ? Array : Object);
  } catch {
    return false;
  }
}
function isIntrinsicObjectPrototype(value) {
  return Object.getPrototypeOf(value) === null && hasIntrinsicConstructor(value, "Object");
}
function hasPlainArrayPrototype(value) {
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(prototype) || !hasIntrinsicConstructor(prototype, "Array")) return false;
  const objectPrototype = Object.getPrototypeOf(prototype);
  return typeof objectPrototype === "object" && objectPrototype !== null && isIntrinsicObjectPrototype(objectPrototype);
}
function hasPlainObjectPrototype(value) {
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || typeof prototype === "object" && isIntrinsicObjectPrototype(prototype);
}
function enumerableStringKeys(value) {
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string" || !Object.prototype.propertyIsEnumerable.call(value, key))) return void 0;
  return keys;
}
function walkJsonValue(value, detach) {
  const ancestors = /* @__PURE__ */ new Set();
  let root;
  let parent;
  const assign = (item) => {
    if (parent === void 0) {
      if (detach) root = item;
    } else if (parent.kind === "array") {
      if (parent.target !== void 0) parent.target[parent.key] = item;
    } else if (parent.target !== void 0) {
      Object.defineProperty(parent.target, parent.key, {
        value: item,
        enumerable: true,
        configurable: true,
        writable: true
      });
    }
  };
  const frames = [];
  let current2 = value;
  for (; ; ) {
    if (current2 === null) {
      assign(null);
    } else if (typeof current2 === "boolean" || typeof current2 === "string") {
      assign(current2);
    } else if (typeof current2 === "number") {
      if (!Number.isFinite(current2) || Object.is(current2, -0)) return void 0;
      assign(current2);
    } else {
      if (typeof current2 !== "object") return void 0;
      if (ancestors.has(current2)) return void 0;
      if (Array.isArray(current2)) {
        if (!hasPlainArrayPrototype(current2)) return void 0;
        const length = current2.length;
        if (Reflect.ownKeys(current2).length !== length + 1) return void 0;
        const target = detach ? [] : void 0;
        if (target !== void 0) assign(target);
        let indices;
        if (!Number.isInteger(length)) {
          indices = [];
          for (let index = length - 1; index >= 0; index--) indices.push(index);
        }
        frames.push({ kind: "array", source: current2, length: indices?.length ?? length, index: 0, key: 0, indices, target });
      } else {
        if (!hasPlainObjectPrototype(current2)) return void 0;
        const keys = enumerableStringKeys(current2);
        if (keys === void 0) return void 0;
        const target = detach ? {} : void 0;
        if (target !== void 0) assign(target);
        frames.push({ kind: "object", source: current2, keys, index: 0, key: "", target });
      }
      ancestors.add(current2);
    }
    for (; ; ) {
      const frame = frames.at(-1);
      if (frame === void 0) return detach ? root : true;
      const length = frame.kind === "array" ? frame.length : frame.keys.length;
      if (frame.index >= length) {
        ancestors.delete(frame.source);
        frames.pop();
        continue;
      }
      const index = frame.index++;
      parent = frame;
      if (frame.kind === "array") {
        const key = frame.indices === void 0 ? index : frame.indices[frame.indices.length - index - 1];
        if (key === void 0) return void 0;
        if (!Object.prototype.hasOwnProperty.call(frame.source, key)) return void 0;
        frame.key = key;
        current2 = frame.source[key];
      } else {
        const key = frame.keys[index];
        if (key === void 0) return void 0;
        frame.key = key;
        current2 = frame.source[key];
      }
      break;
    }
  }
}
function snapshotJsonValue(value) {
  return walkJsonValue(value, true);
}
function deepFreeze(value) {
  const seen = /* @__PURE__ */ new WeakSet();
  const pending = [{ kind: "visit", node: value }];
  while (pending.length > 0) {
    const task = pending.pop();
    if (task === void 0) continue;
    if (task.kind === "property") {
      pending.push({ kind: "visit", node: task.source[task.key] });
      continue;
    }
    const node = task.node;
    if (node === null || typeof node !== "object") continue;
    if (node instanceof AbortSignal) continue;
    if (seen.has(node)) continue;
    seen.add(node);
    Object.freeze(node);
    const keys = Object.keys(node);
    for (let index = keys.length - 1; index >= 0; index--) {
      const key = keys[index];
      if (key === void 0) continue;
      pending.push({ kind: "property", source: node, key });
    }
  }
  return value;
}

// deepseek-harness/packages/client/ui-conversation/src/client/conversation/group-store.ts
function sameNodeReference(left, right) {
  return left.key === right.key && left.groupPart === right.groupPart;
}
function sameEntry(left, right) {
  return left.kind === right.kind && left.key === right.key && (left.kind === "group" || right.kind === "node" && left.groupPart === right.groupPart);
}
function reuseReferences(previous, next, equal) {
  return previous === next || previous.length === next.length && previous.every((value, index) => equal(value, next[index])) ? previous : next;
}
var ConversationGroupStore = class {
  root = [];
  rootGroups = /* @__PURE__ */ new Set();
  groups = /* @__PURE__ */ new Map();
  placements = /* @__PURE__ */ new Map();
  sources = /* @__PURE__ */ new Map();
  dirty = /* @__PURE__ */ new Set();
  /** @returns the identity-stable ordered root references. */
  get entries() {
    return this.root;
  }
  groupSource(key) {
    let source = this.sources.get(key);
    if (source === void 0) {
      const publication = createSnapshotStore(this.groups.get(key));
      source = {
        publication,
        observable: {
          getSnapshot: () => this.groups.get(key),
          subscribe: (listener) => publication.subscribe(listener)
        }
      };
      this.sources.set(key, source);
    }
    return source.observable;
  }
  /**
   * Install one validated update without notifying readers.
   * @param update - root replacement and complete or incremental group records.
   * @param readNode - synchronous reader of the current target Nodes.
   */
  prepareAndInstall(update, readNode) {
    const nextRoot = update.entries === void 0 ? this.root : reuseReferences(this.root, update.entries, sameEntry);
    const nextRootGroups = nextRoot === this.root ? this.rootGroups : this.collectRootGroups(nextRoot);
    const { upserts, removes } = this.collectChanges(update);
    const replaceReferences = update.groups.kind === "replace";
    const size = this.groups.size - removes.size + [...upserts.keys()].filter((key) => !this.groups.has(key)).length;
    if (size !== nextRootGroups.size) {
      throw new Error("conversation group records and root references must correspond one-to-one");
    }
    for (const key of removes) {
      if (nextRootGroups.has(key)) throw new Error(`conversation group "${key}" is still referenced`);
    }
    for (const key of upserts.keys()) {
      if (!nextRootGroups.has(key)) throw new Error(`conversation group "${key}" has no root reference`);
    }
    if (nextRootGroups !== this.rootGroups) {
      for (const key of nextRootGroups) {
        if (!upserts.has(key) && !this.groups.has(key)) {
          throw new Error(`conversation root references missing group "${key}"`);
        }
      }
    }
    const affectedParts = /* @__PURE__ */ new Map();
    const partsOf = (key) => {
      let parts = affectedParts.get(key);
      if (parts === void 0) {
        parts = new Set(this.placements.get(key));
        affectedParts.set(key, parts);
      }
      return parts;
    };
    const removeReference = (reference) => {
      partsOf(reference.key).delete(reference.groupPart);
    };
    const addReference = (reference) => {
      if (readNode(reference.key) === void 0) {
        throw new Error(`conversation group references missing Node "${reference.key}"`);
      }
      const parts = partsOf(reference.key);
      if (parts.has(reference.groupPart) || reference.groupPart === void 0 && parts.size > 0 || parts.has(void 0)) {
        throw new Error(`conversation Node "${reference.key}" has overlapping rendering positions`);
      }
      parts.add(reference.groupPart);
    };
    if (replaceReferences || nextRoot !== this.root) {
      for (const entry of this.root) if (entry.kind === "node") removeReference(entry);
    }
    for (const key of removes) {
      for (const member of this.groups.get(key).members) removeReference(member);
    }
    for (const [key, next] of upserts) {
      const previous = this.groups.get(key);
      if (previous !== void 0 && (replaceReferences || previous.members !== next.members)) {
        for (const member of previous.members) removeReference(member);
      }
    }
    if (replaceReferences || nextRoot !== this.root) {
      for (const entry of nextRoot) if (entry.kind === "node") addReference(entry);
    }
    for (const [key, next] of upserts) {
      if (replaceReferences || this.groups.get(key)?.members !== next.members) {
        for (const member of next.members) addReference(member);
      }
    }
    for (const [key, parts] of affectedParts) {
      if (parts.size === 0) this.placements.delete(key);
      else this.placements.set(key, parts);
    }
    for (const key of removes) {
      this.groups.delete(key);
      this.dirty.add(key);
    }
    for (const [key, next] of upserts) {
      if (this.groups.get(key) === next) continue;
      this.groups.set(key, next);
      this.dirty.add(key);
    }
    this.root = nextRoot;
    this.rootGroups = nextRootGroups;
  }
  /** Publish changed group sources after all related target data has been installed. */
  publish() {
    const keys = [...this.dirty];
    this.dirty.clear();
    for (const key of keys) this.sources.get(key)?.publication.set(this.groups.get(key));
  }
  /** Remove grouping without deleting its source Nodes; publication remains deferred. */
  clear() {
    this.prepareAndInstall(
      { entries: [], groups: { kind: "replace", snapshots: [] } },
      /* v8 ignore next -- an empty replacement never reads a Node reference. */
      () => void 0
    );
  }
  collectRootGroups(entries) {
    const keys = /* @__PURE__ */ new Set();
    for (const entry of entries) {
      if (entry.kind !== "group") continue;
      if (keys.has(entry.key)) throw new Error(`conversation group "${entry.key}" has duplicate root references`);
      keys.add(entry.key);
    }
    return keys;
  }
  collectChanges(update) {
    const upserts = /* @__PURE__ */ new Map();
    const removes = /* @__PURE__ */ new Set();
    const add = (snapshot) => {
      if (upserts.has(snapshot.key)) throw new Error(`conversation group "${snapshot.key}" has duplicate upserts`);
      const previous = this.groups.get(snapshot.key);
      if (previous === void 0) {
        upserts.set(snapshot.key, snapshot);
        return;
      }
      const members = reuseReferences(previous.members, snapshot.members, sameNodeReference);
      upserts.set(snapshot.key, previous.data === snapshot.data && previous.members === members ? previous : { ...snapshot, members });
    };
    switch (update.groups.kind) {
      case "replace":
        for (const snapshot of update.groups.snapshots) add(snapshot);
        for (const key of this.groups.keys()) if (!upserts.has(key)) removes.add(key);
        break;
      case "apply":
        for (const snapshot of update.groups.upserts) add(snapshot);
        for (const key of update.groups.removes) {
          if (removes.has(key)) throw new Error(`conversation group "${key}" has duplicate removals`);
          if (!this.groups.has(key)) throw new Error(`conversation group "${key}" cannot be removed because it is absent`);
          if (upserts.has(key)) throw new Error(`conversation group "${key}" cannot be upserted and removed together`);
          removes.add(key);
        }
        break;
      /* v8 ignore next 2 -- closed update union; TypeScript rejects other operation tags. */
      default:
        assertNever(update.groups);
    }
    return { upserts, removes };
  }
};

// deepseek-harness/packages/client/ui-conversation/src/client/conversation/location-index.ts
var MutableLocationDataSource = class {
  constructor(store, key) {
    this.store = store;
    this.key = key;
    this.published = store.get(key);
  }
  listeners = /* @__PURE__ */ new Set();
  published;
  getSnapshot = () => this.store.get(this.key);
  subscribe = (listener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  publish() {
    const next = this.getSnapshot();
    if (this.published === next) return;
    this.published = next;
    notifySubscribers(this.listeners, `[ui-conversation] Location data ${this.key}`);
  }
};
var MutableLocationDataStore = class {
  constructor(markDirty) {
    this.markDirty = markDirty;
  }
  entries = /* @__PURE__ */ new Map();
  sources = /* @__PURE__ */ new Map();
  dirtyKeys = /* @__PURE__ */ new Set();
  get(key) {
    return this.entries.get(key)?.value;
  }
  source(key) {
    let source = this.sources.get(key);
    if (source === void 0) {
      source = new MutableLocationDataSource(this, key);
      this.sources.set(key, source);
    }
    return source;
  }
  remove(owner, key) {
    const current2 = this.entries.get(key);
    if (current2?.owner !== owner) return false;
    this.entries.delete(key);
    this.changed(key);
    return true;
  }
  set(owner, key, value) {
    const current2 = this.entries.get(key);
    if (current2 !== void 0 && current2.owner !== owner) {
      throw new Error(`conversation Location data "${key}" is already owned by ${current2.owner}`);
    }
    if (current2?.value === value) return false;
    this.entries.set(key, { owner, value });
    this.changed(key);
    return true;
  }
  replace(entries) {
    const changedKeys = [];
    for (const key of /* @__PURE__ */ new Set([...this.entries.keys(), ...entries.keys()])) {
      const current2 = this.entries.get(key);
      const next = entries.get(key);
      if (current2?.owner !== next?.owner || current2?.value !== next?.value) changedKeys.push(key);
    }
    if (changedKeys.length === 0) return false;
    this.entries = new Map(entries);
    for (const key of changedKeys) this.changed(key);
    return true;
  }
  publish() {
    const dirty = [...this.dirtyKeys];
    this.dirtyKeys.clear();
    for (const key of dirty) this.sources.get(key)?.publish();
  }
  changed(key) {
    this.dirtyKeys.add(key);
    this.markDirty(this);
  }
};
var SESSION_LOCATION = { kind: "session" };
var UNRESOLVED_LOCATION = { kind: "unresolved" };
function payloadCoordinates(event) {
  const data = event.data;
  if (data.turn === null) return { session: true, location: void 0 };
  const turn = Number.isSafeInteger(data.turn) && data.turn >= 0 ? data.turn : void 0;
  const step = Number.isSafeInteger(data.step) && data.step >= 0 ? data.step : void 0;
  if (turn === void 0) return step === void 0 ? { location: void 0 } : { step, location: void 0 };
  return step === void 0 ? { turn, location: void 0 } : { turn, step, location: void 0 };
}
function sameReferences(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
function sameStep(left, right) {
  return left !== void 0 && left.start === right.start && left.end === right.end && left.status === right.status && left.data === right.data;
}
function sameTurn(left, right) {
  return left !== void 0 && left.start === right.start && left.end === right.end && left.status === right.status && left.data === right.data && sameReferences(left.steps, right.steps);
}
function sameLocation(left, right) {
  if (left === void 0 || right === void 0 || left.kind !== right.kind) return left === right;
  if (left.kind === "session" || left.kind === "unresolved") return true;
  if (right.kind === "session" || right.kind === "unresolved") return false;
  if (left.kind === "turn" || right.kind === "turn") {
    return left.kind === "turn" && right.kind === "turn" && left.turn === right.turn;
  }
  return left.turn === right.turn && left.step === right.step;
}
var ConversationLocationIndex = class {
  coordinates = /* @__PURE__ */ new Map();
  seqsByTurn = /* @__PURE__ */ new Map();
  stepsByTurn = /* @__PURE__ */ new Map();
  timeline = { turnOrder: [], turns: /* @__PURE__ */ new Map() };
  turnDataStores = /* @__PURE__ */ new Map();
  stepDataStores = /* @__PURE__ */ new Map();
  dirtyDataStores = /* @__PURE__ */ new Set();
  changedTurns = /* @__PURE__ */ new Set();
  currentTurn;
  currentStep;
  /**
   * Return the current reference-stable timeline.
   * @returns current timeline snapshot.
   */
  snapshot() {
    return this.timeline;
  }
  /**
   * Drain the Turn changes accumulated for one assembly flush.
   * @returns Turn identities changed since the preceding drain.
   */
  takeChangedTurns() {
    const turns = [...this.changedTurns];
    this.changedTurns.clear();
    return turns;
  }
  /**
   * Replace all Definition-owned Location values while preserving reader identities.
   * @param entries - complete current set of Definition-owned Location values.
   * @returns whether any published Location data changed.
   */
  replaceData(entries) {
    const turns = /* @__PURE__ */ new Map();
    const steps = /* @__PURE__ */ new Map();
    for (const { owner, data } of entries) {
      const values = data.kind === "turn" ? turns.get(data.turn) ?? /* @__PURE__ */ new Map() : steps.get(stepDataKey(data.turn, requireStep(data))) ?? /* @__PURE__ */ new Map();
      const current2 = values.get(data.key);
      if (current2 !== void 0 && current2.owner !== owner) {
        throw new Error(`conversation Location data "${data.key}" is already owned by ${current2.owner}`);
      }
      values.set(data.key, { owner, value: data.value });
      if (data.kind === "turn") turns.set(data.turn, values);
      else steps.set(stepDataKey(data.turn, requireStep(data)), values);
    }
    let changed = false;
    for (const turn of /* @__PURE__ */ new Set([...this.turnDataStores.keys(), ...turns.keys()])) {
      changed = this.mutableTurnData(turn).replace(turns.get(turn) ?? /* @__PURE__ */ new Map()) || changed;
    }
    for (const step of /* @__PURE__ */ new Set([...this.stepDataStores.keys(), ...steps.keys()])) {
      changed = this.mutableStepData(step).replace(steps.get(step) ?? /* @__PURE__ */ new Map()) || changed;
    }
    return changed;
  }
  /**
   * Apply changed Context publications without rebuilding Turn/Step membership.
   * @param changes - incremental removals and replacements from published Contexts.
   * @returns whether any published Location data changed.
   */
  applyData(changes) {
    let changed = false;
    for (const change of changes) {
      const previous = change.previous;
      if (previous === null) continue;
      changed = this.storeFor(previous).remove(change.owner, previous.key) || changed;
    }
    for (const change of changes) {
      const next = change.next;
      if (next === null) continue;
      changed = this.storeFor(next).set(change.owner, next.key, next.value) || changed;
    }
    return changed;
  }
  /** Publish committed Location-data changes to their keyed sources. */
  publishData() {
    const dirty = [...this.dirtyDataStores];
    this.dirtyDataStores.clear();
    for (const store of dirty) store.publish();
  }
  /**
   * Resolve the latest Location for one event.
   * @param event - event already ingested into this index.
   * @returns current Location, falling back to session when it has no Turn/Step affinity.
   */
  locationOf(event) {
    return this.coordinates.get(event.seq)?.location ?? SESSION_LOCATION;
  }
  /**
   * Rebuild timeline facts after replace/prepend or a boundary append.
   * @param entries - complete current window in ascending seq order.
   * @returns seqs whose resolved Location changed.
   */
  rebuild(entries) {
    const previousCoordinates = this.coordinates;
    const turns = /* @__PURE__ */ new Map();
    const coordinates = /* @__PURE__ */ new Map();
    let currentTurn;
    let currentStep;
    const turnDraft = (turn, seq) => {
      let draft = turns.get(turn);
      if (draft === void 0) {
        draft = { turn, firstSeq: seq, steps: /* @__PURE__ */ new Map() };
        turns.set(turn, draft);
      } else {
        draft.firstSeq = Math.min(draft.firstSeq, seq);
      }
      return draft;
    };
    const stepDraft = (turn, step, seq) => {
      const owner = turnDraft(turn, seq);
      let draft = owner.steps.get(step);
      if (draft === void 0) {
        draft = { turn, step, firstSeq: seq };
        owner.steps.set(step, draft);
      } else {
        draft.firstSeq = Math.min(draft.firstSeq, seq);
      }
      return draft;
    };
    for (const { event } of entries) {
      const explicit = payloadCoordinates(event);
      if (event.type === "turn/start") {
        currentTurn = event.data.turn;
        currentStep = void 0;
      }
      if (event.type === "step/start") {
        currentTurn = event.data.turn;
        currentStep = event.data.step;
      }
      if (explicit.session !== true && explicit.turn !== void 0) {
        if (currentTurn !== explicit.turn) currentStep = void 0;
        currentTurn = explicit.turn;
        if (explicit.step !== void 0) currentStep = explicit.step;
      }
      const turn = explicit.session === true ? void 0 : explicit.turn ?? currentTurn;
      const step = explicit.session === true || event.type === "turn/start" || event.type === "turn/end" ? void 0 : explicit.step ?? (turn === currentTurn ? currentStep : void 0);
      coordinates.set(event.seq, {
        ...turn === void 0 ? {} : { turn },
        ...turn === void 0 || step === void 0 ? {} : { step },
        location: void 0
      });
      if (turn !== void 0) turnDraft(turn, event.seq);
      if (turn !== void 0 && step !== void 0) stepDraft(turn, step, event.seq);
      if (event.type === "turn/start") {
        turnDraft(event.data.turn, event.seq).start = event;
      } else if (event.type === "turn/end") {
        turnDraft(event.data.turn, event.seq).end = event;
      } else if (event.type === "step/start") {
        stepDraft(event.data.turn, event.data.step, event.seq).start = event;
      } else if (event.type === "step/end") {
        stepDraft(event.data.turn, event.data.step, event.seq).end = event;
      }
      if (event.type === "step/end" && currentTurn === event.data.turn && currentStep === event.data.step) {
        currentStep = void 0;
      }
      if (event.type === "turn/end" && currentTurn === event.data.turn) {
        currentTurn = void 0;
        currentStep = void 0;
      }
    }
    const previousTurns = this.timeline.turns;
    const nextTurns = /* @__PURE__ */ new Map();
    const orderedDrafts = [...turns.values()].sort((left, right) => left.firstSeq - right.firstSeq);
    for (const draft of orderedDrafts) {
      const previousTurn = previousTurns.get(draft.turn);
      const previousSteps = new Map(previousTurn?.steps.map((step) => [step.step, step]) ?? []);
      const steps = [...draft.steps.values()].sort((left, right) => left.firstSeq - right.firstSeq).map((candidate) => {
        const value2 = {
          turn: candidate.turn,
          step: candidate.step,
          start: candidate.start,
          end: candidate.end,
          status: candidate.end !== void 0 ? "closed" : candidate.start === void 0 ? "unknown" : "open",
          data: this.stepData(candidate.turn, candidate.step)
        };
        const previous = previousSteps.get(candidate.step);
        return sameStep(previous, value2) ? previous : value2;
      });
      const value = {
        turn: draft.turn,
        start: draft.start,
        end: draft.end,
        status: draft.end !== void 0 ? "closed" : draft.start === void 0 ? "unknown" : "open",
        steps,
        data: this.turnData(draft.turn)
      };
      nextTurns.set(draft.turn, sameTurn(previousTurn, value) ? previousTurn : value);
    }
    const nextOrder = orderedDrafts.map((draft) => draft.turn);
    const turnOrder = this.timeline.turnOrder.length === nextOrder.length && this.timeline.turnOrder.every((turn, index) => turn === nextOrder[index]) ? this.timeline.turnOrder : nextOrder;
    let sameMap = previousTurns.size === nextTurns.size;
    if (sameMap) {
      for (const [turn, value] of nextTurns) {
        if (previousTurns.get(turn) !== value) {
          sameMap = false;
          break;
        }
      }
    }
    for (const turn of /* @__PURE__ */ new Set([...previousTurns.keys(), ...nextTurns.keys()])) {
      if (previousTurns.get(turn) !== nextTurns.get(turn)) this.changedTurns.add(turn);
    }
    this.timeline = sameMap && turnOrder === this.timeline.turnOrder ? this.timeline : { turnOrder, turns: nextTurns };
    this.stepsByTurn.clear();
    for (const [number, turn] of this.timeline.turns) {
      this.stepsByTurn.set(number, new Map(turn.steps.map((step) => [step.step, step])));
    }
    this.coordinates = coordinates;
    this.seqsByTurn = /* @__PURE__ */ new Map();
    for (const { event } of entries) {
      const coordinates2 = this.coordinates.get(event.seq);
      if (coordinates2.turn !== void 0) this.indexTurnSeq(coordinates2.turn, event.seq);
      coordinates2.location = this.resolve(event.seq);
    }
    this.currentTurn = currentTurn;
    this.currentStep = currentStep;
    const changed = /* @__PURE__ */ new Set();
    for (const { event } of entries) {
      if (!sameLocation(
        previousCoordinates.get(event.seq)?.location,
        this.coordinates.get(event.seq)?.location
      )) {
        changed.add(event.seq);
      }
    }
    return changed;
  }
  /**
   * Append one Turn/Step boundary while revisiting only the owning Turn.
   * @param event - contiguous tail boundary event.
   * @returns seqs whose immutable Location reference changed.
   */
  appendBoundary(event) {
    if (event.type !== "turn/start" && event.type !== "turn/end" && event.type !== "step/start" && event.type !== "step/end") {
      throw new Error(`conversation Location boundary expected, received ${event.type}`);
    }
    const explicit = payloadCoordinates(event);
    if (event.type === "turn/start") {
      this.currentTurn = event.data.turn;
      this.currentStep = void 0;
    } else if (event.type === "step/start") {
      this.currentTurn = event.data.turn;
      this.currentStep = event.data.step;
    }
    if (explicit.turn !== void 0) {
      if (this.currentTurn !== explicit.turn) this.currentStep = void 0;
      this.currentTurn = explicit.turn;
      if (explicit.step !== void 0) this.currentStep = explicit.step;
    }
    const turnNumber = explicit.turn ?? this.currentTurn;
    if (turnNumber === void 0) throw new Error(`conversation boundary ${event.type} has no turn`);
    const stepNumber = event.type === "turn/start" || event.type === "turn/end" ? void 0 : explicit.step ?? (turnNumber === this.currentTurn ? this.currentStep : void 0);
    this.coordinates.set(event.seq, {
      turn: turnNumber,
      ...stepNumber === void 0 ? {} : { step: stepNumber },
      location: this.coordinates.get(event.seq)?.location
    });
    this.indexTurnSeq(turnNumber, event.seq);
    const previousTurn = this.timeline.turns.get(turnNumber);
    let steps = previousTurn?.steps ?? [];
    if (event.type === "step/start" || event.type === "step/end") {
      const number = event.data.step;
      const indexedSteps = this.stepsByTurn.get(turnNumber) ?? /* @__PURE__ */ new Map();
      const previousStep = indexedSteps.get(number);
      const candidate2 = {
        turn: turnNumber,
        step: number,
        start: event.type === "step/start" ? event : previousStep?.start,
        end: event.type === "step/end" ? event : previousStep?.end,
        status: event.type === "step/end" || previousStep?.end !== void 0 ? "closed" : "open",
        data: this.stepData(turnNumber, number)
      };
      const nextStep = sameStep(previousStep, candidate2) ? previousStep : candidate2;
      indexedSteps.set(number, nextStep);
      this.stepsByTurn.set(turnNumber, indexedSteps);
      const index = steps.findIndex((step) => step.step === number);
      steps = index < 0 ? [...steps, nextStep] : steps.map((step, at) => at === index ? nextStep : step);
    }
    const candidate = {
      turn: turnNumber,
      start: event.type === "turn/start" ? event : previousTurn?.start,
      end: event.type === "turn/end" ? event : previousTurn?.end,
      status: event.type === "turn/end" || previousTurn?.end !== void 0 ? "closed" : event.type === "turn/start" || previousTurn?.start !== void 0 ? "open" : "unknown",
      steps,
      data: this.turnData(turnNumber)
    };
    const turn = sameTurn(previousTurn, candidate) ? previousTurn : candidate;
    const turns = new Map(this.timeline.turns);
    turns.set(turnNumber, turn);
    const turnOrder = previousTurn === void 0 ? [...this.timeline.turnOrder, turnNumber] : this.timeline.turnOrder;
    this.timeline = { turnOrder, turns };
    if (turn !== previousTurn) this.changedTurns.add(turnNumber);
    const changed = /* @__PURE__ */ new Set();
    for (const seq of this.seqsByTurn.get(turnNumber) ?? []) {
      const coordinates = this.coordinates.get(seq);
      const previous = coordinates.location;
      const next = this.resolve(seq);
      coordinates.location = next;
      if (!sameLocation(previous, next)) changed.add(seq);
    }
    if (event.type === "step/end" && this.currentTurn === event.data.turn && this.currentStep === event.data.step) {
      this.currentStep = void 0;
    }
    if (event.type === "turn/end" && this.currentTurn === event.data.turn) {
      this.currentTurn = void 0;
      this.currentStep = void 0;
    }
    return changed;
  }
  /**
   * Index one non-boundary tail event without scanning the window or the Turn's Steps.
   * @param event - contiguous appended event.
   */
  appendNonBoundary(event) {
    const explicit = payloadCoordinates(event);
    if (explicit.session === true) {
      this.coordinates.set(event.seq, { location: SESSION_LOCATION });
      return;
    }
    if (explicit.turn !== void 0) {
      if (this.currentTurn !== explicit.turn) this.currentStep = void 0;
      this.currentTurn = explicit.turn;
      if (explicit.step !== void 0) this.currentStep = explicit.step;
    }
    const turn = explicit.turn ?? this.currentTurn;
    const step = explicit.step ?? (turn === this.currentTurn ? this.currentStep : void 0);
    const coordinates = explicit.turn !== void 0 && explicit.step !== void 0 ? explicit : {
      ...turn === void 0 ? {} : { turn },
      ...turn === void 0 || step === void 0 ? {} : { step },
      location: void 0
    };
    this.coordinates.set(event.seq, coordinates);
    if (turn !== void 0) this.indexTurnSeq(turn, event.seq);
    coordinates.location = this.resolve(event.seq);
  }
  /**
   * Remove indexed Assistant transients without rebuilding the Turn/Step timeline.
   * @param events - transient events retired by one Assistant settlement.
   */
  removeAssistantTransients(events) {
    for (const event of events) {
      const turn = this.coordinates.get(event.seq)?.turn;
      if (turn !== void 0) {
        const seqs = this.seqsByTurn.get(turn);
        seqs?.delete(event.seq);
        if (seqs?.size === 0) this.seqsByTurn.delete(turn);
      }
      this.coordinates.delete(event.seq);
    }
  }
  /**
   * Index one durable Assistant settlement inserted before an already visible tail.
   * @param event - message or attempt settlement with explicit Turn and Step coordinates.
   */
  insertAssistantSettlement(event) {
    const coordinates = {
      turn: event.data.turn,
      step: event.data.step,
      location: void 0
    };
    this.coordinates.set(event.seq, coordinates);
    this.indexTurnSeq(event.data.turn, event.seq);
    coordinates.location = this.resolve(event.seq);
  }
  indexTurnSeq(turn, seq) {
    let current2 = this.seqsByTurn.get(turn);
    if (current2 === void 0) {
      current2 = /* @__PURE__ */ new Set();
      this.seqsByTurn.set(turn, current2);
    }
    current2.add(seq);
  }
  turnData(turn) {
    return this.mutableTurnData(turn);
  }
  stepData(turn, step) {
    return this.mutableStepData(stepDataKey(turn, step));
  }
  mutableTurnData(turn) {
    const current2 = this.turnDataStores.get(turn) ?? this.createDataStore(turn);
    this.turnDataStores.set(turn, current2);
    return current2;
  }
  mutableStepData(key) {
    const current2 = this.stepDataStores.get(key) ?? this.createDataStore(Number(key.slice(0, key.indexOf(":"))));
    this.stepDataStores.set(key, current2);
    return current2;
  }
  createDataStore(turn) {
    return new MutableLocationDataStore((store) => {
      this.dirtyDataStores.add(store);
      this.changedTurns.add(turn);
    });
  }
  storeFor(data) {
    return data.kind === "turn" ? this.mutableTurnData(data.turn) : this.mutableStepData(stepDataKey(data.turn, requireStep(data)));
  }
  resolve(seq) {
    const coordinates = this.coordinates.get(seq);
    if (coordinates?.turn === void 0) return SESSION_LOCATION;
    const turn = this.timeline.turns.get(coordinates.turn);
    if (turn === void 0) return UNRESOLVED_LOCATION;
    if (coordinates.step === void 0) return { kind: "turn", turn };
    const step = this.stepsByTurn.get(coordinates.turn)?.get(coordinates.step);
    return step === void 0 ? { kind: "turn", turn } : { kind: "step", turn, step };
  }
};
function stepDataKey(turn, step) {
  return `${turn}:${step}`;
}
function requireStep(data) {
  if (data.kind === "step" && data.step !== void 0) return data.step;
  throw new Error(`conversation Step data "${data.key}" requires a step`);
}

// deepseek-harness/packages/client/ui-conversation/src/client/conversation/assembler.ts
var ConversationUpdateError = class extends Error {
  /** Whether every active view shows the complete rebuild. */
  rebuilt;
  /**
   * @param rebuilt - whether every active view shows the complete rebuild.
   * @param options - the original failure, or an `AggregateError` of both failures, as `cause`.
   */
  constructor(rebuilt, options) {
    super(rebuilt ? "conversation update failed; the loaded window was rebuilt" : "conversation update failed, and rebuilding the loaded window also failed", options);
    this.name = "ConversationUpdateError";
    this.rebuilt = rebuilt;
  }
};
var PUBLICATION_RANK = {
  none: 0,
  "animation-frame": 1,
  immediate: 2
};
var LOCATION_DATA_SCOPES = ["step", "turn"];
function emptyLocationData() {
  return { step: null, turn: null };
}
function maximumPublication(left, right) {
  return PUBLICATION_RANK[left] >= PUBLICATION_RANK[right] ? left : right;
}
function startSeq(context) {
  return context.startSeq;
}
function insertionIndex(contexts, seq) {
  let low = 0;
  let high = contexts.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    const candidate = contexts[middle];
    if (candidate !== void 0 && candidate.startSeq < seq) low = middle + 1;
    else high = middle;
  }
  return low;
}
function contextSnapshot(context) {
  return {
    key: context.key,
    kind: context.kind,
    id: context.id,
    matches: context.matches,
    start: context.start,
    state: context.state,
    current: context.current
  };
}
function mergeMatches(key, additions, existing) {
  const merged = [];
  let added = 0;
  let current2 = 0;
  while (added < additions.length || current2 < existing.length) {
    const left = additions[added];
    const right = existing[current2];
    if (left !== void 0 && right !== void 0 && left.event.seq === right.event.seq) {
      throw new Error(`conversation Context ${key} received duplicate Match ${left.event.seq}`);
    }
    if (right === void 0 || left !== void 0 && left.event.seq < right.event.seq) {
      merged.push(left);
      added++;
    } else {
      merged.push(right);
      current2++;
    }
  }
  return merged;
}
function conversationMatch(input, role, location) {
  return { event: input.event, role, location };
}
var NO_GROUPS = { entries: () => [], forTarget: () => void 0 };
var ConversationNodeAssembler = class {
  /**
   * @param eventDefinitions - live Event Definition registry.
   * @param viewDefinitions - live view builder registry.
   * @param groupDefinitions - optional registered grouping rules, independent of presentation modes.
   */
  constructor(eventDefinitions, viewDefinitions, groupDefinitions = NO_GROUPS) {
    this.eventDefinitions = eventDefinitions;
    this.viewDefinitions = viewDefinitions;
    this.groupDefinitions = groupDefinitions;
    this.resetViewBuilders();
  }
  contexts = /* @__PURE__ */ new Map();
  contextsByKind = /* @__PURE__ */ new Map();
  contextsBySeq = /* @__PURE__ */ new Map();
  contextsByTarget = /* @__PURE__ */ new Map();
  inputs = /* @__PURE__ */ new Map();
  locationIndex = new ConversationLocationIndex();
  dirty = /* @__PURE__ */ new Set();
  dirtyByTarget = /* @__PURE__ */ new Map();
  revised = /* @__PURE__ */ new Set();
  dependents = /* @__PURE__ */ new Map();
  views = /* @__PURE__ */ new Map();
  groups = /* @__PURE__ */ new Map();
  pendingGroupStores = /* @__PURE__ */ new Set();
  activeTargets = /* @__PURE__ */ new Set();
  /** Matches of the event in dispatch, kept by index; dispatch is not reentrant and reuses both arrays. */
  matchedDefinitions = [];
  matchedResults = [];
  hasMore = false;
  rebuildPending = false;
  replacePending = true;
  timelineDirty = true;
  /**
   * Read the current open turn without activating a View.
   * @returns the latest turn number when its start is loaded and it remains open, otherwise undefined.
   */
  openTurn() {
    const snapshot = this.locationIndex.snapshot();
    const latest2 = snapshot.turnOrder.at(-1);
    const turn = latest2 === void 0 ? void 0 : snapshot.turns.get(latest2);
    return turn?.status === "open" && turn.start !== void 0 ? turn.turn : void 0;
  }
  /**
   * Replace the complete loaded window after open, resync, or gap repair.
   * @param entries - complete contiguous window.
   * @param hasMore - whether older history remains outside the window.
   * @returns immediate publication request.
   */
  replaceWindow(entries, hasMore) {
    this.contexts.clear();
    this.contextsByKind.clear();
    this.contextsBySeq.clear();
    this.contextsByTarget.clear();
    this.inputs.clear();
    this.dirty.clear();
    this.dirtyByTarget.clear();
    this.revised.clear();
    this.dependents.clear();
    this.hasMore = hasMore;
    const sorted = [...entries].sort((left, right) => left.event.seq - right.event.seq);
    for (const entry of sorted) this.inputs.set(entry.event.seq, entry);
    this.locationIndex.rebuild(sorted);
    this.timelineDirty = true;
    for (const entry of sorted) this.matchInput(entry);
    this.replayDependencies();
    this.revised.clear();
    for (const context of this.contexts.values()) this.markDirty(context);
    this.replacePending = true;
    return "immediate";
  }
  /**
   * Add one contiguous live tail event without scanning existing Contexts.
   * @param record - appended Session event entry.
   * @returns highest requested publication cadence.
   */
  append(record) {
    const event = record.event;
    if (this.inputs.has(event.seq)) return "none";
    if (this.revised.size > 0) this.revised.clear();
    this.inputs.set(event.seq, record);
    let publication = "none";
    if (event.type !== "assistant/live-chunk" && isLocationBoundary(event.type)) {
      const previousTimeline = this.locationIndex.snapshot();
      const changed = this.locationIndex.appendBoundary(event);
      if (this.locationIndex.snapshot() !== previousTimeline) {
        this.timelineDirty = true;
        publication = "immediate";
      }
      this.replayContexts(this.refreshMatchLocations(changed));
      if (changed.size > 0) publication = "immediate";
    } else {
      this.locationIndex.appendNonBoundary(event);
    }
    publication = maximumPublication(publication, this.matchInput(record));
    if (this.replayRevisedDependents()) publication = "immediate";
    if (this.revised.size > 0) this.revised.clear();
    return publication;
  }
  /**
   * Retire one Assistant attempt's transient matches and apply its optional durable settlement.
   * Empty Contexts retain their keys and published nodes until the loaded window is rebuilt;
   * Definitions may hide those nodes when no start remains instead of withdrawing their identities.
   * @param attemptId - process-local attempt whose transient presentation ended.
   * @param entry - durable message or attempt event committed for the stream.
   * @returns highest requested publication cadence.
   */
  settleAssistant(attemptId, entry) {
    this.revised.clear();
    const retired = [...this.inputs.values()].filter((candidate) => candidate.type === "transient" && candidate.event.data.attemptId === attemptId);
    const retiredSeqs = new Set(retired.map((candidate) => candidate.event.seq));
    const affected = /* @__PURE__ */ new Set();
    for (const seq of retiredSeqs) {
      this.inputs.delete(seq);
      for (const context of this.contextsBySeq.get(seq) ?? []) affected.add(context);
      this.contextsBySeq.delete(seq);
    }
    for (const context of affected) {
      context.matches = context.matches.filter((match) => !retiredSeqs.has(match.event.seq));
    }
    this.locationIndex.removeAssistantTransients(retired.map((candidate) => candidate.event));
    let publication = retired.length === 0 ? "none" : "immediate";
    if (entry !== void 0 && !this.inputs.has(entry.event.seq)) {
      this.inputs.set(entry.event.seq, entry);
      this.locationIndex.insertAssistantSettlement(entry.event);
      const pending = /* @__PURE__ */ new Map();
      publication = maximumPublication(publication, this.collectInput(entry, pending));
      this.applyPendingMatches(pending, affected);
    }
    this.replayContexts(affected);
    if (this.replayRevisedDependents()) publication = "immediate";
    this.revised.clear();
    return publication;
  }
  /**
   * Add an older page while preserving existing Context and view identities.
   * @param entries - newly loaded older Events.
   * @param hasMore - whether history still precedes the expanded window.
   * @returns highest requested publication cadence.
   */
  prepend(entries, hasMore) {
    this.revised.clear();
    let publication = "none";
    const previousHasMore = this.hasMore;
    const fresh = entries.filter((entry) => !this.inputs.has(entry.event.seq)).sort((left, right) => left.event.seq - right.event.seq);
    for (const entry of fresh) this.inputs.set(entry.event.seq, entry);
    this.hasMore = hasMore;
    const previousTimeline = this.locationIndex.snapshot();
    const changedLocations = this.locationIndex.rebuild(this.sortedInputs());
    if (this.locationIndex.snapshot() !== previousTimeline) this.timelineDirty = true;
    const affected = this.refreshMatchLocations(changedLocations);
    const pending = /* @__PURE__ */ new Map();
    for (const entry of fresh) {
      publication = maximumPublication(publication, this.collectInput(entry, pending));
    }
    this.applyPendingMatches(pending, affected);
    this.replayContexts(affected);
    if ((this.revised.size > 0 || previousHasMore !== hasMore) && this.replayDependencies()) {
      publication = "immediate";
    }
    if (changedLocations.size > 0) publication = "immediate";
    this.revised.clear();
    return publication;
  }
  /**
   * Rebuild against the current Registry set after a low-frequency plugin change.
   * @returns immediate publication request.
   */
  rebuildRegistry() {
    this.resetViewBuilders();
    return this.replaceWindow(this.sortedInputs(), this.hasMore);
  }
  /**
   * Materialize dirty Contexts and advance every active view builder.
   * When an incremental update throws, the assembler replays the complete loaded
   * window into new Contexts and replaces every active view before it throws a
   * {@link ConversationUpdateError}. A Definition that throws on every incremental
   * update therefore makes each flush replay the whole window. A failure on the
   * complete-replacement path propagates unchanged, publishes no view, and keeps
   * the replacement pending for the next flush.
   * @returns whether any view snapshot was rebuilt or incrementally applied.
   * @throws {@link ConversationUpdateError} when an incremental update fails.
   */
  flush() {
    if (this.rebuildPending) this.rebuildWindow();
    if (!this.replacePending && this.dirty.size === 0 && !this.timelineDirty) return false;
    if (this.replacePending) return this.flushReplacement();
    try {
      return this.flushIncremental();
    } catch (error) {
      return this.recoverIncremental(error);
    }
  }
  flushReplacement() {
    this.replaceLocationData();
    const updated = [];
    const changedTurns = this.locationIndex.takeChangedTurns();
    for (const target of this.activeTargets) {
      const view = this.views.get(target);
      if (view === void 0) continue;
      this.updateView(view, true, this.buildTargetNodes(target, this.contextsByTarget.get(target)), changedTurns);
      updated.push(view);
    }
    this.replacePending = false;
    this.dirty.clear();
    this.dirtyByTarget.clear();
    this.timelineDirty = false;
    return this.publishViews(updated);
  }
  /** Replace partial incremental state with a complete rebuild, then report the original failure. */
  recoverIncremental(error) {
    try {
      this.rebuildWindow();
      this.flushReplacement();
    } catch (recoveryError) {
      throw new ConversationUpdateError(false, {
        cause: new AggregateError([error, recoveryError], "conversation update and its rebuild failed")
      });
    }
    throw new ConversationUpdateError(true, { cause: error });
  }
  /** Rebuild every Context from the loaded inputs; a failed rebuild stays pending for the next flush. */
  rebuildWindow() {
    this.rebuildPending = true;
    this.replaceWindow(this.sortedInputs(), this.hasMore);
    this.rebuildPending = false;
  }
  flushIncremental() {
    const updated = [];
    if (this.applyDirtyLocationData()) this.timelineDirty = true;
    const changedTurns = this.locationIndex.takeChangedTurns();
    const timelineDirty = this.timelineDirty;
    for (const target of this.activeTargets) {
      const view = this.views.get(target);
      if (view === void 0) continue;
      const builder = view.builder;
      if (builder === void 0) continue;
      const upserts = this.buildTargetUpserts(target, this.dirtyByTarget.get(target));
      if (upserts.length === 0 && !timelineDirty) continue;
      this.updateView(view, false, upserts, changedTurns);
      updated.push(view);
    }
    this.dirty.clear();
    this.dirtyByTarget.clear();
    this.timelineDirty = false;
    return this.publishViews(updated);
  }
  /**
   * Add one target to the monotonic active set and materialize its current snapshot.
   * Pending Context work is flushed before the first complete replacement. When that
   * flush throws, the target stays inactive and a later activation retries it.
   * @param target - registered or subsequently registered view target.
   * @returns whether any active target snapshot changed.
   */
  activateTarget(target) {
    const view = this.views.get(target);
    if (this.activeTargets.has(target)) return false;
    const published = this.flush();
    this.activeTargets.add(target);
    if (view === void 0) return published;
    this.replaceView(view);
    this.publishViews([view]);
    return true;
  }
  /**
   * Read the latest snapshot of a registered target.
   * @param target - registered view target.
   * @returns target snapshot, or undefined before registration or activation.
   */
  snapshot(target) {
    return this.views.get(target)?.snapshot;
  }
  get(target) {
    return this.snapshot(target);
  }
  grouped(target) {
    return this.groups.get(target)?.store;
  }
  /**
   * Read targets whose owners classify their latest snapshot as visible activity.
   * @returns target ids contributing visible activity.
   */
  activityTargets() {
    const active = /* @__PURE__ */ new Set();
    for (const target of this.activeTargets) {
      const view = this.views.get(target);
      if (view === void 0) continue;
      if (view.isActive?.(view.snapshot) === true) active.add(view.target);
    }
    return active;
  }
  sortedInputs() {
    return [...this.inputs.values()].sort((left, right) => left.event.seq - right.event.seq);
  }
  matchInput(input) {
    return this.dispatchInput(input, this.acceptMatch);
  }
  collectInput(input, pending) {
    return this.dispatchInput(input, (definition, id, match) => {
      const key = conversationContextKey(definition.kind, id);
      const matches = pending.get(key) ?? [];
      matches.push({ definition, id, match });
      pending.set(key, matches);
      return definition.publication?.(match) ?? "immediate";
    });
  }
  dispatchInput(input, accept) {
    const event = input.event;
    let startMatch;
    let updateMatch;
    let location;
    const matchFor = (role) => {
      location ??= this.locationIndex.locationOf(event);
      return role === "start" ? startMatch ??= conversationMatch(input, role, location) : updateMatch ??= conversationMatch(input, role, location);
    };
    const definitions = this.matchedDefinitions;
    const results = this.matchedResults;
    definitions.length = 0;
    results.length = 0;
    const routes = this.eventDefinitions.forEvent?.(event.type);
    if (routes === void 0) {
      for (const definition of this.eventDefinitions.entries()) {
        const result = definition.match(event);
        if (result === null) continue;
        definitions.push(definition);
        results.push(result);
      }
    } else {
      for (const { definition, match } of routes) {
        const result = match(event);
        if (result === null) continue;
        definitions.push(definition);
        results.push(result);
      }
    }
    let claims;
    for (let index = 0; index < results.length; index++) {
      if (results[index].exclusive !== true) continue;
      const definition = definitions[index];
      const target2 = definition.target;
      if (target2 === void 0) {
        throw new Error(`conversation Definition "${definition.kind}" claims ${event.type} at seq ${String(event.seq)} without a target`);
      }
      const claimant = claims?.get(target2);
      if (claimant !== void 0) {
        throw new Error(`conversation Definitions "${claimant}" and "${definition.kind}" both claim ${event.type} at seq ${String(event.seq)} on target "${target2}"`);
      }
      (claims ??= /* @__PURE__ */ new Map()).set(target2, definition.kind);
    }
    let firstTarget;
    let secondTarget;
    let otherTargets;
    let publication = "none";
    for (let index = 0; index < results.length; index++) {
      const definition = definitions[index];
      const result = results[index];
      const target2 = definition.target;
      if (target2 !== void 0 && result.exclusive !== true && claims?.has(target2) === true) continue;
      if (target2 !== void 0 && target2 !== firstTarget && target2 !== secondTarget) {
        if (firstTarget === void 0) firstTarget = target2;
        else if (secondTarget === void 0) secondTarget = target2;
        else (otherTargets ??= /* @__PURE__ */ new Set()).add(target2);
      }
      publication = maximumPublication(publication, accept.call(this, definition, result.id, matchFor(result.role)));
    }
    const fallback = this.eventDefinitions.fallbackEntry();
    const target = fallback?.target;
    if (fallback !== void 0 && target !== void 0 && target !== firstTarget && target !== secondTarget && otherTargets?.has(target) !== true) {
      const result = fallback.match(event);
      if (result !== null) {
        publication = maximumPublication(publication, accept.call(this, fallback, result.id, matchFor(result.role)));
      }
    }
    return publication;
  }
  createContext(definition, id, key) {
    const context = {
      key,
      kind: definition.kind,
      id,
      definition,
      startSeq: void 0,
      start: void 0,
      matches: [],
      state: void 0,
      revision: 0,
      current: /* @__PURE__ */ new Map(),
      locationData: emptyLocationData(),
      dependencies: /* @__PURE__ */ new Map()
    };
    this.contexts.set(key, context);
    this.indexTargetContext(context);
    return context;
  }
  acceptMatch(definition, id, match) {
    const latest2 = this.contextsByKind.get(definition.kind)?.at(-1);
    const key = latest2?.id === id ? latest2.key : conversationContextKey(definition.kind, id);
    let context = this.contexts.get(key);
    context ??= this.createContext(definition, id, key);
    const starting = match.role === "start" && context.start === void 0;
    const previous = context.matches.at(-1);
    if (previous !== void 0 && previous.event.seq >= match.event.seq) {
      throw new Error(`conversation Context ${key} received non-appended Match ${match.event.seq}`);
    }
    if (starting && context.matches.length > 0) {
      throw new Error(`conversation Context ${key} received an update before its start Match`);
    }
    context.matches.push(match);
    if (starting) {
      context.startSeq = match.event.seq;
      context.start = match;
      this.indexStartedContext(context);
    }
    let owners = this.contextsBySeq.get(match.event.seq);
    if (owners === void 0) {
      owners = [];
      this.contextsBySeq.set(match.event.seq, owners);
    }
    owners.push(context);
    if (starting) {
      this.replayContext(context);
    } else if (context.state !== void 0) {
      const typed = contextSnapshot(context);
      context.state = requireState(definition, "update", definition.update(typed, match));
      context.revision++;
      this.revised.add(context);
    }
    this.markDirty(context);
    return definition.publication?.(match) ?? "immediate";
  }
  applyPendingMatches(pending, affected) {
    for (const [key, entries] of pending) {
      const first = entries[0];
      if (first === void 0) continue;
      let context = this.contexts.get(key);
      context ??= this.createContext(first.definition, first.id, key);
      const additions = entries.map((entry) => {
        if (entry.definition !== context.definition || entry.id !== context.id) {
          throw new Error(`conversation Context ${key} received inconsistent Definition identity`);
        }
        let owners = this.contextsBySeq.get(entry.match.event.seq);
        if (owners === void 0) {
          owners = [];
          this.contextsBySeq.set(entry.match.event.seq, owners);
        }
        owners.push(context);
        return entry.match;
      }).sort((left, right) => left.event.seq - right.event.seq);
      context.matches = mergeMatches(context.key, additions, context.matches);
      affected.add(context);
      this.markDirty(context);
    }
  }
  replayContexts(contexts) {
    this.refreshStarts(contexts);
    const ordered = [...contexts].sort((left, right) => (left.startSeq ?? Number.POSITIVE_INFINITY) - (right.startSeq ?? Number.POSITIVE_INFINITY));
    for (const context of ordered) {
      if (context.start === void 0) {
        context.state = void 0;
        this.replaceDependencies(context, /* @__PURE__ */ new Map());
        context.revision++;
        this.revised.add(context);
        this.markDirty(context);
        continue;
      }
      this.replayContext(context);
    }
  }
  refreshStarts(contexts) {
    const changed = /* @__PURE__ */ new Set();
    const startsByKind = /* @__PURE__ */ new Map();
    for (const context of contexts) {
      const start = context.matches.find((match) => match.role === "start");
      if (start === context.start) continue;
      context.start = start;
      context.startSeq = start?.event.seq;
      changed.add(context);
      const starts = startsByKind.get(context.kind) ?? [];
      if (start !== void 0) starts.push(context);
      startsByKind.set(context.kind, starts);
    }
    for (const [kind, starts] of startsByKind) {
      const existing = this.contextsByKind.get(kind) ?? [];
      this.contextsByKind.set(kind, existing.filter((context) => !changed.has(context)));
      this.indexStartedContexts(kind, starts);
    }
  }
  replayContext(context) {
    const start = context.start;
    if (start === void 0) {
      context.state = void 0;
      return;
    }
    if (context.matches[0] !== start) {
      throw new Error(`conversation Context ${context.key} received an update before its start Match`);
    }
    const dependencies = /* @__PURE__ */ new Map();
    const reader = this.readerFor(start.event.seq, dependencies);
    context.state = void 0;
    context.state = requireState(
      context.definition,
      "start",
      context.definition.start(contextSnapshot(context), start, reader)
    );
    this.replaceDependencies(context, dependencies);
    for (let index = 1; index < context.matches.length; index++) {
      const match = context.matches[index];
      if (match === void 0) continue;
      const typed = contextSnapshot(context);
      context.state = requireState(
        context.definition,
        "update",
        context.definition.update(typed, match)
      );
    }
    context.revision++;
    this.revised.add(context);
    this.markDirty(context);
  }
  indexTargetContext(context) {
    const target = context.definition.target;
    if (target === void 0) return;
    const contexts = this.contextsByTarget.get(target) ?? /* @__PURE__ */ new Set();
    contexts.add(context);
    this.contextsByTarget.set(target, contexts);
  }
  markDirty(context) {
    if (this.dirty.has(context)) return;
    this.dirty.add(context);
    const target = context.definition.target;
    if (target === void 0 || !this.activeTargets.has(target)) return;
    let contexts = this.dirtyByTarget.get(target);
    if (contexts === void 0) {
      contexts = /* @__PURE__ */ new Set();
      this.dirtyByTarget.set(target, contexts);
    }
    contexts.add(context);
  }
  replaceDependencies(context, dependencies) {
    for (const dependency of context.dependencies.values()) {
      if (dependency.key === void 0) continue;
      const current2 = this.dependents.get(dependency.key);
      current2?.delete(context);
      if (current2?.size === 0) this.dependents.delete(dependency.key);
    }
    context.dependencies = dependencies;
    for (const dependency of dependencies.values()) {
      if (dependency.key === void 0) continue;
      const current2 = this.dependents.get(dependency.key) ?? /* @__PURE__ */ new Set();
      current2.add(context);
      this.dependents.set(dependency.key, current2);
    }
  }
  replayRevisedDependents() {
    if (this.dependents.size === 0) return false;
    const pending = [...this.revised];
    const affected = /* @__PURE__ */ new Set();
    for (let index = 0; index < pending.length; index++) {
      const dependency = pending[index];
      if (dependency === void 0) continue;
      for (const dependent of this.dependents.get(dependency.key) ?? []) {
        if (affected.has(dependent)) continue;
        affected.add(dependent);
        pending.push(dependent);
      }
    }
    if (affected.size > 0) this.replayContexts(affected);
    return affected.size > 0;
  }
  readerFor(beforeSeq, dependencies) {
    return {
      previous: (kind) => {
        const predecessor = this.previousContext(kind, beforeSeq);
        dependencies.set(kind, {
          kind,
          key: predecessor?.key,
          revision: predecessor?.revision,
          windowGap: predecessor === void 0 && this.hasMore
        });
        if (predecessor?.state === void 0) return void 0;
        const seq = startSeq(predecessor);
        if (seq === void 0) return void 0;
        return {
          key: predecessor.key,
          kind: predecessor.kind,
          id: predecessor.id,
          startSeq: seq,
          state: predecessor.state,
          matches: predecessor.matches
        };
      }
    };
  }
  previousContext(kind, beforeSeq) {
    const candidates = this.contextsByKind.get(kind) ?? [];
    const indexBefore = insertionIndex(candidates, beforeSeq);
    for (let index = indexBefore - 1; index >= 0; index--) {
      const candidate = candidates[index];
      if (candidate?.state !== void 0) return candidate;
    }
    return void 0;
  }
  /** Insert one newly discovered start into its Definition's ordered predecessor index. */
  indexStartedContext(context) {
    const seq = context.startSeq;
    if (seq === void 0) return;
    const candidates = this.contextsByKind.get(context.kind) ?? [];
    const previous = candidates.at(-1);
    if (previous === void 0 || previous.startSeq < seq) candidates.push(context);
    else candidates.splice(insertionIndex(candidates, seq), 0, context);
    this.contextsByKind.set(context.kind, candidates);
  }
  indexStartedContexts(kind, additions) {
    if (additions.length === 0) return;
    const sorted = [...additions].sort((left, right) => left.startSeq - right.startSeq);
    const existing = this.contextsByKind.get(kind) ?? [];
    const merged = [];
    let before = 0;
    let added = 0;
    while (before < existing.length || added < sorted.length) {
      const left = existing[before];
      const right = sorted[added];
      if (right === void 0 || left !== void 0 && left.startSeq < right.startSeq) {
        merged.push(left);
        before++;
      } else {
        merged.push(right);
        added++;
      }
    }
    this.contextsByKind.set(kind, merged);
  }
  replayDependencies() {
    let replayed = false;
    const ordered = [...this.contexts.values()].filter((context) => startSeq(context) !== void 0).sort((left, right) => startSeq(left) - startSeq(right));
    for (const context of ordered) {
      if (context.state === void 0 || context.dependencies.size === 0) continue;
      const before = startSeq(context);
      if (before === void 0) continue;
      let changed = false;
      for (const dependency of context.dependencies.values()) {
        const current2 = this.previousContext(dependency.kind, before);
        const windowGap = current2 === void 0 && this.hasMore;
        if (current2?.key !== dependency.key || current2?.revision !== dependency.revision || windowGap !== dependency.windowGap) {
          changed = true;
          break;
        }
      }
      if (changed) {
        this.replayContext(context);
        replayed = true;
      }
    }
    return replayed;
  }
  refreshMatchLocations(changedSeqs) {
    const affected = /* @__PURE__ */ new Set();
    if (changedSeqs.size === 0) return affected;
    for (const seq of changedSeqs) {
      for (const context of this.contextsBySeq.get(seq) ?? []) affected.add(context);
    }
    for (const context of affected) {
      let start = context.start;
      const matches = context.matches.map((match) => {
        if (!changedSeqs.has(match.event.seq)) return match;
        if (match.role === "start") {
          const refreshed = {
            ...match,
            location: this.locationIndex.locationOf(match.event)
          };
          if (match === start) start = refreshed;
          return refreshed;
        }
        return { ...match, location: this.locationIndex.locationOf(match.event) };
      });
      context.matches = matches;
      context.start = start;
    }
    return affected;
  }
  buildNode(context, target) {
    if (context.definition.target !== target || context.definition.buildViewNode === void 0) return null;
    const node = context.definition.buildViewNode(contextSnapshot(context));
    if (node === null) return null;
    if (node.key !== context.key) {
      throw new Error(`conversation Definition "${context.kind}" returned unstable key "${node.key}"; expected "${context.key}"`);
    }
    if (node.target !== target) {
      throw new Error(`conversation Definition "${context.kind}" returned target "${node.target}" while building "${target}"`);
    }
    return node;
  }
  replaceView(view) {
    this.updateView(view, true, this.buildTargetNodes(view.target, this.contextsByTarget.get(view.target)), []);
  }
  updateView(view, replacing, nodes, changedTurns) {
    const builder = view.builder ?? view.definition.create();
    const definition = view.groupDefinition;
    if (definition !== void 0 && builder.groupInput === void 0) {
      throw new Error(`conversation group target "${view.target}" requires builder.groupInput()`);
    }
    view.builder = builder;
    const timeline = this.locationIndex.snapshot();
    const snapshot = replacing ? builder.replace({ nodes, timeline, changedTurns }) : builder.apply({ upserts: nodes, timeline, changedTurns });
    if (definition !== void 0 && builder.groupInput !== void 0) {
      let context = this.groups.get(view.target);
      const initial = context === void 0;
      if (context === void 0) {
        context = { definition, state: definition.create(), store: new ConversationGroupStore() };
      }
      const input = builder.groupInput();
      context.state = definition.update(context, input);
      const change = definition.buildGroups(context);
      if ((initial || input.kind === "replace") && (change === null || change.entries === void 0 || change.groups.kind !== "replace")) {
        throw new Error(`conversation group target "${view.target}" requires complete grouping for replacement input`);
      }
      if (change !== null) {
        context.store.prepareAndInstall(change, input.readNode);
        this.pendingGroupStores.add(context.store);
      }
      this.groups.set(view.target, context);
    }
    view.snapshot = snapshot;
  }
  publishViews(updated) {
    const changed = updated.length > 0 || this.pendingGroupStores.size > 0;
    const stores = [...this.pendingGroupStores];
    this.pendingGroupStores.clear();
    for (const view of updated) view.builder?.publish?.();
    for (const store of stores) store.publish();
    this.locationIndex.publishData();
    return changed;
  }
  buildTargetNodes(target, contexts) {
    const nodes = [];
    for (const context of contexts ?? []) {
      const node = this.buildNode(context, target);
      context.current.set(target, node);
      if (node !== null) nodes.push(node);
    }
    return nodes;
  }
  buildTargetUpserts(target, contexts) {
    const upserts = [];
    for (const context of contexts ?? []) {
      const previous = context.current.get(target) ?? null;
      const node = this.buildNode(context, target);
      if (node === null && previous !== null) {
        throw new Error(
          `conversation Definition "${context.kind}" withdrew materialized target "${target}"; return the same key with hidden visibility instead`
        );
      }
      context.current.set(target, node);
      if (node !== null) upserts.push(node);
    }
    return upserts;
  }
  buildLocationData(context, scope, previous) {
    if (context.definition.buildLocationData === void 0) return null;
    const data = context.definition.buildLocationData(contextSnapshot(context), scope, previous);
    if (data === null) return null;
    if (data.kind !== scope) {
      throw new Error(
        `conversation Definition "${context.kind}" published ${data.kind} data through its ${scope} scope`
      );
    }
    if (data.key !== context.kind) {
      throw new Error(
        `conversation Definition "${context.kind}" published Location data key "${data.key}"; expected its owned kind`
      );
    }
    if (!Number.isSafeInteger(data.turn) || data.turn < 0) {
      throw new Error(`conversation Definition "${context.kind}" published invalid turn ${data.turn}`);
    }
    if (data.kind === "step" && (!Number.isSafeInteger(data.step) || data.step < 0)) {
      throw new Error(`conversation Definition "${context.kind}" published invalid step ${String(data.step)}`);
    }
    return data;
  }
  replaceLocationData() {
    const entries = [];
    for (const scope of LOCATION_DATA_SCOPES) {
      for (const context of this.contexts.values()) {
        const data = this.buildLocationData(context, scope, context.locationData[scope]);
        context.locationData[scope] = data;
        if (data !== null) entries.push({ owner: context.key, data });
      }
      this.locationIndex.replaceData(entries);
    }
  }
  applyDirtyLocationData() {
    let changed = false;
    for (const scope of LOCATION_DATA_SCOPES) {
      const changes = [];
      for (const context of this.dirty) {
        const previous = context.locationData[scope];
        const next = this.buildLocationData(context, scope, previous);
        if (previous === next) continue;
        context.locationData[scope] = next;
        changes.push({ owner: context.key, previous, next });
      }
      changed = this.locationIndex.applyData(changes) || changed;
    }
    return changed;
  }
  resetViewBuilders() {
    const definitions = this.viewDefinitions.entries();
    const targets = new Set(definitions.map((definition) => definition.target));
    for (const [target, group] of this.groups) {
      if (!targets.has(target) || this.groupDefinitions.forTarget(target) !== group.definition) {
        group.store.clear();
        this.pendingGroupStores.add(group.store);
        this.groups.delete(target);
      }
    }
    this.views.clear();
    for (const definition of definitions) {
      const view = {
        target: definition.target,
        definition,
        groupDefinition: this.groupDefinitions.forTarget(definition.target),
        isActive: definition.isActive === void 0 ? void 0 : (snapshot) => definition.isActive?.(snapshot) === true,
        builder: void 0,
        snapshot: void 0
      };
      this.views.set(definition.target, view);
    }
    this.replacePending = true;
  }
};
function isLocationBoundary(type) {
  return type === "turn/start" || type === "turn/end" || type === "step/start" || type === "step/end";
}
function requireState(definition, phase, state) {
  if (state === void 0) {
    throw new Error(`conversation Definition "${definition.kind}" returned undefined from ${phase}()`);
  }
  return state;
}

// deepseek-harness/packages/core/session/src/surface.ts
var SURFACE_EVENT_TYPES = /* @__PURE__ */ new Set([
  "system/message",
  "developer/message",
  "user/message",
  "assistant/message",
  "tool/result"
]);
function isSurfaceEvent(event) {
  if (!SURFACE_EVENT_TYPES.has(event.type)) return false;
  const candidate = event;
  return candidate.surfaceOp !== void 0;
}

// deepseek-harness/packages/client/ui-conversation/src/client/contract/system-prompt.ts
function inspectSystemPrompt(previous, event) {
  const op = isSurfaceEvent(event) ? event.surfaceOp : void 0;
  const firstSeq = previous?.firstSeq ?? event.seq;
  let nodes = previous?.nodes ?? [];
  let replacements = previous?.replacements ?? /* @__PURE__ */ new Map();
  const unknownEndpoint = (seq) => seq < firstSeq && !replacements.has(seq);
  const uncertain = previous?.uncertain === true || op !== void 0 && op !== "append" && (unknownEndpoint(op.startSeq) || unknownEndpoint(op.endSeq));
  if (uncertain) {
    return { firstSeq, uncertain, nodes: [], replacements: /* @__PURE__ */ new Map(), effective: void 0, introduced: void 0 };
  }
  let position = event.seq;
  if (op !== void 0 && op !== "append") {
    position = replacements.get(op.startSeq) ?? op.startSeq;
    const end = replacements.get(op.endSeq) ?? op.endSeq;
    nodes = nodes.filter((item) => item.position < position || item.position > end);
    const retained = new Map([...replacements].filter(([, value]) => value < position || value > end));
    retained.set(event.seq, position);
    replacements = retained;
  }
  const introduced = event.type === "system/message" ? {
    seq: event.seq,
    time: event.time,
    turn: event.data.turn,
    step: event.data.step,
    text: event.data.message.content.flatMap((block) => block.type === "text" ? [block.text] : []).join(""),
    update: op === "append" && previous?.nodes.some((item) => item.node.text !== "") === true
  } : void 0;
  if (introduced !== void 0) {
    nodes = [...nodes, { position, node: introduced }].sort((a, b) => a.position - b.position);
  }
  const surviving = nodes.findLast((item) => item.node.text !== "")?.node;
  const effective = surviving === previous?.nodes.findLast((item) => item.node.text !== "")?.node ? previous?.effective : introduced !== void 0 && introduced === surviving ? introduced : {
    seq: event.seq,
    time: event.time,
    turn: surviving?.turn ?? 0,
    step: surviving?.step ?? 0,
    text: surviving?.text ?? "",
    update: false
  };
  return { firstSeq, uncertain, nodes, replacements, effective, introduced };
}

// deepseek-harness/packages/client/ui-conversation/src/client/contract/request-inspection.ts
function inspectRequestPrompt(previous, event, system) {
  const header = event.data.header;
  const rawTools = header.tools;
  const prompt = {
    config: header.config,
    system: system?.text ?? "",
    tools: Array.isArray(rawTools) ? rawTools : []
  };
  if (previous === void 0 && event.data.reason !== "initial") return { prompt };
  const systemChanged = previous !== void 0 && previous.system !== prompt.system && system?.update !== true;
  const toolsChanged = previous !== void 0 && JSON.stringify(previous.tools) !== JSON.stringify(prompt.tools);
  if (previous !== void 0 && !systemChanged && !toolsChanged) return { prompt };
  const origin = system !== void 0 && (previous === void 0 || systemChanged) ? system : event;
  return {
    prompt,
    change: {
      seq: origin.seq,
      time: origin.time,
      kind: previous === void 0 ? "initial" : systemChanged && toolsChanged ? "system-and-tools" : systemChanged ? "system" : "tools",
      ...previous === void 0 ? {} : { previous }
    }
  };
}

// deepseek-harness/packages/client/ui-trajectory/src/client/trajectory-definition-common.ts
function trajectoryNode(context, anchorSeq, data) {
  return {
    key: context.key,
    kind: context.kind,
    id: context.id,
    target: "trajectory",
    anchorSeq,
    location: context.start?.location ?? { kind: "unresolved" },
    data
  };
}

// deepseek-harness/packages/client/ui-trajectory/src/client/trajectory-event-projection.ts
function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}
function readString(record, key) {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}
function collect(source, member, field) {
  const list = source[member];
  if (!Array.isArray(list)) return [];
  const seen = [];
  for (const entry of list) {
    const record = asRecord(entry);
    const value = record === null ? null : readString(record, field);
    if (value !== null && !seen.includes(value)) seen.push(value);
  }
  return seen;
}
function joined(names) {
  return names.length > 0 ? names.join(", ") : null;
}
var KNOWN_FORMS = [
  "instructions",
  "catalog",
  "snapshot",
  "notice",
  "relay",
  "recall"
];
function contextForm(source) {
  const record = asRecord(source);
  const form = record === null ? null : readString(record, "form");
  return form !== null && KNOWN_FORMS.includes(form) ? form : null;
}
function contextProducer(source) {
  const record = asRecord(source);
  const kind = record === null ? null : readString(record, "kind");
  if (record === null || kind === null) return { role: "inject", label: null };
  switch (kind) {
    case "session-reference":
      return { role: "recall", label: joined(collect(record, "references", "label")) ?? kind };
    case "agent-instructions":
      return { role: "inject", label: joined(collect(record, "changes", "path")) ?? kind };
    case "skill-invocation":
      return { role: "inject", label: readString(record, "name") ?? kind };
    default:
      return { role: "inject", label: kind };
  }
}
function toAssistantBlocks(content) {
  return content.map(toAssistantBlock);
}
function toAssistantBlock(block) {
  switch (block.type) {
    case "text":
      return { kind: "text", text: block.text };
    case "reasoning":
      return { kind: "reasoning", text: block.text };
    case "image":
      return { kind: "image", attachment: block.attachment };
    case "tool-call":
      return { kind: "tool-call", callId: String(block.id), name: block.name, argsRaw: block.arguments };
    default:
      return { kind: "other", block };
  }
}
function emptyAssistantBlock(blockType) {
  switch (blockType) {
    case "text":
      return { kind: "text", text: "" };
    case "reasoning":
      return { kind: "reasoning", text: "" };
    case "tool-call":
      return { kind: "tool-call", callId: "", name: "", argsRaw: "" };
    default:
      return { kind: "other", block: null };
  }
}
function displayFailure(failure) {
  if (failure === null || typeof failure !== "object") return { message: String(failure) };
  const record = failure;
  const code = typeof record.code === "string" ? record.code : void 0;
  if (code === "AUTH") return { code, message: "" };
  return {
    ...code === void 0 ? {} : { code },
    message: typeof record.message === "string" ? record.message : JSON.stringify(failure)
  };
}
function isTokenDelta(chunk) {
  switch (chunk.type) {
    case "text-delta":
    case "reasoning-delta":
      return chunk.text !== "";
    case "tool-call-delta":
      return chunk.argumentsDelta !== "" || chunk.name !== void 0;
    default:
      return false;
  }
}

// deepseek-harness/packages/client/ui-trajectory/src/client/trajectory-message-definitions.ts
var EMPTY_PENDING = { kind: "snapshot", ids: [] };
var EMPTY_CURRENT_CLAIMED = /* @__PURE__ */ new Set();
function materializePending(state) {
  const splices = [];
  let current2 = state;
  while (current2.kind === "splice") {
    splices.push(current2);
    current2 = current2.previous;
  }
  const pending = [...current2.ids];
  for (const splice of splices.reverse()) {
    pending.splice(splice.start, splice.removedCount, ...splice.inserted);
  }
  return pending;
}
function withoutInserted(claimed, inserted) {
  let next;
  for (const id of inserted) {
    if (!claimed.has(id)) continue;
    next ??= new Set(claimed);
    next.delete(id);
  }
  return next ?? claimed;
}
function applySplice(previous, splice) {
  const priorPending = previous?.state.pending ?? EMPTY_PENDING;
  const inserted = splice.inserted.map((identity) => identity.id);
  const removedCount = splice.removedCount ?? 0;
  if (removedCount > 0 && splice.outcome !== "canceled") {
    const pending = materializePending(priorPending);
    const removed = pending.splice(splice.start, removedCount, ...inserted);
    return {
      pending: { kind: "snapshot", ids: pending },
      currentClaimed: new Set(removed)
    };
  }
  const currentClaimed = withoutInserted(
    previous?.state.currentClaimed ?? EMPTY_CURRENT_CLAIMED,
    inserted
  );
  return {
    pending: {
      kind: "splice",
      previous: priorPending,
      start: splice.start,
      removedCount,
      inserted
    },
    currentClaimed
  };
}
var trajectoryInboxDefinition = {
  kind: "trajectory-inbox-next-step",
  match: (event) => {
    if (event.type === "agent/inbox/spliced" && event.data.target === "next-step") {
      return { id: String(event.seq), role: "start" };
    }
    return null;
  },
  start: (_context, match, reader) => {
    if (match.event.type !== "agent/inbox/spliced") {
      throw new Error("trajectory-inbox-next-step start requires agent/inbox/spliced");
    }
    return applySplice(
      reader.previous("trajectory-inbox-next-step"),
      match.event.data
    );
  },
  update: (context) => context.state,
  publication: () => "none"
};
var trajectoryMessageDefinition = {
  kind: "trajectory-input-message",
  target: "trajectory",
  match: (event) => {
    return event.type === "user/message" || event.type === "developer/message" ? { id: String(event.seq), role: "start" } : null;
  },
  start: (_context, match, reader) => {
    if (match.event.type === "developer/message") {
      const { seq, time, data: { message } } = match.event;
      return {
        kind: "context",
        seq,
        time,
        content: message.content,
        source: message.source,
        producer: contextProducer(message.source),
        form: contextForm(message.source)
      };
    }
    if (match.event.type !== "user/message") {
      throw new Error("trajectory-input-message start requires user/message");
    }
    const event = match.event;
    if (event.data.source.kind !== "user") {
      return {
        kind: "context",
        seq: event.seq,
        time: event.time,
        content: event.data.content,
        source: event.data.source,
        producer: contextProducer(event.data.source),
        form: contextForm(event.data.source)
      };
    }
    const claimed = reader.previous("trajectory-inbox-next-step")?.state.currentClaimed.has(String(event.data.id)) === true;
    return claimed ? {
      kind: "steering",
      messageId: event.data.id,
      seq: event.seq,
      time: event.time,
      content: event.data.content,
      source: event.data.source
    } : {
      kind: "user",
      seq: event.seq,
      time: event.time,
      content: event.data.content,
      source: event.data.source
    };
  },
  update: (context) => context.state,
  buildViewNode: (context) => context.state === void 0 ? null : trajectoryNode(context, context.state.seq, { kind: "node", node: context.state })
};
function registerTrajectoryMessageDefinitions(ctx) {
  ctx.uiConversation.events.register(trajectoryInboxDefinition);
  ctx.uiConversation.events.register(trajectoryMessageDefinition);
}

// deepseek-harness/packages/client/ui-trajectory/src/client/trajectory-request-header-definition.ts
function trajectorySystemMessageDefinition(inspect) {
  return {
    kind: "trajectory-system-message",
    target: "trajectory",
    match: (event) => event.type === "system/message" || "surfaceOp" in event && event.surfaceOp !== "append" ? { id: String(event.seq), role: "start" } : null,
    start: (_context, match, reader) => {
      if (match.event.type === "assistant/live-chunk") throw new Error("system-message requires a durable event");
      const prior = reader.previous("trajectory-system-message")?.state;
      const state = inspect(prior, match.event);
      const node = state.effective;
      if (state.uncertain) {
        const header2 = reader.previous("trajectory-request-header")?.state;
        if (header2 === void 0) return state;
        return {
          ...state,
          header: {
            seq: match.event.seq,
            time: match.event.time,
            location: match.location,
            prompt: { ...header2.prompt, system: "" }
          }
        };
      }
      if (node === void 0 || node.text === prior?.effective?.text || state.introduced !== void 0 && !state.introduced.update) {
        return { ...state, ...prior?.header === void 0 ? {} : { header: prior.header } };
      }
      const header = reader.previous("trajectory-request-header")?.state;
      const systemHeader = prior?.header;
      const previous = systemHeader !== void 0 && (header === void 0 || systemHeader.seq > header.seq) ? systemHeader : header;
      if (previous === void 0) return state;
      return {
        ...state,
        header: {
          seq: node.seq,
          time: node.time,
          prompt: { ...previous.prompt, system: node.text },
          change: { seq: node.seq, time: node.time, kind: "system", previous: previous.prompt },
          location: match.location
        }
      };
    },
    update: (context) => context.state,
    buildViewNode: (context) => {
      const state = context.state;
      if (state?.header !== void 0 && state.header.seq === context.start?.event.seq) {
        return trajectoryNode(context, state.header.seq, { kind: "request-header", header: state.header });
      }
      const prompt = state?.introduced;
      return prompt !== void 0 && prompt.text !== "" && context.start?.event.type === "system/message" && context.start.event.surfaceOp === "append" ? trajectoryNode(context, prompt.seq, { kind: "system-prompt", prompt }) : null;
    }
  };
}
function trajectoryRequestHeaderDefinition(inspect) {
  return {
    kind: "trajectory-request-header",
    target: "trajectory",
    match: (event) => event.type === "request/header" ? { id: String(event.seq), role: "start" } : null,
    start: (_context, match, reader) => {
      if (match.event.type !== "request/header") {
        throw new Error("trajectory-request-header start requires request/header");
      }
      const header = reader.previous("trajectory-request-header")?.state;
      const state = reader.previous("trajectory-system-message")?.state;
      const systemHeader = state?.header;
      const previous = systemHeader !== void 0 && (header === void 0 || systemHeader.seq > header.seq) ? systemHeader.prompt : header?.prompt;
      const system = state?.effective;
      const inspection = inspect(previous, match.event, system);
      const { prompt } = inspection;
      const change = inspection.change ?? (systemHeader !== void 0 && (header === void 0 || systemHeader.seq > header.seq) ? systemHeader.change : void 0);
      return {
        seq: match.event.seq,
        time: match.event.time,
        prompt,
        location: match.location,
        ...change === void 0 ? {} : { change }
      };
    },
    update: (context) => context.state,
    buildViewNode: (context) => context.state === void 0 ? null : trajectoryNode(context, context.state.seq, {
      kind: "request-header",
      header: context.state
    })
  };
}
function registerTrajectoryRequestHeaderDefinition(ctx) {
  ctx.uiConversation.events.register(trajectorySystemMessageDefinition(
    (previous, event) => ctx.uiConversation.inspectSystemPrompt(previous, event)
  ));
  ctx.uiConversation.events.register(trajectoryRequestHeaderDefinition(
    (previous, event, system) => ctx.uiConversation.inspectRequestPrompt(previous, event, system)
  ));
}

// deepseek-harness/packages/llm/llm/src/assistant-stream.ts
function safeTime(value) {
  if (!Number.isSafeInteger(value)) throw new TypeError(`Assistant stream time must be a safe integer, got ${String(value)}`);
  return value;
}
function safeIndex(value, label) {
  if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) {
    throw new TypeError(`${label} index must be a non-negative safe integer`);
  }
  return value;
}
function snapshotChunk(chunk) {
  const snapshot = snapshotJsonValue(chunk);
  if (snapshot === void 0) throw new TypeError("Assistant stream chunk must be losslessly JSON-serializable");
  return snapshot;
}
function expandAssistantStream(stream) {
  const chunks = [];
  for (const candidate of stream) {
    const record = validateRecord(candidate);
    if (record.type === "chunk") {
      chunks.push({ time: record.time, chunk: record.chunk });
      continue;
    }
    const members = record.type === "tool-call-chunks" ? record.args : record.texts;
    let time = record.time0;
    for (let index = 0; index < members.length; index += 1) {
      if (index > 0) time += record.dt[index - 1];
      let chunk;
      if (record.type === "text-chunks") {
        chunk = { type: "text-delta", index: record.index, text: members[index] };
      } else if (record.type === "reasoning-chunks") {
        chunk = { type: "reasoning-delta", index: record.index, text: members[index] };
      } else {
        chunk = {
          type: "tool-call-delta",
          index: record.index,
          id: record.id,
          ...Object.hasOwn(record, "name") ? { name: record.name } : {},
          argumentsDelta: members[index]
        };
      }
      chunks.push({ time, chunk });
    }
  }
  return chunks;
}
function isTokenDelta2(chunk) {
  switch (chunk.type) {
    case "text-delta":
    case "reasoning-delta":
      return chunk.text !== "";
    case "tool-call-delta":
      return chunk.argumentsDelta !== "" || chunk.name !== void 0;
    default:
      return false;
  }
}
function firstRunMemberTime(run, predicate) {
  const fragments = run.type === "tool-call-chunks" ? run.args : run.texts;
  let time = run.time0;
  for (let index = 0; index < fragments.length; index += 1) {
    if (index > 0) time += run.dt[index - 1];
    if (predicate(fragments[index])) return time;
  }
  return void 0;
}
function runFirstTokenTime(run) {
  if (run.type === "tool-call-chunks" && run.name !== void 0) return run.time0;
  return firstRunMemberTime(run, (fragment) => fragment !== "");
}
function assistantStreamFirstTokenTime(stream) {
  for (const record of stream) {
    const time = record.type === "chunk" ? isTokenDelta2(record.chunk) ? record.time : void 0 : runFirstTokenTime(record);
    if (time !== void 0) return time;
  }
  return void 0;
}
function validateRecord(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Assistant stream record must be an object");
  }
  const record = value;
  switch (record.type) {
    case "text-chunks":
    case "reasoning-chunks": {
      exactKeys(record, ["type", "time0", "index", "dt", "texts"], record.type);
      const texts = stringArray(record.texts, `${record.type} texts`);
      if (texts.length === 0) throw new TypeError(`${record.type} texts must be non-empty`);
      validateRun(record, texts.length, record.type);
      return record;
    }
    case "tool-call-chunks": {
      const keys = Object.hasOwn(record, "name") ? ["type", "time0", "index", "dt", "id", "name", "args"] : ["type", "time0", "index", "dt", "id", "args"];
      exactKeys(record, keys, record.type);
      const args = stringArray(record.args, "tool-call-chunks args");
      if (args.length === 0) throw new TypeError("tool-call-chunks args must be non-empty");
      if (typeof record.id !== "string" || record.id.length === 0) {
        throw new TypeError("tool-call-chunks id must be a non-empty string");
      }
      if (record.name !== void 0 && (typeof record.name !== "string" || record.name.length === 0)) {
        throw new TypeError("tool-call-chunks name must be a non-empty string");
      }
      validateRun(record, args.length, record.type);
      return record;
    }
    case "chunk": {
      exactKeys(record, ["type", "time", "chunk"], "chunk");
      const time = safeTime(record.time);
      if (typeof record.chunk !== "object" || record.chunk === null || Array.isArray(record.chunk)) {
        throw new TypeError("Assistant stream raw chunk must be a lossless JSON object");
      }
      let chunk;
      try {
        chunk = snapshotChunk(record.chunk);
      } catch (error) {
        throw new TypeError("Assistant stream raw chunk must be a lossless JSON object", { cause: error });
      }
      return deepFreeze({ type: "chunk", time, chunk });
    }
    default:
      throw new TypeError(`Unsupported Assistant stream record ${JSON.stringify(record.type)}`);
  }
}
function validateRun(record, members, label) {
  safeTime(record.time0);
  safeIndex(record.index, label);
  if (!Array.isArray(record.dt) || record.dt.some((value) => !Number.isSafeInteger(value))) {
    throw new TypeError(`${label} dt must contain safe integers`);
  }
  if (record.dt.length !== members - 1) {
    throw new TypeError(`${label} dt length must be one less than its members`);
  }
  let time = record.time0;
  for (const gap of record.dt) {
    time += gap;
    if (!Number.isSafeInteger(time)) throw new TypeError(`${label} member times must stay safe integers`);
  }
}
function stringArray(value, label) {
  if (!Array.isArray(value) || value.some((member) => typeof member !== "string")) {
    throw new TypeError(`${label} must be a string array`);
  }
  return value;
}
function exactKeys(record, keys, label) {
  if (Object.keys(record).length !== keys.length || !keys.every((key) => Object.hasOwn(record, key))) {
    throw new TypeError(`${label} Assistant stream record must contain exactly ${keys.join(", ")}`);
  }
}

// deepseek-harness/packages/client/ui-trajectory/src/client/trajectory-assistant-definition.ts
function initialState(turn, step, startSeq2, startTime, started) {
  return {
    turn,
    step,
    startSeq: startSeq2,
    startTime,
    started,
    blocks: [],
    visibleBlocks: 0,
    firstVisibleSeq: void 0,
    firstVisibleTime: void 0,
    firstTokenTime: void 0,
    final: void 0,
    usage: void 0,
    retry: void 0,
    stepEnd: void 0
  };
}
function compactBlocks(blocks) {
  return blocks.filter((block) => block !== void 0);
}
function blockIsVisible(block) {
  if (block === void 0 || block.kind === "tool-call") return false;
  if (block.kind === "text" || block.kind === "reasoning") return block.text.trim() !== "";
  return true;
}
function countVisibleBlocks(blocks) {
  let count = 0;
  for (const block of blocks) if (blockIsVisible(block)) count++;
  return count;
}
function hasInterruptionEvidence(blocks) {
  return blocks.some((block) => {
    if (block.kind === "text" || block.kind === "reasoning") return block.text.trim() !== "";
    return true;
  });
}
function addUsage(current2, next) {
  return {
    inputTokens: (current2?.inputTokens ?? 0) + next.inputTokens,
    outputTokens: (current2?.outputTokens ?? 0) + next.outputTokens,
    ...current2?.cacheReadTokens === void 0 && next.cacheReadTokens === void 0 ? {} : { cacheReadTokens: (current2?.cacheReadTokens ?? 0) + (next.cacheReadTokens ?? 0) },
    ...current2?.cacheWriteTokens === void 0 && next.cacheWriteTokens === void 0 ? {} : { cacheWriteTokens: (current2?.cacheWriteTokens ?? 0) + (next.cacheWriteTokens ?? 0) },
    ...current2?.reasoningTokens === void 0 && next.reasoningTokens === void 0 ? {} : { reasoningTokens: (current2?.reasoningTokens ?? 0) + (next.reasoningTokens ?? 0) }
  };
}
function updateChunk(state, chunk, seq, time) {
  if (chunk.type === "usage") {
    return { ...state, usage: addUsage(state.usage, chunk.usage) };
  }
  const blocks = [...state.blocks];
  let changedIndex = -1;
  let previousVisible = false;
  switch (chunk.type) {
    case "block-start":
      changedIndex = chunk.index;
      previousVisible = blockIsVisible(blocks[chunk.index]);
      blocks[chunk.index] = emptyAssistantBlock(chunk.blockType);
      break;
    case "text-delta": {
      const previous = blocks[chunk.index];
      changedIndex = chunk.index;
      previousVisible = blockIsVisible(previous);
      blocks[chunk.index] = {
        kind: "text",
        text: (previous?.kind === "text" ? previous.text : "") + chunk.text
      };
      break;
    }
    case "reasoning-delta": {
      const previous = blocks[chunk.index];
      changedIndex = chunk.index;
      previousVisible = blockIsVisible(previous);
      blocks[chunk.index] = {
        kind: "reasoning",
        text: (previous?.kind === "reasoning" ? previous.text : "") + chunk.text
      };
      break;
    }
    case "tool-call-delta": {
      const previous = blocks[chunk.index];
      changedIndex = chunk.index;
      previousVisible = blockIsVisible(previous);
      const base = previous?.kind === "tool-call" ? previous : { kind: "tool-call", callId: "", name: "", argsRaw: "" };
      blocks[chunk.index] = {
        kind: "tool-call",
        callId: base.callId || String(chunk.id),
        name: chunk.name ?? base.name,
        argsRaw: base.argsRaw + chunk.argumentsDelta
      };
      break;
    }
    case "block-end":
      changedIndex = chunk.index;
      previousVisible = blockIsVisible(blocks[chunk.index]);
      blocks[chunk.index] = toAssistantBlock(chunk.block);
      break;
    default:
      return state;
  }
  const visibleBlocks = state.visibleBlocks - Number(previousVisible) + Number(blockIsVisible(blocks[changedIndex]));
  return {
    ...state,
    blocks,
    visibleBlocks,
    ...visibleBlocks > 0 && state.firstVisibleSeq === void 0 ? { firstVisibleSeq: seq, firstVisibleTime: time } : {},
    ...isTokenDelta(chunk) && state.firstTokenTime === void 0 ? { firstTokenTime: time } : {}
  };
}
function settleTiming(state, event) {
  return {
    ...state,
    firstTokenTime: state.firstTokenTime ?? assistantStreamFirstTokenTime(event.data.stream)
  };
}
function settleMessage(state, match, event) {
  const blocks = toAssistantBlocks(event.data.message.content);
  return {
    ...settleTiming(state, event),
    blocks,
    visibleBlocks: countVisibleBlocks(blocks),
    final: match,
    usage: event.data.usage
  };
}
function closedBoundary(context) {
  if (context.state?.stepEnd?.event.type === "step/end") return context.state.stepEnd.event;
  const location = context.start?.location ?? context.matches.at(-1)?.location;
  if (location?.kind === "step" && location.step.status === "closed") return location.step.end;
  if ((location?.kind === "step" || location?.kind === "turn") && location.turn.status === "closed") return location.turn.end;
  return void 0;
}
function fallbackState(context) {
  let state;
  for (const match of context.matches) {
    const event = match.event;
    if (event.type === "assistant/live-chunk") {
      state ??= initialState(event.data.turn, event.data.step, event.seq, event.time, false);
      state = updateChunk(state, event.data.chunk, event.seq, event.time);
    } else if (event.type === "assistant/attempt") {
      state ??= initialState(event.data.turn, event.data.step, event.seq, event.time, false);
      state = settleTiming(state, event);
    } else if (event.type === "assistant/message") {
      state ??= initialState(event.data.turn, event.data.step, event.seq, event.time, false);
      state = settleMessage(state, match, event);
    } else if (event.type === "step/end" && state !== void 0) {
      state = { ...state, stepEnd: match };
    }
  }
  return state;
}
function finalNode(state, context) {
  const final = state.final;
  if (final?.event.type === "assistant/message") {
    const event = final.event;
    return {
      kind: "assistant",
      seq: event.seq,
      messageId: event.data.message.id,
      time: event.time,
      turn: state.turn,
      step: state.step,
      blocks: toAssistantBlocks(event.data.message.content),
      usage: event.data.usage,
      providerMetadata: {
        provider: event.data.message.source.provider,
        model: event.data.message.source.model
      },
      timing: {
        stepStartTime: state.started ? state.startTime : null,
        firstTokenTime: state.firstTokenTime ?? null,
        completedTime: event.time
      },
      ...event.data.interrupted === true ? { interrupted: true } : {}
    };
  }
  const boundary = closedBoundary(context);
  if (boundary === void 0) return void 0;
  const blocks = compactBlocks(state.blocks);
  if (!hasInterruptionEvidence(blocks)) return void 0;
  return {
    kind: "assistant",
    seq: boundary.seq - 0.9,
    time: boundary.time,
    turn: state.turn,
    step: state.step,
    blocks,
    interrupted: true
  };
}
function assistantRequest(state, node, boundary) {
  if (!state.started) return void 0;
  const status = node !== void 0 ? node.interrupted === true ? "error" : "complete" : boundary !== void 0 ? "error" : "running";
  return {
    purpose: "assistant",
    startSeq: state.startSeq,
    turn: state.turn,
    step: state.step,
    startedAt: state.startTime,
    completedAt: node?.time ?? boundary?.time ?? null,
    status,
    ...state.retry === void 0 ? {} : {
      error: state.retry.message,
      ...state.retry.code === void 0 ? {} : { errorCode: state.retry.code },
      retry: state.retry.retry,
      ...state.retry.maxRetries === void 0 ? {} : { maxRetries: state.retry.maxRetries },
      retryDelayMs: state.retry.delayMs
    },
    ...node?.messageId === void 0 ? {} : {
      resultSeq: node.seq,
      ...node.providerMetadata === void 0 ? {} : { providerMetadata: node.providerMetadata }
    },
    ...state.usage === void 0 ? {} : { usage: state.usage }
  };
}
var trajectoryAssistantDefinition = {
  kind: "trajectory-assistant-step",
  target: "trajectory",
  match: (event) => {
    if (event.type === "step/start") {
      return { id: `${event.data.turn}:${event.data.step}`, role: "start" };
    }
    if (event.type === "assistant/live-chunk" || event.type === "assistant/message" || event.type === "assistant/attempt" || event.type === "llm/retry" || event.type === "step/end") {
      return { id: `${event.data.turn}:${event.data.step}`, role: "update" };
    }
    return null;
  },
  start: (_context, match) => {
    if (match.event.type !== "step/start") {
      throw new Error("trajectory-assistant-step start requires step/start");
    }
    return initialState(
      match.event.data.turn,
      match.event.data.step,
      match.event.seq,
      match.event.time,
      true
    );
  },
  update: (context, match) => {
    if (match.event.type === "assistant/live-chunk") {
      return updateChunk(context.state, match.event.data.chunk, match.event.seq, match.event.time);
    }
    if (match.event.type === "assistant/message") return settleMessage(context.state, match, match.event);
    if (match.event.type === "assistant/attempt") return settleTiming(context.state, match.event);
    if (match.event.type === "step/end") return { ...context.state, stepEnd: match };
    if (match.event.type !== "llm/retry") return context.state;
    const data = match.event.data;
    const failure = displayFailure(data.failure);
    return {
      ...initialState(
        context.state.turn,
        context.state.step,
        context.state.startSeq,
        context.state.startTime,
        true
      ),
      firstTokenTime: context.state.firstTokenTime,
      usage: context.state.usage,
      retry: {
        message: failure.message,
        ...failure.code === void 0 ? {} : { code: failure.code },
        retry: data.retry,
        ...data.mode === "normal" ? { maxRetries: data.maxRetries } : {},
        delayMs: data.delayMs
      }
    };
  },
  publication: (match) => {
    if (match.event.type === "step/start" || match.event.type === "assistant/attempt") return "none";
    if (match.event.type !== "assistant/live-chunk") return "immediate";
    const type = match.event.data.chunk.type;
    return type === "usage" || type === "finish" ? "none" : "animation-frame";
  },
  buildViewNode: (context) => {
    const state = context.state ?? fallbackState(context);
    if (state === void 0) return null;
    const node = finalNode(state, context);
    const boundary = closedBoundary(context);
    const partial = node === void 0 && boundary === void 0 && state.blocks.length > 0 ? {
      turn: state.turn,
      step: state.step,
      blocks: compactBlocks(state.blocks),
      timing: {
        stepStartTime: state.started ? state.startTime : null,
        firstTokenTime: state.firstTokenTime ?? null
      }
    } : null;
    const request = assistantRequest(state, node, boundary);
    if (node === void 0 && partial === null && request === void 0) return null;
    return trajectoryNode(context, state.startSeq, {
      kind: "assistant",
      ...node === void 0 ? {} : { node },
      partial,
      ...request === void 0 ? {} : { request }
    });
  }
};
var trajectoryTurnEndDefinition = {
  kind: "trajectory-turn-end",
  target: "trajectory",
  match: (event) => event.type === "turn/end" ? { id: String(event.seq), role: "start" } : null,
  start: (_context, match) => {
    if (match.event.type !== "turn/end") {
      throw new Error("trajectory-turn-end start requires turn/end");
    }
    const reason = match.event.data.reason;
    const failure = reason.kind === "error" ? displayFailure(reason.error) : void 0;
    return {
      turn: match.event.data.turn,
      seq: match.event.seq,
      time: match.event.time,
      ...failure === void 0 ? {} : {
        error: failure.message,
        ...failure.code === void 0 ? {} : { errorCode: failure.code }
      }
    };
  },
  update: (context) => context.state,
  buildViewNode: (context) => context.state === void 0 ? null : trajectoryNode(context, context.state.seq, {
    kind: "turn-end",
    turn: context.state.turn,
    time: context.state.time,
    ...context.state.error === void 0 ? {} : { error: context.state.error },
    ...context.state.errorCode === void 0 ? {} : { errorCode: context.state.errorCode }
  })
};
function registerTrajectoryAssistantDefinition(ctx) {
  ctx.uiConversation.events.register(trajectoryAssistantDefinition);
  ctx.uiConversation.events.register(trajectoryTurnEndDefinition);
}

// deepseek-harness/packages/client/ui-trajectory/src/client/trajectory-tool-definition.ts
var MAX_DEPTH = 256;
function rootCall(match) {
  if (match.event.type !== "tool/call") {
    throw new Error("trajectory-tool-call start requires tool/call");
  }
  return {
    phase: "start",
    callId: String(match.event.data.callId),
    name: match.event.data.name,
    argsRaw: match.event.data.arguments,
    args: PartialArguments.fromText(match.event.data.arguments),
    turn: match.event.data.turn,
    step: match.event.data.step,
    time: match.event.time,
    subCalls: []
  };
}
function rootResult(match, previous) {
  if (match.event.type !== "tool/result") return void 0;
  const message = match.event.data.message;
  return {
    kind: "tool-result",
    seq: match.event.seq,
    time: match.event.time,
    callId: String(message.source.callId),
    name: previous?.name ?? "",
    args: previous?.args ?? PartialArguments.EMPTY,
    call: previous === void 0 ? null : { name: previous.name, argsRaw: previous.argsRaw },
    callTime: previous?.time ?? null,
    content: message.content,
    isError: message.isError === true,
    ...match.event.data.error === void 0 ? {} : { error: match.event.data.error },
    meta: match.event.data.meta,
    subCalls: []
  };
}
function locationTurn(match) {
  return match.location.kind === "step" || match.location.kind === "turn" ? match.location.turn.turn : 0;
}
function locationStep(match) {
  return match.location.kind === "step" ? match.location.step.step : 0;
}
function childCall(match, data) {
  return {
    phase: "start",
    callId: data.subCallId,
    parentCallId: data.parentCallId,
    name: data.name,
    argsRaw: JSON.stringify(data.arguments),
    args: PartialArguments.fromObject(data.arguments),
    turn: locationTurn(match),
    step: locationStep(match),
    time: match.event.time,
    subCalls: []
  };
}
function childResult(match, data, previous) {
  return {
    kind: "tool-result",
    seq: match.event.seq,
    time: match.event.time,
    callId: data.subCallId,
    parentCallId: data.parentCallId,
    name: data.name,
    args: previous?.args ?? PartialArguments.fromObject(data.arguments),
    call: { name: data.name, argsRaw: JSON.stringify(data.arguments) },
    callTime: previous === void 0 || "kind" in previous ? null : previous.time,
    content: data.content ?? [],
    meta: data.meta,
    isError: data.isError === true,
    ...data.error === void 0 ? {} : { error: data.error },
    subCalls: []
  };
}
function acceptsEdge(state, parent, child) {
  if (parent === child || state.parents.has(child)) return false;
  let cursor = parent;
  let parentDepth = 0;
  const ancestors = /* @__PURE__ */ new Set();
  while (cursor !== void 0) {
    if (cursor === child || ancestors.has(cursor)) return false;
    ancestors.add(cursor);
    parentDepth++;
    cursor = state.parents.get(cursor);
  }
  const pending = [{ callId: child, depth: 1 }];
  const descendants = /* @__PURE__ */ new Set();
  let subtreeDepth = 0;
  for (const candidate of pending) {
    if (descendants.has(candidate.callId)) return false;
    descendants.add(candidate.callId);
    subtreeDepth = Math.max(subtreeDepth, candidate.depth);
    for (const nested of state.children.get(candidate.callId) ?? []) {
      pending.push({ callId: nested, depth: candidate.depth + 1 });
    }
  }
  return parentDepth + subtreeDepth <= MAX_DEPTH;
}
function updateDispatch(state, match) {
  const event = match.event;
  if (event.type !== "tool/ptc-dispatch-start" && event.type !== "tool/ptc-dispatch") return state;
  const data = event.data;
  const parentId = String(data.parentCallId);
  const childId = String(data.subCallId);
  const siblings = state.children.get(parentId) ?? [];
  const index = siblings.indexOf(childId);
  if (index < 0 && !acceptsEdge(state, parentId, childId)) return state;
  if (event.type === "tool/ptc-dispatch-start" && index >= 0) return state;
  const calls = new Map(state.calls);
  calls.set(childId, event.type === "tool/ptc-dispatch-start" ? childCall(match, data) : childResult(match, data, calls.get(childId)));
  if (index >= 0) return { ...state, calls };
  const children = new Map(state.children);
  children.set(parentId, [...siblings, childId]);
  const parents = new Map(state.parents);
  parents.set(childId, parentId);
  return { ...state, calls, children, parents };
}
function interruption(context) {
  const location = context.start?.location;
  if (location?.kind === "step" && location.step.status === "closed") return location.step.end;
  if ((location?.kind === "step" || location?.kind === "turn") && location.turn.status === "closed") return location.turn.end;
  return void 0;
}
function projectCall(state, callId, interruptedAt, visited = /* @__PURE__ */ new Set(), depth = 1) {
  const block = state.calls.get(callId);
  if (block === void 0) return void 0;
  if (visited.has(callId) || depth > MAX_DEPTH) return { ...block, subCalls: [] };
  const nextVisited = new Set(visited);
  nextVisited.add(callId);
  const subCalls = (state.children.get(callId) ?? []).flatMap((childId) => {
    const child = projectCall(state, childId, interruptedAt, nextVisited, depth + 1);
    return child === void 0 ? [] : [child];
  });
  if ("kind" in block || interruptedAt === void 0) return { ...block, subCalls };
  return {
    kind: "tool-result",
    seq: interruptedAt.seq - 0.8,
    time: interruptedAt.time,
    callId: block.callId,
    ...block.parentCallId === void 0 ? {} : { parentCallId: block.parentCallId },
    name: block.name,
    args: block.args,
    call: { name: block.name, argsRaw: block.argsRaw },
    callTime: block.time,
    content: [],
    isError: true,
    error: { name: "Interrupted", code: "interrupted" },
    subCalls
  };
}
function fallbackState2(context) {
  const resultMatch = context.matches.find((match) => match.event.type === "tool/result");
  const root = resultMatch === void 0 ? void 0 : rootResult(resultMatch);
  if (root === void 0) return void 0;
  let state = {
    rootId: root.callId,
    calls: /* @__PURE__ */ new Map([[root.callId, root]]),
    children: /* @__PURE__ */ new Map(),
    parents: /* @__PURE__ */ new Map()
  };
  for (const match of context.matches) state = updateDispatch(state, match);
  return state;
}
var trajectoryToolDefinition = {
  kind: "trajectory-tool-call",
  target: "trajectory",
  match: (event) => {
    if (event.type === "tool/call") return { id: String(event.data.callId), role: "start" };
    if (event.type === "tool/result") {
      return { id: String(event.data.message.source.callId), role: "update" };
    }
    if (event.type === "tool/ptc-dispatch-start" || event.type === "tool/ptc-dispatch") {
      const rootCallId = event.data.rootCallId;
      return typeof rootCallId === "string" && rootCallId !== "" ? { id: rootCallId, role: "update" } : null;
    }
    return null;
  },
  start: (_context, match) => {
    const root = rootCall(match);
    return {
      rootId: root.callId,
      calls: /* @__PURE__ */ new Map([[root.callId, root]]),
      children: /* @__PURE__ */ new Map(),
      parents: /* @__PURE__ */ new Map()
    };
  },
  update: (context, match) => {
    if (match.event.type !== "tool/result") return updateDispatch(context.state, match);
    const previous = context.state.calls.get(context.state.rootId);
    const running = previous !== void 0 && !("kind" in previous) ? previous : void 0;
    const result = rootResult(match, running);
    if (result === void 0) return context.state;
    const calls = new Map(context.state.calls);
    calls.set(context.state.rootId, result);
    return { ...context.state, calls };
  },
  buildViewNode: (context) => {
    const state = context.state ?? fallbackState2(context);
    if (state === void 0) return null;
    const root = projectCall(state, state.rootId, interruption(context));
    if (root === void 0) return null;
    const anchorSeq = context.start?.event.seq ?? ("kind" in root ? root.seq : context.matches[0]?.event.seq ?? 0);
    return trajectoryNode(context, anchorSeq, { kind: "tool", root });
  }
};
function registerTrajectoryToolDefinition(ctx) {
  ctx.uiConversation.events.register(trajectoryToolDefinition);
}

// deepseek-harness/packages/client/ui-trajectory/src/client/trajectory-compaction-definition.ts
function checkpointId(event) {
  if (event.type !== "user/message") return void 0;
  const source = event.data.source;
  return source.kind === "compact-checkpoint" && typeof source.compactionId === "string" && source.compactionId !== "" ? source.compactionId : void 0;
}
function eventCompactionId(event) {
  if (event.type !== "compaction/start" && event.type !== "compaction/summary" && event.type !== "compaction/end") return void 0;
  const value = event.data.compactionId;
  return typeof value === "string" && value !== "" ? value : void 0;
}
function requestFromState(state) {
  const start = state.start.event;
  if (start.type !== "compaction/start") return void 0;
  const summary = state.summary?.event;
  const end = state.end?.event;
  const checkpoint = state.checkpoint?.event;
  return {
    purpose: "compaction",
    startSeq: start.seq,
    turn: start.data.turn,
    step: 0,
    startedAt: start.time,
    completedAt: end?.type === "compaction/end" ? end.time : null,
    status: end?.type !== "compaction/end" ? "running" : end.data.error === void 0 ? "complete" : "error",
    ...end?.type === "compaction/end" && end.data.error !== void 0 ? { error: end.data.error } : {},
    ...summary?.type !== "compaction/summary" ? {} : {
      resultSeq: summary.seq,
      summary: summary.data.summary,
      ...summary.data.rawOutput === void 0 ? {} : { rawOutput: summary.data.rawOutput },
      providerMetadata: { provider: summary.data.provider, model: summary.data.model },
      requestConfig: {
        provider: summary.data.provider,
        model: summary.data.model,
        purpose: "compaction",
        ...summary.data.maxTokens === void 0 ? {} : { maxTokens: summary.data.maxTokens }
      },
      ...summary.data.usage === void 0 ? {} : { usage: summary.data.usage }
    },
    ...checkpoint?.type === "user/message" ? { replacementSeq: checkpoint.seq } : {}
  };
}
var trajectoryCompactionDefinition = {
  kind: "trajectory-compaction",
  target: "trajectory",
  match: (event) => {
    const compactId = eventCompactionId(event);
    if (compactId !== void 0) {
      return { id: compactId, role: event.type === "compaction/start" ? "start" : "update" };
    }
    const checkpoint = checkpointId(event);
    return checkpoint === void 0 ? null : { id: checkpoint, role: "update" };
  },
  start: (_context, match) => {
    if (match.event.type !== "compaction/start") {
      throw new Error("trajectory-compaction start requires compaction/start");
    }
    return { start: match };
  },
  update: (context, match) => {
    if (match.event.type === "compaction/summary") return { ...context.state, summary: match };
    if (match.event.type === "compaction/end") return { ...context.state, end: match };
    return checkpointId(match.event) === void 0 ? context.state : { ...context.state, checkpoint: match };
  },
  buildViewNode: (context) => {
    if (context.state === void 0) return null;
    const request = requestFromState(context.state);
    return request === void 0 ? null : trajectoryNode(context, request.startSeq, { kind: "compaction", request });
  }
};
var trajectorySessionEndDefinition = {
  kind: "trajectory-session-end",
  target: "trajectory",
  match: (event) => event.type === "session/end-seed" ? { id: String(event.seq), role: "start" } : null,
  start: (_context, match) => ({ seq: match.event.seq, time: match.event.time }),
  update: (context) => context.state,
  buildViewNode: (context) => context.state === void 0 ? null : trajectoryNode(context, context.state.seq, {
    kind: "session-end",
    seq: context.state.seq,
    time: context.state.time
  })
};
function registerTrajectoryCompactionDefinitions(ctx) {
  ctx.uiConversation.events.register(trajectoryCompactionDefinition);
  ctx.uiConversation.events.register(trajectorySessionEndDefinition);
}

// deepseek-harness/packages/client/ui-trajectory/src/client/copy-codes.ts
var COMPACTION_INTERRUPTED_ERROR = "trajectory.compaction-interrupted";

// deepseek-harness/packages/client/ui-trajectory/src/client/trajectory-snapshot-builder.ts
var EMPTY_LIST = [];
var EMPTY_TRAJECTORY_SNAPSHOT = {
  eventNodes: EMPTY_LIST,
  eventLocations: /* @__PURE__ */ new Map(),
  requests: EMPTY_LIST,
  callSchemas: /* @__PURE__ */ new Map(),
  partial: null,
  runningCalls: EMPTY_LIST
};
function stepKey(turn, step) {
  return `${turn}\0${step}`;
}
function headerStepKey(header) {
  const location = header.location;
  return location.kind === "step" ? stepKey(location.turn.turn, location.step.step) : void 0;
}
function headerFor(request, headersByStep, previous) {
  return headersByStep.get(stepKey(request.turn, request.step)) ?? (previous !== void 0 && previous.seq < request.startSeq ? {
    latest: previous,
    ...previous.change === void 0 ? {} : { change: previous.change }
  } : void 0);
}
function applyHeader(request, header, includeChange) {
  return header === void 0 ? request : {
    ...request,
    prompt: header.latest.prompt,
    requestConfig: header.latest.prompt.config,
    ...includeChange && header.change !== void 0 ? { promptChange: header.change } : {}
  };
}
function withRequestConfig(node, prompt) {
  return prompt === void 0 ? node : { ...node, requestConfig: prompt.config };
}
function captureSchemas(block, toolsByName, output) {
  const name = "kind" in block ? block.call?.name : block.name;
  const schema = name === void 0 ? void 0 : toolsByName.get(name);
  if (schema !== void 0) output.set(block.callId, schema);
  for (const child of block.subCalls) captureSchemas(child, toolsByName, output);
}
function indexTools(tools) {
  return new Map(tools.map((tool) => [tool.name, tool]));
}
function interruptCompactions(requests, boundaries) {
  let nextRequest = 0;
  const runningCompactions = [];
  for (const boundary of boundaries) {
    while (nextRequest < requests.length) {
      const request2 = requests[nextRequest];
      if (request2 === void 0 || request2.startSeq >= boundary.seq) break;
      if (request2.purpose === "compaction" && request2.status === "running") {
        runningCompactions.push(nextRequest);
      }
      nextRequest++;
    }
    let index = runningCompactions.pop();
    while (index !== void 0 && requests[index]?.status !== "running") {
      index = runningCompactions.pop();
    }
    if (index === void 0) continue;
    const request = requests[index];
    if (request?.purpose !== "compaction") continue;
    requests[index] = {
      ...request,
      completedAt: boundary.time,
      status: "error",
      error: COMPACTION_INTERRUPTED_ERROR
    };
  }
}
function applyTurnErrors(requests, endings) {
  const lastAssistantByTurn = /* @__PURE__ */ new Map();
  for (const [index, request] of requests.entries()) {
    if (request.purpose === "assistant") lastAssistantByTurn.set(request.turn, index);
  }
  for (const ending of endings) {
    if (ending.error === void 0) continue;
    const index = lastAssistantByTurn.get(ending.turn);
    if (index === void 0) continue;
    const request = requests[index];
    if (request?.purpose !== "assistant") continue;
    requests[index] = {
      ...request,
      completedAt: request.completedAt ?? ending.time,
      status: "error",
      error: ending.error,
      ...ending.errorCode === void 0 ? {} : { errorCode: ending.errorCode }
    };
  }
}
var TrajectorySnapshotBuilder = class {
  nodes = /* @__PURE__ */ new Map();
  positions = /* @__PURE__ */ new Map();
  contributions = [];
  empty = EMPTY_TRAJECTORY_SNAPSHOT;
  replace(input) {
    this.nodes.clear();
    for (const node of input.nodes) this.nodes.set(node.key, node);
    this.rebuildContributions();
    return this.snapshot();
  }
  apply(input) {
    let structural = false;
    for (const node of input.upserts) {
      const previous = this.nodes.get(node.key);
      this.nodes.set(node.key, node);
      if (previous === void 0 || previous.anchorSeq !== node.anchorSeq) {
        structural = true;
        continue;
      }
      const position = this.positions.get(node.key);
      if (position === void 0) structural = true;
      else this.contributions[position] = node;
    }
    if (structural) this.rebuildContributions();
    return this.snapshot();
  }
  snapshot() {
    const headersByStep = /* @__PURE__ */ new Map();
    for (const contribution of this.contributions) {
      if (contribution.data.kind !== "request-header") continue;
      const key = headerStepKey(contribution.data.header);
      if (key === void 0) continue;
      const previous = headersByStep.get(key);
      headersByStep.set(key, {
        latest: contribution.data.header,
        ...contribution.data.header.change !== void 0 ? { change: contribution.data.header.change } : previous?.change === void 0 ? {} : { change: previous.change }
      });
    }
    const representedPrompts = new Set(this.contributions.flatMap((node) => node.data.kind === "request-header" && node.data.header.change !== void 0 ? [node.data.header.change.seq] : []));
    const systemPrompts = [];
    const finalized = [];
    const eventLocations = /* @__PURE__ */ new Map();
    const requests = [];
    const boundaries = [];
    const turnEndings = [];
    const callSchemas = /* @__PURE__ */ new Map();
    const consumedPromptChanges = /* @__PURE__ */ new Set();
    let previousHeader;
    let previousTools = /* @__PURE__ */ new Map();
    let partial = null;
    const runningCalls = [];
    for (const contribution of this.contributions) {
      const data = contribution.data;
      if (data.kind === "system-prompt") {
        if (!representedPrompts.has(data.prompt.seq)) systemPrompts.push(data.prompt);
        continue;
      }
      if (data.kind === "request-header") {
        previousHeader = data.header;
        previousTools = indexTools(data.header.prompt.tools);
        continue;
      }
      if (data.kind === "node") {
        finalized.push(data.node);
        eventLocations.set(data.node.seq, contribution.location);
        continue;
      }
      if (data.kind === "assistant") {
        const header = data.request === void 0 ? void 0 : headerFor(data.request, headersByStep, previousHeader);
        if (data.node !== void 0) finalized.push(withRequestConfig(data.node, header?.latest.prompt));
        if (data.partial !== null) partial = data.partial;
        if (data.request !== void 0) {
          const change = header?.change;
          const includeChange = change !== void 0 && !consumedPromptChanges.has(change.seq);
          requests.push(applyHeader(data.request, header, includeChange));
          if (includeChange) consumedPromptChanges.add(change.seq);
        }
        continue;
      }
      if (data.kind === "tool") {
        if ("kind" in data.root) finalized.push(data.root);
        else runningCalls.push(data.root);
        if (previousHeader !== void 0 && previousHeader.seq < contribution.anchorSeq) {
          captureSchemas(data.root, previousTools, callSchemas);
        }
        continue;
      }
      if (data.kind === "compaction") {
        requests.push(data.request);
        continue;
      }
      if (data.kind === "session-end") {
        boundaries.push({ seq: data.seq, time: data.time });
        continue;
      }
      turnEndings.push({
        turn: data.turn,
        time: data.time,
        ...data.error === void 0 ? {} : { error: data.error },
        ...data.errorCode === void 0 ? {} : { errorCode: data.errorCode }
      });
    }
    requests.sort((left, right) => left.startSeq - right.startSeq);
    interruptCompactions(requests, boundaries);
    applyTurnErrors(requests, turnEndings);
    finalized.sort((left, right) => left.seq - right.seq);
    const eventNodes = finalized;
    return {
      eventNodes,
      ...systemPrompts.length > 0 ? { systemPrompts } : {},
      eventLocations,
      requests,
      callSchemas,
      partial,
      runningCalls
    };
  }
  rebuildContributions() {
    this.contributions = [...this.nodes.values()].sort((left, right) => left.anchorSeq - right.anchorSeq || left.key.localeCompare(right.key));
    this.positions.clear();
    for (const [index, contribution] of this.contributions.entries()) {
      this.positions.set(contribution.key, index);
    }
  }
};
var trajectoryViewDefinition = {
  target: "trajectory",
  toolCallFocus: (callId) => callId,
  create: () => new TrajectorySnapshotBuilder()
};

// deepseek-harness/packages/api/session-controller/src/client/sessions/assistant-stream.ts
var ClientAssistantStream = class {
  activeAttempt;
  retainedAttempt;
  pending = /* @__PURE__ */ new Map();
  publishedSeqs = /* @__PURE__ */ new Set();
  durableCursor = -1;
  transientInGap = 0;
  /**
   * Replace the durable Web window and adopt an optional reconnect baseline.
   * @param entries - durable entries in the replacement window.
   * @param baseline - compact prefix for an Assistant attempt that is still live.
   * @returns immediately visible durable entries plus reconstructed transient chunks.
   */
  replace(entries, baseline) {
    this.pending.clear();
    this.transientInGap = 0;
    this.activeAttempt = void 0;
    this.retainedAttempt = void 0;
    const opening = baseline?.activeAttempt;
    if (opening !== void 0) {
      this.activeAttempt = {
        attemptId: opening.attemptId,
        startedAfterSeq: opening.startedAfterSeq,
        turn: opening.turn,
        step: opening.step,
        nextIndex: opening.nextIndex
      };
    }
    const visible = [...entries];
    this.publishedSeqs = new Set(visible.map((entry) => entry.event.seq));
    this.durableCursor = visible.reduce((cursor, entry) => Math.max(cursor, entry.event.seq), -1);
    if (opening !== void 0) {
      for (const [index, member] of expandAssistantStream(
        opening.stream
      ).entries()) {
        this.transientInGap += 1;
        visible.push({
          type: "transient",
          event: {
            type: "assistant/live-chunk",
            seq: this.durableCursor + 1 - 1 / (this.transientInGap + 1),
            time: member.time,
            data: {
              attemptId: opening.attemptId,
              turn: opening.turn,
              step: opening.step,
              chunk: member.chunk
            }
          }
        });
        if (index + 1 >= opening.nextIndex) break;
      }
    }
    return visible;
  }
  /**
   * Stage one durable v2 settlement while its matching live attempt is open.
   * @param entry - newly followed durable entry.
   * @returns a publication decision, or `undefined` when no entry becomes visible.
   */
  acceptDurable(entry) {
    const event = entry.event;
    this.durableCursor = Math.max(this.durableCursor, event.seq);
    this.transientInGap = 0;
    const settlement = assistantSettlementEntry(entry);
    if (settlement !== void 0 && this.attemptForSettlement(settlement.event) !== void 0) {
      if (this.pending.has(event.seq)) return { type: "rebaseline" };
      this.pending.set(event.seq, settlement);
      return void 0;
    }
    return this.publish(entry);
  }
  /**
   * Fold one dense transient frame and release its named durable settlement.
   * Successful messages retain their transient rows until the owning Step ends;
   * interrupted messages, failed attempts, and abandonment retire them immediately.
   * @param frame - next Assistant stream frame received by the follow connection.
   * @returns a transient, publication, or rebaseline decision, or `undefined` when no entry becomes visible.
   */
  acceptFrame(frame) {
    switch (frame.type) {
      case "start":
        if (this.activeAttempt !== void 0 || this.retainedAttempt !== void 0 || this.pending.size > 0) return { type: "rebaseline" };
        this.pending.clear();
        this.activeAttempt = {
          attemptId: frame.attemptId,
          startedAfterSeq: frame.startedAfterSeq,
          turn: frame.turn,
          step: frame.step,
          nextIndex: 0
        };
        return void 0;
      case "chunk": {
        const attempt = this.activeAttempt;
        if (attempt === void 0 || attempt.attemptId !== frame.attemptId) return void 0;
        if (frame.index !== attempt.nextIndex) return { type: "rebaseline" };
        attempt.nextIndex += 1;
        this.transientInGap += 1;
        return {
          type: "transient",
          entry: {
            type: "transient",
            event: {
              type: "assistant/live-chunk",
              seq: this.durableCursor + 1 - 1 / (this.transientInGap + 1),
              time: frame.time,
              data: {
                attemptId: frame.attemptId,
                turn: attempt.turn,
                step: attempt.step,
                chunk: frame.chunk
              }
            }
          }
        };
      }
      case "end": {
        const attempt = this.activeAttempt;
        if (attempt === void 0 || attempt.attemptId !== frame.attemptId) {
          return void 0;
        }
        this.activeAttempt = void 0;
        if (frame.index !== attempt.nextIndex) return { type: "rebaseline" };
        if (frame.outcome.kind === "abandoned") {
          return this.pending.size === 0 ? { type: "abandonment", attemptId: attempt.attemptId } : { type: "rebaseline" };
        }
        if (this.publishedSeqs.has(frame.outcome.seq)) return void 0;
        const entry = this.pending.get(frame.outcome.seq);
        if (entry === void 0 || entry.event.type !== frame.outcome.eventType) {
          return { type: "rebaseline" };
        }
        this.pending.delete(frame.outcome.seq);
        if (entry.event.type === "assistant/message" && entry.event.data.interrupted !== true) {
          this.retainedAttempt = { attemptId: attempt.attemptId, turn: attempt.turn, step: attempt.step };
          return this.publish(entry);
        }
        this.publishedSeqs.add(entry.event.seq);
        return { type: "settlement", attemptId: attempt.attemptId, entry };
      }
    }
  }
  attemptForSettlement(event) {
    const attempt = this.activeAttempt;
    if (attempt === void 0 || event.type === "assistant/message" && event.surfaceOp !== "append" || event.seq <= attempt.startedAfterSeq || attempt.turn !== event.data.turn || attempt.step !== event.data.step) return void 0;
    return attempt;
  }
  publish(entry) {
    this.publishedSeqs.add(entry.event.seq);
    const retained = this.retainedAttempt;
    if (retained !== void 0 && entry.event.type === "step/end" && entry.event.data.turn === retained.turn && entry.event.data.step === retained.step) {
      this.retainedAttempt = void 0;
      return { type: "publish", entry, retireAttemptId: retained.attemptId };
    }
    return { type: "publish", entry };
  }
};
function assistantSettlementEntry(entry) {
  return entry.event.type === "assistant/message" || entry.event.type === "assistant/attempt" ? entry : void 0;
}

// desktop/compat/src/trajectory-engine.ts
var TrajectoryEngine = class {
  assembler;
  assistant = new ClientAssistantStream();
  revision = 0;
  lastDurable = -1;
  constructor() {
    const definitions = [], routes = /* @__PURE__ */ new Set();
    const events = {
      register: (input) => {
        const table = typeof input.match === "function" ? void 0 : new Map(Object.entries(input.match));
        const definition = table ? {
          ...input,
          match: (event) => table.get(event.type)?.call(definition, event) ?? null
        } : input;
        definitions.push(definition);
        routes.add({ definition, match: definition.match.bind(definition) });
        return () => {
        };
      },
      entries: () => definitions,
      fallbackEntry: () => void 0,
      forEvent: () => routes
    };
    const ctx = {
      uiConversation: { events, inspectSystemPrompt, inspectRequestPrompt }
    };
    for (const register of [
      registerTrajectoryMessageDefinitions,
      registerTrajectoryRequestHeaderDefinition,
      registerTrajectoryAssistantDefinition,
      registerTrajectoryToolDefinition,
      registerTrajectoryCompactionDefinitions
    ])
      register(ctx);
    this.assembler = new ConversationNodeAssembler(events, {
      entries: () => [trajectoryViewDefinition]
    });
    this.assembler.activateTarget("trajectory");
  }
  replace(frame) {
    this.revision = frame.assistantStream?.revision ?? 0;
    this.lastDurable = frame.cursor;
    this.assembler.replaceWindow(
      this.assistant.replace(frame.records, frame.assistantStream),
      frame.hasMore
    );
    this.assembler.flush();
    return this.snapshot();
  }
  append(frame) {
    let result;
    if (frame.type === "assistant-stream") {
      if (frame.frame.revision !== this.revision + 1)
        throw Object.assign(Error("\u8F68\u8FF9\u6D41\u6709\u7F3A\u53E3\uFF0C\u8BF7\u91CD\u65B0\u6253\u5F00\u8F68\u8FF9\u3002"), {
          code: "REBASELINE_REQUIRED"
        });
      this.revision = frame.frame.revision;
      result = this.assistant.acceptFrame(frame.frame);
    } else if (frame.type === "event") {
      if (frame.event.seq <= this.lastDurable) return this.snapshot();
      this.lastDurable = frame.event.seq;
      result = this.assistant.acceptDurable(frame);
    } else return this.snapshot();
    if (result?.type === "rebaseline")
      throw Object.assign(Error("\u8F68\u8FF9\u6D41\u6709\u7F3A\u53E3\uFF0C\u8BF7\u91CD\u65B0\u6253\u5F00\u8F68\u8FF9\u3002"), {
        code: "REBASELINE_REQUIRED"
      });
    if (result?.type === "publish") {
      this.assembler.append(result.entry);
      if (result.retireAttemptId)
        this.assembler.settleAssistant(result.retireAttemptId);
    }
    if (result?.type === "transient") this.assembler.append(result.entry);
    if (result?.type === "settlement")
      this.assembler.settleAssistant(result.attemptId, result.entry);
    if (result?.type === "abandonment")
      this.assembler.settleAssistant(result.attemptId);
    this.assembler.flush();
    return this.snapshot();
  }
  prepend(records, hasMore) {
    this.assembler.prepend(records, hasMore);
    this.assembler.flush();
    return this.snapshot();
  }
  snapshot() {
    return this.assembler.snapshot("trajectory") ?? EMPTY_TRAJECTORY_SNAPSHOT;
  }
};
export {
  TrajectoryEngine
};
