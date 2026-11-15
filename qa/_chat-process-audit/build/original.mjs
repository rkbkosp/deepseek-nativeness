// ../deepseek-harness/packages/client/ui-conversation/src/client/contract/conversation.ts
function conversationContextKey(kind, id) {
  return `${kind.length}:${kind}${id}`;
}

// compat/node_modules/zustand/esm/vanilla.mjs
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

// compat/node_modules/zustand/esm/middleware.mjs
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

// compat/node_modules/immer/dist/immer.mjs
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

// ../deepseek-harness/packages/client/store/src/index.ts
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

// ../deepseek-harness/packages/util/values/src/partial-json.ts
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

// ../deepseek-harness/packages/util/values/src/index.ts
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

// ../deepseek-harness/packages/client/ui-conversation/src/client/conversation/group-store.ts
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
  prepareAndInstall(update, readNode2) {
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
      if (readNode2(reference.key) === void 0) {
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

// ../deepseek-harness/packages/client/ui-conversation/src/client/conversation/location-index.ts
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

// ../deepseek-harness/packages/client/ui-conversation/src/client/conversation/assembler.ts
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

// ../deepseek-harness/packages/client/ui-chat/src/client/conversation-nodes/common.ts
var CHAT_SYNTHETIC_SEQ_OFFSETS = {
  interruptedAssistant: -0.9,
  interruptedFollowup: -0.8,
  processControl: -0.1,
  maxTokensNotice: 0.05,
  finalizedFollowup: 0.1
};
function contextLocation(context) {
  return context.start?.location ?? context.matches[0]?.location ?? { kind: "unresolved" };
}
function locationCoordinates(location) {
  if (location.kind === "step") return { turn: location.turn.turn, step: location.step.step };
  if (location.kind === "turn") return { turn: location.turn.turn };
  return {};
}
function chatNode(context, kind, anchorSeq, data, options = {}) {
  return {
    key: context.key,
    kind,
    id: context.id,
    target: "chat",
    anchorSeq,
    location: options.location ?? contextLocation(context),
    visibility: options.visibility ?? "visible",
    groupTree: options.groupTree,
    data
  };
}

// ../deepseek-harness/packages/client/ui-chat/src/client/conversation-nodes/event-projection.ts
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
function sessionRecallLabels(source) {
  const record = asRecord(source);
  if (record === null || readString(record, "kind") !== "session-reference") return [];
  return collect(record, "references", "label");
}
function skillInvocationName(source) {
  const record = asRecord(source);
  if (record === null || readString(record, "kind") !== "skill-invocation") return null;
  return readString(record, "name");
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

// ../deepseek-harness/packages/client/ui-chat/src/client/conversation-nodes/assistant.ts
function initialState(turn, step) {
  return {
    turn,
    step,
    blocks: [],
    visibleByIndex: [],
    visibleBlocks: 0,
    firstVisibleSeq: void 0,
    firstVisibleTime: void 0,
    firstTokenTime: void 0,
    final: void 0,
    usage: void 0
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
function hasVisibleContent(blocks) {
  return blocks.some(blockIsVisible);
}
function hasInterruptionEvidence(blocks) {
  return blocks.some((block) => {
    if (block.kind === "text" || block.kind === "reasoning") return block.text.trim() !== "";
    return true;
  });
}
function resetForRetry(state) {
  return {
    ...initialState(state.turn, state.step),
    firstTokenTime: state.firstTokenTime
  };
}
function updateChunk(state, chunk, seq, time) {
  if (chunk.type === "tool-call-delta") {
    const previous = state.blocks[chunk.index];
    if (previous?.kind === "tool-call" && previous.callId !== "" && (chunk.name === void 0 || chunk.name === previous.name) && (state.firstTokenTime !== void 0 || !isTokenDelta(chunk))) return state;
  }
  const blocks = [...state.blocks];
  let changedIndex = -1;
  let previousVisible = false;
  let nextVisible = false;
  switch (chunk.type) {
    case "block-start":
      changedIndex = chunk.index;
      previousVisible = state.visibleByIndex[chunk.index] === true;
      blocks[chunk.index] = emptyAssistantBlock(chunk.blockType);
      nextVisible = blockIsVisible(blocks[chunk.index]);
      break;
    case "text-delta": {
      const previous = blocks[chunk.index];
      changedIndex = chunk.index;
      previousVisible = state.visibleByIndex[chunk.index] === true;
      blocks[chunk.index] = { kind: "text", text: (previous?.kind === "text" ? previous.text : "") + chunk.text };
      nextVisible = previous?.kind === "text" && previousVisible || chunk.text.trim() !== "";
      break;
    }
    case "reasoning-delta": {
      const previous = blocks[chunk.index];
      changedIndex = chunk.index;
      previousVisible = state.visibleByIndex[chunk.index] === true;
      blocks[chunk.index] = { kind: "reasoning", text: (previous?.kind === "reasoning" ? previous.text : "") + chunk.text };
      nextVisible = previous?.kind === "reasoning" && previousVisible || chunk.text.trim() !== "";
      break;
    }
    case "tool-call-delta": {
      const previous = blocks[chunk.index];
      changedIndex = chunk.index;
      previousVisible = state.visibleByIndex[chunk.index] === true;
      blocks[chunk.index] = {
        kind: "tool-call",
        callId: (previous?.kind === "tool-call" ? previous.callId : "") || String(chunk.id),
        name: chunk.name ?? (previous?.kind === "tool-call" ? previous.name : ""),
        argsRaw: previous?.kind === "tool-call" ? previous.argsRaw : ""
      };
      break;
    }
    case "block-end":
      changedIndex = chunk.index;
      previousVisible = state.visibleByIndex[chunk.index] === true;
      blocks[chunk.index] = toAssistantBlock(chunk.block);
      nextVisible = blockIsVisible(blocks[chunk.index]);
      break;
    case "usage":
      return { ...state, usage: chunk.usage };
    default:
      return state;
  }
  const visibleBlocks = state.visibleBlocks - Number(previousVisible) + Number(nextVisible);
  let visibleByIndex = state.visibleByIndex;
  if (previousVisible !== nextVisible) {
    const next = [...visibleByIndex];
    next[changedIndex] = nextVisible;
    visibleByIndex = next;
  }
  const firstToken = isTokenDelta(chunk);
  return {
    ...state,
    blocks,
    visibleByIndex,
    visibleBlocks,
    ...visibleBlocks > 0 && state.firstVisibleSeq === void 0 ? { firstVisibleSeq: seq, firstVisibleTime: time } : {},
    ...firstToken && state.firstTokenTime === void 0 ? { firstTokenTime: time } : {}
  };
}
function settleMessage(state, match, event) {
  const blocks = toAssistantBlocks(event.data.message.content);
  const visibleByIndex = blocks.map(blockIsVisible);
  return {
    ...state,
    blocks,
    visibleByIndex,
    visibleBlocks: visibleByIndex.reduce((count, visible) => count + Number(visible), 0),
    final: match,
    usage: event.data.usage
  };
}
function closedBoundary(location) {
  if (location.kind === "step" && location.step.status === "closed" && location.step.end !== void 0) {
    return location.step.end;
  }
  if ((location.kind === "step" || location.kind === "turn") && location.turn.status === "closed" && location.turn.end !== void 0) {
    return location.turn.end;
  }
  return void 0;
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
      timing: {
        stepStartTime: context.start?.event.time ?? null,
        firstTokenTime: state.firstTokenTime ?? null,
        completedTime: event.time
      },
      ...event.data.interrupted === true ? { interrupted: true } : {}
    };
  }
  const location = context.start?.location ?? context.matches.at(-1)?.location;
  const boundary = location === void 0 ? void 0 : closedBoundary(location);
  if (boundary === void 0) return void 0;
  const blocks = compactBlocks(state.blocks);
  if (!hasInterruptionEvidence(blocks)) return void 0;
  return {
    kind: "assistant",
    seq: boundary.seq + CHAT_SYNTHETIC_SEQ_OFFSETS.interruptedAssistant,
    time: boundary.time,
    turn: state.turn,
    step: state.step,
    blocks,
    interrupted: true
  };
}
function fallbackState(context) {
  let state;
  for (const match of context.matches) {
    if (match.event.type === "assistant/live-chunk") {
      state ??= initialState(match.event.data.turn, match.event.data.step);
      state = updateChunk(state, match.event.data.chunk, match.event.seq, match.event.time);
      continue;
    }
    if (match.event.type === "assistant/message") {
      state ??= initialState(match.event.data.turn, match.event.data.step);
      state = settleMessage(state, match, match.event);
      continue;
    }
    if (match.event.type === "llm/retry" && state !== void 0) {
      state = resetForRetry(state);
    }
  }
  return state;
}
function projectAssistant(context) {
  const state = context.state ?? fallbackState(context);
  if (state === void 0) return void 0;
  const settled = finalNode(state, context);
  const blocks = settled?.blocks ?? compactBlocks(state.blocks);
  const visible = settled === void 0 ? state.visibleBlocks > 0 : hasVisibleContent(blocks);
  const status = settled?.interrupted === true ? "interrupted" : settled === void 0 ? "running" : "settled";
  const anchorSeq = (settled?.interrupted === true ? settled.seq : state.firstVisibleSeq ?? settled?.seq) ?? context.matches[0]?.event.seq ?? 0;
  const time = settled?.time ?? state.firstVisibleTime ?? context.matches[0]?.event.time ?? 0;
  return {
    anchorSeq,
    visible,
    settled,
    data: {
      status,
      turn: state.turn,
      step: state.step,
      blocks,
      time,
      ...state.usage === void 0 ? {} : { usage: state.usage },
      ...settled === void 0 ? {} : { finalNode: settled }
    }
  };
}
function publishedAssistantData(context) {
  const location = context.start?.location ?? context.matches.at(-1)?.location;
  return location?.kind === "step" ? location.step.data.get("assistant-step") : void 0;
}
var assistantDefinition = {
  kind: "assistant-step",
  target: "chat",
  match: (event) => {
    if (event.type === "step/start") return { id: `${event.data.turn}:${event.data.step}`, role: "start" };
    if (event.type === "assistant/live-chunk" || event.type === "assistant/message" && event.surfaceOp === "append") {
      return { id: `${event.data.turn}:${event.data.step}`, role: "update" };
    }
    if (event.type === "llm/retry") {
      return { id: `${event.data.turn}:${event.data.step}`, role: "update" };
    }
    return null;
  },
  start: (_context, match) => {
    if (match.event.type !== "step/start") throw new Error("assistant-step start requires step/start");
    return initialState(match.event.data.turn, match.event.data.step);
  },
  update: (context, match) => {
    if (match.event.type === "assistant/live-chunk") {
      return updateChunk(context.state, match.event.data.chunk, match.event.seq, match.event.time);
    }
    if (match.event.type === "assistant/message") return settleMessage(context.state, match, match.event);
    if (match.event.type === "llm/retry") {
      return resetForRetry(context.state);
    }
    return context.state;
  },
  publication: (match) => {
    if (match.event.type === "step/start") return "none";
    if (match.event.type !== "assistant/live-chunk") return "immediate";
    const type = match.event.data.chunk.type;
    return type === "usage" || type === "finish" ? "none" : "animation-frame";
  },
  buildLocationData: (context, scope) => {
    if (scope !== "step") return null;
    const projected = projectAssistant(context);
    if (projected === void 0) return null;
    return {
      kind: "step",
      turn: projected.data.turn,
      step: projected.data.step,
      key: "assistant-step",
      value: projected.data
    };
  },
  buildViewNode: (context) => {
    const current2 = context.current.get("chat");
    const state = context.state ?? fallbackState(context);
    const data = publishedAssistantData(context);
    if (state === void 0 || data === void 0) {
      return current2 == null ? null : { ...current2, visibility: "hidden" };
    }
    const settled = data.finalNode;
    const visible = settled === void 0 ? state.visibleBlocks > 0 : hasVisibleContent(data.blocks);
    if (settled === void 0 && !visible && current2 == null) return null;
    const anchorSeq = (settled?.interrupted === true ? settled.seq : state.firstVisibleSeq ?? settled?.seq) ?? context.matches[0]?.event.seq ?? 0;
    return chatNode(context, "assistant-step", anchorSeq, data, {
      visibility: settled?.interrupted === true || visible ? "visible" : "hidden"
    });
  }
};

// ../deepseek-harness/packages/client/ui-chat/src/client/contract/assistant-content.ts
function hasAssistantReplyContent(blocks) {
  return blocks.some((block) => {
    if (block.kind === "reasoning" || block.kind === "tool-call") return false;
    if (block.kind === "text") return block.text.trim() !== "";
    return true;
  });
}

// ../deepseek-harness/packages/client/ui-chat/src/client/contract/turn-process.ts
function sameTurnProcessSpec(left, right) {
  return left.turn === right.turn && left.controlAnchorSeq === right.controlAnchorSeq && left.processStartSeq === right.processStartSeq && left.answerAnchorSeq === right.answerAnchorSeq && left.answerStep === right.answerStep && left.inlineReasoning === right.inlineReasoning && left.messageCount === right.messageCount && left.toolCallCount === right.toolCallCount && left.subagentCount === right.subagentCount;
}
function isSubagentDelegationTool(name) {
  return name === "subagent" || name.startsWith("subagent_");
}

// ../deepseek-harness/packages/client/ui-chat/src/client/conversation-nodes/turn-process.ts
function eventTurn(event) {
  const data = event.data;
  return typeof data.turn === "number" ? data.turn : void 0;
}
function visibleChunk(chunk) {
  if (chunk.type === "text-delta" || chunk.type === "reasoning-delta") return chunk.text.trim() !== "";
  if (chunk.type === "block-start") {
    return chunk.blockType !== "text" && chunk.blockType !== "reasoning" && chunk.blockType !== "tool-call";
  }
  if (chunk.type !== "block-end") return false;
  const block = chunk.block;
  if (block.type === "tool-call") return false;
  if (block.type === "text" || block.type === "reasoning") return block.text.trim() !== "";
  return true;
}
function visibleAssistantEvent(event) {
  if (event.type === "assistant/live-chunk") return visibleChunk(event.data.chunk);
  if (event.type === "assistant/attempt") return false;
  return event.type === "assistant/message" && event.surfaceOp === "append" && toAssistantBlocks(event.data.message.content).some((block) => {
    if (block.kind === "tool-call") return false;
    if (block.kind === "text" || block.kind === "reasoning") return block.text.trim() !== "";
    return true;
  });
}
function processEvidence(event) {
  if (visibleAssistantEvent(event)) {
    if (event.type !== "assistant/live-chunk" && event.type !== "assistant/message" && event.type !== "assistant/attempt") return void 0;
    return { kind: "assistant", seq: event.seq, step: event.data.step };
  }
  if (event.type === "tool/call" || event.type === "tool/result" && event.surfaceOp === "append" || event.type === "llm/retry") return { kind: "other", seq: event.seq };
  return void 0;
}
function durableEvidenceStep(event) {
  if (processEvidence(event) === void 0) return void 0;
  switch (event.type) {
    case "assistant/message":
    case "tool/call":
    case "tool/result":
    case "llm/retry":
      return { turn: event.data.turn, step: event.data.step };
    default:
      return void 0;
  }
}
var processEvidenceDefinition = {
  kind: "process-evidence",
  match: (event) => {
    const coordinates = durableEvidenceStep(event);
    return coordinates === void 0 ? null : { id: `${coordinates.turn}:${coordinates.step}`, role: "start" };
  },
  start: (_context, match) => {
    const coordinates = durableEvidenceStep(match.event);
    if (coordinates === void 0) throw new Error("process-evidence start requires durable process evidence");
    return { turn: coordinates.turn };
  },
  update: (context) => context.state,
  publication: () => "none"
};
function turnLocation(context) {
  const location = context.start?.location ?? context.matches.at(-1)?.location;
  return location?.kind === "turn" || location?.kind === "step" ? location.turn : void 0;
}
function fallbackState2(context) {
  const turn = context.matches.map((match) => eventTurn(match.event)).find((candidate) => candidate !== void 0);
  if (turn === void 0) return void 0;
  let state = {
    turn,
    assistantStartByStep: /* @__PURE__ */ new Map(),
    messageCountByStep: /* @__PURE__ */ new Map(),
    messageCount: 0,
    toolCallCount: 0,
    subagentCount: 0
  };
  for (const match of context.matches) state = updateProcessState(state, match.event);
  return state;
}
function isFinalAssistant(data) {
  return data?.finalNode !== void 0;
}
function latestAnswer(turn) {
  const latestStep = turn.steps.at(-1);
  const data = latestStep?.data.get("assistant-step");
  if (!isFinalAssistant(data) || !hasAssistantReplyContent(data.blocks)) return null;
  return data.blocks.some((block) => block.kind === "tool-call") ? null : data;
}
function processSpec(state, turn) {
  const controlAnchorSeq = state.controlAnchorSeq ?? turn.start?.seq;
  if (controlAnchorSeq === void 0) return null;
  const answer = latestAnswer(turn);
  const counts = {
    messageCount: answer === null ? state.messageCount : [...state.messageCountByStep].filter(([step]) => step < answer.step).reduce((total, [, count]) => total + count, 0),
    toolCallCount: state.toolCallCount,
    subagentCount: state.subagentCount
  };
  if (answer === null) {
    return {
      turn: turn.turn,
      controlAnchorSeq,
      processStartSeq: controlAnchorSeq,
      answerAnchorSeq: null,
      answerStep: null,
      inlineReasoning: false,
      ...counts
    };
  }
  const inlineReasoning = answer.blocks.some((block) => block.kind === "reasoning" && block.text.trim() !== "");
  const earlierAssistantSeq = Math.min(
    ...[...state.assistantStartByStep].filter(([step]) => step < answer.step).map(([, seq]) => seq)
  );
  const externalProcessSeq = Math.min(
    state.otherStartSeq ?? Number.POSITIVE_INFINITY,
    earlierAssistantSeq
  );
  return {
    turn: turn.turn,
    controlAnchorSeq,
    processStartSeq: turn.start?.seq ?? (Number.isFinite(externalProcessSeq) ? externalProcessSeq : answer.finalNode.seq),
    answerAnchorSeq: answer.finalNode.seq,
    answerStep: answer.step,
    inlineReasoning,
    ...counts
  };
}
function updateProcessState(state, event) {
  let current2 = state;
  if (event.type === "assistant/message" && event.surfaceOp === "append" && hasAssistantReplyContent(toAssistantBlocks(event.data.message.content))) {
    const messageCountByStep = new Map(current2.messageCountByStep);
    messageCountByStep.set(event.data.step, (messageCountByStep.get(event.data.step) ?? 0) + 1);
    current2 = { ...current2, messageCountByStep, messageCount: current2.messageCount + 1 };
  }
  if (event.type === "tool/call") {
    const subagent = isSubagentDelegationTool(event.data.name);
    current2 = {
      ...current2,
      toolCallCount: current2.toolCallCount + (subagent ? 0 : 1),
      subagentCount: current2.subagentCount + (subagent ? 1 : 0)
    };
  }
  const evidence = processEvidence(event);
  if (evidence === void 0) return current2;
  if (evidence.kind === "other") {
    return current2.otherStartSeq === void 0 ? {
      ...current2,
      otherStartSeq: evidence.seq,
      controlAnchorSeq: Math.min(current2.controlAnchorSeq ?? Number.POSITIVE_INFINITY, evidence.seq)
    } : current2;
  }
  if (current2.assistantStartByStep.has(evidence.step)) return current2;
  const assistantStartByStep = new Map(current2.assistantStartByStep);
  assistantStartByStep.set(evidence.step, evidence.seq);
  return {
    ...current2,
    assistantStartByStep,
    controlAnchorSeq: Math.min(current2.controlAnchorSeq ?? Number.POSITIVE_INFINITY, evidence.seq)
  };
}
var turnProcessDefinition = {
  kind: "turn-process",
  target: "chat",
  match: (event) => {
    if (event.type === "turn/start") return { id: String(event.data.turn), role: "start" };
    const turn = eventTurn(event);
    if (turn === void 0) return null;
    if (event.type === "assistant/live-chunk" || event.type === "assistant/message" || event.type === "tool/call" || event.type === "tool/result" || event.type === "llm/retry" || event.type === "step/start" || event.type === "step/end" || event.type === "turn/end") {
      return { id: String(turn), role: "update" };
    }
    return null;
  },
  start: (_context, match) => {
    if (match.event.type !== "turn/start") throw new Error("turn-process start requires turn/start");
    return {
      turn: match.event.data.turn,
      assistantStartByStep: /* @__PURE__ */ new Map(),
      messageCountByStep: /* @__PURE__ */ new Map(),
      messageCount: 0,
      toolCallCount: 0,
      subagentCount: 0
    };
  },
  update: (context, match) => updateProcessState(context.state, match.event),
  publication: (match) => {
    if (match.event.type === "assistant/live-chunk") {
      const type = match.event.data.chunk.type;
      return type === "usage" || type === "finish" ? "none" : "animation-frame";
    }
    return "immediate";
  },
  buildLocationData: (context, scope, previous) => {
    if (scope !== "turn") return null;
    const state = context.state ?? fallbackState2(context);
    if (state === void 0) return null;
    const turn = turnLocation(context);
    if (turn === void 0) return null;
    const current2 = context.current.get("chat");
    const latestStep = turn.steps.at(-1);
    if (previous?.kind === "turn" && previous.key === "turn-process" && current2?.kind === "turn-process" && current2.data.answerAnchorSeq === null && current2.data.controlAnchorSeq === state.controlAnchorSeq && current2.data.messageCount === state.messageCount && current2.data.toolCallCount === state.toolCallCount && current2.data.subagentCount === state.subagentCount && turn.status !== "closed" && latestStep?.status !== "closed") return previous;
    const spec = processSpec(state, turn);
    if (spec === null) return null;
    if (previous?.kind === "turn" && previous.turn === spec.turn && previous.key === "turn-process" && sameTurnProcessSpec(previous.value, spec)) return previous;
    return {
      kind: "turn",
      turn: turn.turn,
      key: "turn-process",
      value: spec
    };
  },
  buildViewNode: (context) => {
    const turn = turnLocation(context);
    const data = turn?.data.get("turn-process");
    if (turn === void 0 || data === void 0) return null;
    const current2 = context.current.get("chat");
    const state = context.state;
    if (current2?.kind === "turn-process" && state !== void 0 && current2.data.answerAnchorSeq === null && current2.data.controlAnchorSeq === state.controlAnchorSeq && current2.data.messageCount === state.messageCount && current2.data.toolCallCount === state.toolCallCount && current2.data.subagentCount === state.subagentCount && turn.status !== "closed" && turn.steps.at(-1)?.status !== "closed" && current2.location === (context.start?.location ?? context.matches[0]?.location)) return current2;
    return chatNode(
      context,
      "turn-process",
      data.controlAnchorSeq + CHAT_SYNTHETIC_SEQ_OFFSETS.processControl,
      data,
      { groupTree: "turn" }
    );
  }
};

// ../deepseek-harness/packages/client/ui-chat/src/client/contract/chat-nodes.ts
function isSettledTool(block) {
  return "kind" in block;
}
function isRunningTool(block) {
  return !isSettledTool(block);
}

// ../deepseek-harness/packages/client/ui-chat/src/client/contract/chat-visibility.ts
function isVisibleChatNode(node) {
  if (node.kind === "command") {
    if (node.data.name === "permission") return false;
    if (node.data.name === "team" && node.data.outcome?.kind !== "error") {
      const selection = node.data.args?.trim();
      if (selection === "on" || selection === "off") return false;
    }
  }
  return node.visibility === "visible" && node.kind !== "system-prompt";
}

// ../deepseek-harness/packages/client/ui-chat/src/client/contract/group-tree.ts
var DEPTH = { exchange: 0, input: 1, turn: 2, process: 3 };
function isAtOrOutside(node, position) {
  return node.groupTree !== void 0 && DEPTH[node.groupTree] <= DEPTH[position];
}

// ../deepseek-harness/packages/client/ui-chat/src/client/conversation-nodes/group-tree-segments.ts
var NO_TURNS = [];
var GroupTreeSegments = class {
  /** @param position - group-tree position whose Nodes open a segment. */
  constructor(position) {
    this.position = position;
  }
  /** Opening Node count by owning Turn. */
  openings = /* @__PURE__ */ new Map();
  latestOpening;
  latestStart;
  /**
   * Account one Node change.
   * @param previous - replaced Node; absent for an addition.
   * @param next - replacing Node; absent for a removal.
   */
  track(previous, next) {
    const before = this.openingTurn(previous);
    const after = this.openingTurn(next);
    if (before === after) return;
    if (before !== void 0 && this.adjust(before, -1) === 0 && before === this.latestOpening) {
      this.latestOpening = this.lastOpeningTurn();
    }
    if (after !== void 0) {
      this.adjust(after, 1);
      if (this.latestOpening === void 0 || after > this.latestOpening) this.latestOpening = after;
    }
  }
  /**
   * Test latest-segment membership as of the last `settle`.
   * @param turn - owning Turn, when resolved.
   * @returns whether the Turn belongs to the latest segment.
   */
  inLatest(turn) {
    return turn !== void 0 && this.latestStart !== void 0 && turn >= this.latestStart;
  }
  /**
   * Move the latest segment start for the currently loaded Turns.
   * @param turnOrder - loaded Turns in ascending timeline order.
   * @returns loaded Turns that entered or left the latest segment, in ascending order.
   */
  settle(turnOrder) {
    const previous = this.latestStart;
    const start = this.latestOpening ?? turnOrder[0];
    if (start === previous) return NO_TURNS;
    this.latestStart = start;
    const bounded = previous !== void 0 && start !== void 0;
    const low = bounded ? Math.min(previous, start) : Number.NEGATIVE_INFINITY;
    const high = bounded ? Math.max(previous, start) : Number.POSITIVE_INFINITY;
    const changed = [];
    for (const turn of turnOrder.slice(turnOrder.findLastIndex((turn2) => turn2 < low) + 1)) {
      if (turn >= high) break;
      changed.push(turn);
    }
    return changed;
  }
  openingTurn(node) {
    return node !== void 0 && isAtOrOutside(node, this.position) ? locationCoordinates(node.location).turn : void 0;
  }
  lastOpeningTurn() {
    let last;
    for (const turn of this.openings.keys()) {
      if (last === void 0 || turn > last) last = turn;
    }
    return last;
  }
  /** @returns the Turn's opening count after the change; zero removes the Turn. */
  adjust(turn, delta) {
    const next = (this.openings.get(turn) ?? 0) + delta;
    if (next > 0) this.openings.set(turn, next);
    else this.openings.delete(turn);
    return next;
  }
};

// ../deepseek-harness/packages/client/ui-chat/src/client/conversation-nodes/turn-navigation.ts
var PROMPT_PREVIEW_LIMIT = 50;
var RESPONSE_PREVIEW_LIMIT = 120;
function preview(parts, limit) {
  let text = "";
  let unread = false;
  for (const part of parts) {
    if (text.length >= limit * 2) {
      unread = true;
      break;
    }
    const clipped = part.length > limit * 2;
    const chunk = clipped ? part.slice(0, limit * 2) : part;
    text += text === "" ? chunk : ` ${chunk}`;
    if (clipped) {
      unread = true;
      break;
    }
  }
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length > limit - 1) return `${normalized.slice(0, limit - 1).trimEnd()}\u2026`;
  return unread ? `${normalized}\u2026` : normalized;
}
function promptText(node) {
  if (node.kind !== "user") return "";
  return preview(node.data.content.flatMap((block) => block.type === "text" ? [block.text] : []), PROMPT_PREVIEW_LIMIT);
}
function responseText(node) {
  if (node.kind !== "assistant-step") return "";
  return preview(
    node.data.blocks.flatMap((block) => block.kind === "text" ? [block.text] : []),
    RESPONSE_PREVIEW_LIMIT
  );
}
function sameTurnNavigationItem(left, right) {
  if (left === void 0 || right === void 0) return left === right;
  return left.turn === right.turn && left.anchorKey === right.anchorKey && left.prompt === right.prompt && left.response === right.response;
}
function turnNavigationItem(turn, locations, nodes) {
  const loaded = locations.getTurn(turn).map((key) => nodes.get(key)).filter((node) => node !== void 0 && isVisibleChatNode(node));
  const user = loaded.find((node) => node.kind === "user");
  const anchor = user ?? loaded[0];
  if (anchor === void 0) return void 0;
  const response = loaded.findLast((node) => responseText(node) !== "");
  return {
    turn,
    anchorKey: anchor.key,
    prompt: user === void 0 ? "" : promptText(user),
    response: response === void 0 ? "" : responseText(response)
  };
}

// ../deepseek-harness/packages/client/ui-chat/src/client/conversation-nodes/turn-process-presentation.ts
function nodeTurn(node) {
  const location = node?.location;
  return location?.kind === "turn" || location?.kind === "step" ? location.turn.turn : void 0;
}
function samePresentation(left, right) {
  return left === right || left !== void 0 && right !== void 0 && left.spec === right.spec && left.turn === right.turn && left.turnStarted === right.turnStarted && left.turnClosed === right.turnClosed && left.hasExternalProcess === right.hasExternalProcess && left.hasNonReplyProcess === right.hasNonReplyProcess && left.hasInterleavedInput === right.hasInterleavedInput;
}
function derivePresentation(turn, locations, nodes) {
  const keys = locations.getTurn(turn);
  const control = keys.map((key) => nodes.get(key)).find((node) => node?.kind === "turn-process");
  if (control === void 0) return void 0;
  const spec = control.data;
  const location = control.location;
  if (location.kind !== "turn" && location.kind !== "step") return void 0;
  let openingHumanAnchor;
  for (const key of keys) {
    const node = nodes.get(key);
    if (node !== void 0 && isAtOrOutside(node, "input") && (spec.controlAnchorSeq === location.turn.start?.seq || node.anchorSeq < spec.controlAnchorSeq)) {
      openingHumanAnchor = Math.max(openingHumanAnchor ?? node.anchorSeq, node.anchorSeq);
    }
  }
  let hasExternalProcess = false;
  let hasNonReplyProcess = false;
  let hasInterleavedInput = false;
  for (const key of keys) {
    const node = nodes.get(key);
    if (node === void 0 || !isVisibleChatNode(node) || node.kind === "turn-process") continue;
    if (isAtOrOutside(node, "input") && (openingHumanAnchor === void 0 || node.anchorSeq > openingHumanAnchor)) {
      hasInterleavedInput = true;
    }
    if (isAtOrOutside(node, "turn") || node.anchorSeq < spec.processStartSeq || spec.answerAnchorSeq !== null && node.anchorSeq >= spec.answerAnchorSeq) continue;
    if (node.kind !== "assistant-step" || spec.answerStep === null || node.data.step !== spec.answerStep) {
      hasExternalProcess = true;
      if (node.kind !== "assistant-step" || node.data.blocks.some((block) => block.kind === "reasoning" && block.text.trim() !== "")) {
        hasNonReplyProcess = true;
      }
    }
  }
  return {
    turn,
    spec,
    turnStarted: location.turn.start !== void 0,
    turnClosed: location.turn.status === "closed",
    hasExternalProcess,
    hasNonReplyProcess,
    hasInterleavedInput
  };
}
var ChatTurnProcessProjector = class {
  presentations = /* @__PURE__ */ new Map();
  /**
   * Read the retained process presentation for a Node's Turn.
   * @param node - Current Chat Node.
   * @returns The Turn's process presentation, when present.
   */
  get(node) {
    const turn = nodeTurn(node);
    return turn === void 0 ? void 0 : this.presentations.get(turn);
  }
  /**
   * Replace every projected Turn.
   * @param order - visible Chat Node order.
   * @param locations - current Chat Location index.
   * @param nodes - current Chat Node store.
   * @returns Turns whose process presentation changed.
   */
  replace(order, locations, nodes) {
    const turns = /* @__PURE__ */ new Set();
    for (const key of order) {
      const turn = nodeTurn(nodes.get(key));
      if (turn !== void 0) turns.add(turn);
    }
    const changed = /* @__PURE__ */ new Set();
    for (const turn of /* @__PURE__ */ new Set([...this.presentations.keys(), ...turns])) {
      if (this.set(turn, turns.has(turn) ? derivePresentation(turn, locations, nodes) : void 0)) {
        changed.add(turn);
      }
    }
    return changed;
  }
  /**
   * Recompute selected Turns after incremental Node changes.
   * @param turns - affected Turn numbers.
   * @param locations - current Chat Location index.
   * @param nodes - current Chat Node store.
   * @returns Turns whose process presentation changed.
   */
  update(turns, locations, nodes) {
    const changed = /* @__PURE__ */ new Set();
    for (const turn of turns) {
      if (this.set(turn, derivePresentation(turn, locations, nodes))) changed.add(turn);
    }
    return changed;
  }
  set(turn, next) {
    const current2 = this.presentations.get(turn);
    if (samePresentation(current2, next)) return false;
    if (next === void 0) this.presentations.delete(turn);
    else this.presentations.set(turn, next);
    return true;
  }
};

// ../deepseek-harness/packages/client/ui-chat/src/client/conversation-nodes/chat-snapshot-builder.ts
var EMPTY_KEYS = [];
var EMPTY_TURNS = [];
var EMPTY_ITEMS = [];
var EMPTY_LIST = [];
function sameReferences2(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
function cachedSource(sources, key, create) {
  let source = sources.get(key);
  if (source === void 0) {
    source = create();
    sources.set(key, source);
  }
  return source;
}
var MutableChatSource = class {
  constructor(read, label) {
    this.read = read;
    this.label = label;
    this.published = read();
  }
  listeners = /* @__PURE__ */ new Set();
  published;
  getSnapshot = () => this.read();
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
    notifySubscribers(this.listeners, this.label);
  }
};
var TurnKindNodes = class {
  nodes = /* @__PURE__ */ new Map();
  current = EMPTY_LIST;
  dirty = false;
  observable;
  source() {
    return this.observable ??= new MutableChatSource(() => this.read(), "[ui-chat] turn kind nodes");
  }
  set(node) {
    const previous = this.nodes.get(node.key);
    this.nodes.set(node.key, node);
    if (previous !== void 0 && previous.data === node.data && previous.anchorSeq === node.anchorSeq) return;
    this.dirty = true;
  }
  delete(key) {
    this.nodes.delete(key);
    this.dirty = true;
  }
  publish() {
    this.observable?.publish();
  }
  read() {
    if (this.dirty) {
      this.current = [...this.nodes.values()].sort((a, b) => a.anchorSeq - b.anchorSeq).map((node) => node.data);
      this.dirty = false;
    }
    return this.current;
  }
};
var MutableChatNodeStore = class {
  byKey = /* @__PURE__ */ new Map();
  turnProcesses = new ChatTurnProcessProjector();
  sources = /* @__PURE__ */ new Map();
  processSources = /* @__PURE__ */ new Map();
  bottomSources = /* @__PURE__ */ new Map();
  /** Bottom membership: the latest loaded exchange. */
  exchanges = new GroupTreeSegments("exchange");
  dirtyKeys = /* @__PURE__ */ new Set();
  dirtyBottomKeys = /* @__PURE__ */ new Set();
  dirtyProcessKeys = /* @__PURE__ */ new Set();
  turnKinds = /* @__PURE__ */ new Map();
  dirtyTurnKinds = /* @__PURE__ */ new Set();
  valuesCache = EMPTY_LIST;
  valuesDirty = false;
  get(key) {
    return this.byKey.get(key);
  }
  source(key) {
    return cachedSource(this.sources, key, () => new MutableChatSource(
      () => this.get(key),
      `[ui-chat] node source ${key}`
    ));
  }
  bottomSource(key) {
    return cachedSource(this.bottomSources, key, () => new MutableChatSource(() => {
      const node = this.get(key);
      return node !== void 0 && isVisibleChatNode(node) && this.exchanges.inLatest(locationCoordinates(node.location).turn);
    }, `[ui-chat] node bottom source ${key}`));
  }
  /**
   * Settle the latest exchange for the loaded Turns and mark the Nodes of
   * Turns that entered or left it.
   * @param turnOrder - loaded Turns in ascending timeline order.
   * @param locations - current Chat Location index.
   */
  settleBottom(turnOrder, locations) {
    for (const turn of this.exchanges.settle(turnOrder)) {
      for (const key of locations.getTurn(turn)) this.dirtyBottomKeys.add(key);
    }
  }
  turnDataSource(turn, kind) {
    return this.turnKind(turn, kind).source();
  }
  turnKind(turn, kind) {
    const kinds = cachedSource(this.turnKinds, turn, () => /* @__PURE__ */ new Map());
    return cachedSource(kinds, kind, () => new TurnKindNodes());
  }
  updateTurnKind(previous, next) {
    const before = previous === void 0 ? void 0 : locationCoordinates(previous.location).turn;
    const after = next === void 0 ? void 0 : locationCoordinates(next.location).turn;
    if (previous !== void 0 && before !== void 0 && (before !== after || previous.kind !== next?.kind)) {
      const collection = this.turnKind(before, previous.kind);
      collection.delete(previous.key);
      this.dirtyTurnKinds.add(collection);
    }
    if (next !== void 0 && after !== void 0) {
      const collection = this.turnKind(after, next.kind);
      collection.set(next);
      this.dirtyTurnKinds.add(collection);
    }
  }
  processSource(key) {
    return cachedSource(this.processSources, key, () => new MutableChatSource(
      () => this.process(key),
      `[ui-chat] node process source ${key}`
    ));
  }
  process(key) {
    return this.turnProcesses.get(this.get(key));
  }
  values() {
    if (this.valuesDirty) {
      this.valuesCache = [...this.byKey.values()];
      this.valuesDirty = false;
    }
    return this.valuesCache;
  }
  replace(nodes) {
    const previous = new Map(this.byKey);
    this.byKey.clear();
    for (const node of nodes) {
      this.byKey.set(node.key, node);
      if (previous.get(node.key) !== node) {
        this.updateTurnKind(previous.get(node.key), node);
        this.exchanges.track(previous.get(node.key), node);
        this.dirtyKeys.add(node.key);
        this.dirtyProcessKeys.add(node.key);
      }
      previous.delete(node.key);
    }
    for (const key of previous.keys()) {
      this.updateTurnKind(previous.get(key), void 0);
      this.exchanges.track(previous.get(key), void 0);
      this.dirtyKeys.add(key);
      this.dirtyProcessKeys.add(key);
    }
    this.valuesCache = [...this.byKey.values()];
    this.valuesDirty = false;
  }
  upsert(nodes) {
    let changed = false;
    for (const node of nodes) {
      if (this.byKey.get(node.key) === node) continue;
      this.updateTurnKind(this.byKey.get(node.key), node);
      this.exchanges.track(this.byKey.get(node.key), node);
      this.byKey.set(node.key, node);
      this.dirtyKeys.add(node.key);
      this.dirtyProcessKeys.add(node.key);
      changed = true;
    }
    if (changed) this.valuesDirty = true;
  }
  touchProcesses(turns, locations) {
    for (const turn of turns) {
      for (const key of locations.getTurn(turn)) this.dirtyProcessKeys.add(key);
    }
  }
  replaceProcesses(order, locations) {
    this.touchProcesses(this.turnProcesses.replace(order, locations, this), locations);
  }
  updateProcesses(turns, locations) {
    this.touchProcesses(this.turnProcesses.update(turns, locations, this), locations);
  }
  publish() {
    const dirty = [...this.dirtyKeys];
    const dirtyBottom = /* @__PURE__ */ new Set([...this.dirtyBottomKeys, ...dirty]);
    const dirtyProcesses = [...this.dirtyProcessKeys];
    const dirtyTurnKinds = [...this.dirtyTurnKinds];
    this.dirtyKeys.clear();
    this.dirtyBottomKeys.clear();
    this.dirtyProcessKeys.clear();
    this.dirtyTurnKinds.clear();
    for (const key of dirty) this.sources.get(key)?.publish();
    for (const key of dirtyBottom) this.bottomSources.get(key)?.publish();
    for (const key of dirtyProcesses) this.processSources.get(key)?.publish();
    for (const collection of dirtyTurnKinds) collection.publish();
  }
};
var MutableChatLocationIndex = class {
  turns = /* @__PURE__ */ new Map();
  steps = /* @__PURE__ */ new Map();
  positions = /* @__PURE__ */ new Map();
  getTurn(turn) {
    return this.turns.get(turn) ?? EMPTY_KEYS;
  }
  getStep(turn, step) {
    return this.steps.get(stepKey(turn, step)) ?? EMPTY_KEYS;
  }
  getPosition(key) {
    return this.positions.get(key);
  }
  rebuild(order, store) {
    const turns = /* @__PURE__ */ new Map();
    const steps = /* @__PURE__ */ new Map();
    const positions = /* @__PURE__ */ new Map();
    const changedTurns = /* @__PURE__ */ new Set();
    for (const [index, key] of order.entries()) {
      const location = store.get(key)?.location;
      if (location === void 0) continue;
      const coordinates = locationCoordinates(location);
      const previous = this.positions.get(key);
      const position = {
        turn: coordinates.turn,
        previous: order[index - 1],
        next: order[index + 1]
      };
      const unchanged = previous !== void 0 && previous.turn === position.turn && previous.previous === position.previous && previous.next === position.next;
      positions.set(key, unchanged ? previous : position);
      if (!unchanged) {
        if (previous?.turn !== void 0) changedTurns.add(previous.turn);
        if (position.turn !== void 0) changedTurns.add(position.turn);
      }
      if (coordinates.turn === void 0) continue;
      const turnKeys = turns.get(coordinates.turn) ?? [];
      turnKeys.push(key);
      turns.set(coordinates.turn, turnKeys);
      if (coordinates.step === void 0) continue;
      const step = stepKey(coordinates.turn, coordinates.step);
      const stepKeys = steps.get(step) ?? [];
      stepKeys.push(key);
      steps.set(step, stepKeys);
    }
    for (const [key, position] of this.positions) {
      if (!positions.has(key) && position.turn !== void 0) changedTurns.add(position.turn);
    }
    this.positions = positions;
    this.turns = updateIndex(this.turns, turns);
    this.steps = updateIndex(this.steps, steps);
    return [...changedTurns];
  }
  /** Invalidate aggregate readers when member data changes without moving. */
  touch(nodes) {
    const turns = /* @__PURE__ */ new Set();
    const steps = /* @__PURE__ */ new Set();
    for (const node of nodes) {
      const coordinates = locationCoordinates(node.location);
      if (coordinates.turn === void 0 || !this.turns.get(coordinates.turn)?.includes(node.key)) continue;
      turns.add(coordinates.turn);
      if (coordinates.step !== void 0) steps.add(stepKey(coordinates.turn, coordinates.step));
    }
    for (const turn of turns) {
      const keys = this.turns.get(turn);
      if (keys === void 0) continue;
      this.turns.set(turn, [...keys]);
    }
    for (const step of steps) {
      const keys = this.steps.get(step);
      if (keys === void 0) continue;
      this.steps.set(step, [...keys]);
    }
  }
};
function updateIndex(previous, nextMutable) {
  const next = /* @__PURE__ */ new Map();
  const keys = /* @__PURE__ */ new Set([...previous.keys(), ...nextMutable.keys()]);
  for (const key of keys) {
    const before = previous.get(key) ?? EMPTY_KEYS;
    const candidate = nextMutable.get(key) ?? EMPTY_KEYS;
    const value = sameReferences2(before, candidate) ? before : candidate;
    if (candidate.length > 0) next.set(key, value);
  }
  return next;
}
var MutableTurnNavigationIndex = class {
  current = EMPTY_ITEMS;
  byTurn = /* @__PURE__ */ new Map();
  items() {
    return this.current;
  }
  /** Re-derive the whole Turn set; runs only when the loaded structure moves. */
  rebuild(timeline, locations, nodes) {
    const next = [];
    const byTurn = /* @__PURE__ */ new Map();
    for (const turn of timeline.turnOrder) {
      const derived = turnNavigationItem(turn, locations, nodes);
      if (derived === void 0) continue;
      const previous = this.byTurn.get(turn);
      const item = previous !== void 0 && sameTurnNavigationItem(previous, derived) ? previous : derived;
      next.push(item);
      byTurn.set(turn, item);
    }
    this.byTurn = byTurn;
    const unchanged = next.length === this.current.length && next.every((item, index) => item === this.current[index]);
    if (!unchanged) this.current = next;
  }
  /** Re-derive only the Turns a content-only upsert touched. */
  touch(turns, locations, nodes) {
    if (turns.size === 0) return;
    const next = this.current.map((item) => {
      if (!turns.has(item.turn)) return item;
      const derived = turnNavigationItem(item.turn, locations, nodes);
      if (derived === void 0 || sameTurnNavigationItem(item, derived)) return item;
      this.byTurn.set(item.turn, derived);
      return derived;
    });
    if (next.some((item, index) => item !== this.current[index])) this.current = next;
  }
};
function stepKey(turn, step) {
  return `${turn}:${step}`;
}
function locationTurnStatus(location) {
  return location.kind === "turn" || location.kind === "step" ? location.turn.status : void 0;
}
function processPresentationInputChanged(previous, next, structural) {
  if (structural || previous === void 0) return true;
  if (locationTurnStatus(previous.location) !== locationTurnStatus(next.location)) return true;
  if (previous.kind === "turn-process" && next.kind === "turn-process") {
    return previous.data !== next.data;
  }
  return previous.kind === "assistant-step" && next.kind === "assistant-step" && previous.data.step !== next.data.step;
}
function turnProcessPresentations(nodes) {
  const presentations = /* @__PURE__ */ new Map();
  for (const raw of nodes) {
    const node = raw;
    if (node.kind === "turn-process") {
      presentations.set(node.data.turn, { ...presentations.get(node.data.turn), control: node });
    }
  }
  for (const raw of nodes) {
    const node = raw;
    const location = node.location;
    if (location.kind !== "turn" && location.kind !== "step") continue;
    const current2 = presentations.get(location.turn.turn) ?? {};
    const controlAnchor = current2.control?.data.controlAnchorSeq;
    if (isAtOrOutside(node, "input") && controlAnchor !== void 0 && (controlAnchor === location.turn.start?.seq || node.anchorSeq < controlAnchor)) {
      presentations.set(location.turn.turn, {
        ...current2,
        openingInputAnchor: Math.max(current2.openingInputAnchor ?? node.anchorSeq, node.anchorSeq)
      });
      continue;
    }
    if (isAtOrOutside(node, "turn")) continue;
    presentations.set(location.turn.turn, {
      ...current2,
      earliestProcessAnchor: Math.min(current2.earliestProcessAnchor ?? node.anchorSeq, node.anchorSeq)
    });
  }
  return presentations;
}
function presentationPosition(raw, presentations) {
  const node = raw;
  const location = node.location;
  if (location.kind !== "turn" && location.kind !== "step") {
    return { anchor: node.anchorSeq, rank: 0, originalAnchor: node.anchorSeq };
  }
  const presentation = presentations.get(location.turn.turn);
  if (presentation === void 0) {
    return { anchor: node.anchorSeq, rank: 0, originalAnchor: node.anchorSeq };
  }
  const openingInputAnchor = presentation.openingInputAnchor;
  if (openingInputAnchor !== void 0 && node.anchorSeq < openingInputAnchor && !isAtOrOutside(node, "turn")) {
    return { anchor: openingInputAnchor, rank: 2, originalAnchor: node.anchorSeq };
  }
  if (presentation.control !== void 0 && node.key === presentation.control.key) {
    return openingInputAnchor === void 0 ? {
      anchor: presentation.earliestProcessAnchor ?? node.anchorSeq,
      rank: -1,
      originalAnchor: node.anchorSeq
    } : { anchor: openingInputAnchor, rank: 1, originalAnchor: node.anchorSeq };
  }
  return { anchor: node.anchorSeq, rank: 0, originalAnchor: node.anchorSeq };
}
function orderedVisibleChatNodes(nodes) {
  const visible = nodes.filter((node) => isVisibleChatNode(node));
  const presentations = turnProcessPresentations(visible);
  return visible.sort((left, right) => {
    const leftPosition = presentationPosition(left, presentations);
    const rightPosition = presentationPosition(right, presentations);
    return leftPosition.anchor - rightPosition.anchor || leftPosition.rank - rightPosition.rank || leftPosition.originalAnchor - rightPosition.originalAnchor || left.key.localeCompare(right.key);
  });
}
function referenceMessageSeq(node) {
  const candidate = node;
  return candidate.kind === "user" || candidate.kind === "steering" ? candidate.data.seq : void 0;
}
function followingRecall(node) {
  const candidate = node;
  if (candidate.kind !== "context") return void 0;
  return {
    messageSeq: candidate.data.seq - 1,
    labels: sessionRecallLabels(candidate.data.source)
  };
}
function withReferenceLabels(node, labels) {
  const candidate = node;
  if (candidate.kind !== "user" && candidate.kind !== "steering") return node;
  const current2 = candidate.data.referenceLabels ?? EMPTY_KEYS;
  const hasLabels = Object.hasOwn(candidate.data, "referenceLabels");
  if (sameReferences2(current2, labels) && hasLabels === labels.length > 0) return node;
  const data = { ...candidate.data };
  if (labels.length === 0) delete data.referenceLabels;
  else data.referenceLabels = labels;
  return { ...candidate, data };
}
var ReferenceLabelProjector = class {
  messagesBySeq = /* @__PURE__ */ new Map();
  labelsByMessageSeq = /* @__PURE__ */ new Map();
  replace(nodes) {
    this.messagesBySeq.clear();
    this.labelsByMessageSeq.clear();
    for (const node of nodes) {
      const messageSeq = referenceMessageSeq(node);
      if (messageSeq !== void 0) this.messagesBySeq.set(messageSeq, node.key);
      const recall = followingRecall(node);
      if (recall !== void 0 && recall.labels.length > 0) {
        this.labelsByMessageSeq.set(recall.messageSeq, recall.labels);
      }
    }
    return nodes.map((node) => {
      const messageSeq = referenceMessageSeq(node);
      return messageSeq === void 0 ? node : withReferenceLabels(node, this.labelsByMessageSeq.get(messageSeq) ?? EMPTY_KEYS);
    });
  }
  apply(upserts, store) {
    const byKey = new Map(upserts.map((node) => [node.key, node]));
    const affected = /* @__PURE__ */ new Set();
    for (const node of upserts) {
      const messageSeq = referenceMessageSeq(node);
      if (messageSeq !== void 0) {
        this.messagesBySeq.set(messageSeq, node.key);
        affected.add(messageSeq);
      }
      const recall = followingRecall(node);
      if (recall === void 0) continue;
      const current2 = this.labelsByMessageSeq.get(recall.messageSeq);
      if (recall.labels.length === 0) this.labelsByMessageSeq.delete(recall.messageSeq);
      else {
        this.labelsByMessageSeq.set(
          recall.messageSeq,
          current2 !== void 0 && sameReferences2(current2, recall.labels) ? current2 : recall.labels
        );
      }
      affected.add(recall.messageSeq);
    }
    for (const messageSeq of affected) {
      const key = this.messagesBySeq.get(messageSeq);
      if (key === void 0) continue;
      const node = byKey.get(key) ?? store.get(key);
      if (node === void 0) continue;
      byKey.set(key, withReferenceLabels(node, this.labelsByMessageSeq.get(messageSeq) ?? EMPTY_KEYS));
    }
    return [...byKey.values()];
  }
};
function withSkillNames(node, names) {
  const candidate = node;
  if (candidate.kind !== "user" && candidate.kind !== "steering") return node;
  const current2 = candidate.data.skillNames ?? EMPTY_KEYS;
  const hasNames = Object.hasOwn(candidate.data, "skillNames");
  if (sameReferences2(current2, names) && hasNames === names.length > 0) return node;
  const data = { ...candidate.data };
  if (names.length === 0) delete data.skillNames;
  else data.skillNames = names;
  return { ...candidate, data };
}
function slashEntryOf(node) {
  const candidate = node;
  if (candidate.kind === "user" || candidate.kind === "steering") {
    return { key: node.key, seq: node.anchorSeq, kind: "message", name: null };
  }
  if (candidate.kind === "context") {
    const name = skillInvocationName(candidate.data.source);
    return name === null ? null : { key: node.key, seq: node.anchorSeq, kind: "skill", name };
  }
  return { key: node.key, seq: node.anchorSeq, kind: "boundary", name: null };
}
function sameSlashEntry(left, right) {
  return left.seq === right.seq && left.kind === right.kind && left.name === right.name;
}
var SkillNameProjector = class {
  entries = /* @__PURE__ */ new Map();
  /** Every indexed entry in `anchorSeq` order. */
  sorted = [];
  /**
   * Rebuild the index from a whole Node set and attach names to its messages.
   * @param nodes - every materialized Chat Node, in any order.
   * @returns the same Nodes, direct messages carrying their batch's names.
   */
  replace(nodes) {
    this.entries.clear();
    this.sorted = [];
    for (const node of nodes) {
      const entry = slashEntryOf(node);
      if (entry === null) continue;
      this.entries.set(entry.key, entry);
      this.sorted.push(entry);
    }
    this.sorted.sort((left, right) => left.seq - right.seq);
    const names = /* @__PURE__ */ new Map();
    for (let index = 0; index < this.sorted.length; index++) {
      if (this.sorted[index]?.kind === "boundary") continue;
      const end = this.runEnd(index);
      this.assignRun(index, end, names);
      index = end;
    }
    return nodes.map((node) => withSkillNames(node, names.get(node.key) ?? EMPTY_KEYS));
  }
  /**
   * Fold one incremental upsert set: re-read only the batches around the
   * Nodes whose classification changed.
   * @param upserts - the changed Nodes.
   * @param store - the resident Nodes, read by key for the messages of an affected batch.
   * @returns the upserts plus any resident message whose names changed.
   */
  apply(upserts, store) {
    const dirty = [];
    for (const node of upserts) {
      const next = slashEntryOf(node);
      const previous = this.entries.get(node.key);
      if (previous !== void 0) {
        if (next !== null && sameSlashEntry(previous, next)) {
          if (next.kind === "message") dirty.push(next.seq);
          continue;
        }
        this.remove(previous);
        dirty.push(previous.seq);
      }
      if (next === null) continue;
      this.insert(next);
      dirty.push(next.seq);
    }
    if (dirty.length === 0) return upserts;
    const names = /* @__PURE__ */ new Map();
    for (const seq of dirty) this.collectAround(seq, names);
    const byKey = new Map(upserts.map((node) => [node.key, node]));
    for (const [key, list] of names) {
      const node = byKey.get(key) ?? store.get(key);
      if (node === void 0) continue;
      const next = withSkillNames(node, list);
      if (next !== node || byKey.has(key)) byKey.set(key, next);
    }
    return [...byKey.values()];
  }
  insert(entry) {
    this.sorted.splice(this.lowerBound(entry.seq), 0, entry);
    this.entries.set(entry.key, entry);
  }
  remove(entry) {
    this.sorted.splice(this.sorted.indexOf(entry), 1);
    this.entries.delete(entry.key);
  }
  /** First index whose seq is at least `seq`. */
  lowerBound(seq) {
    let low = 0;
    let high = this.sorted.length;
    while (low < high) {
      const middle = low + high >>> 1;
      if ((this.sorted[middle]?.seq ?? Number.POSITIVE_INFINITY) < seq) low = middle + 1;
      else high = middle;
    }
    return low;
  }
  /** Last index of the boundary-free run containing `index`. */
  runEnd(index) {
    let end = index;
    while (end + 1 < this.sorted.length && this.sorted[end + 1]?.kind !== "boundary") end++;
    return end;
  }
  /** First index of the boundary-free run containing `index`. */
  runStart(index) {
    let start = index;
    while (start - 1 >= 0 && this.sorted[start - 1]?.kind !== "boundary") start--;
    return start;
  }
  /** Record the names every message of the run `[start, end]` carries. */
  assignRun(start, end, names) {
    const list = [];
    for (let index = start; index <= end; index++) {
      const entry = this.sorted[index];
      if (entry?.kind === "skill" && entry.name !== null && !list.includes(entry.name)) list.push(entry.name);
    }
    for (let index = start; index <= end; index++) {
      const entry = this.sorted[index];
      if (entry?.kind === "message") names.set(entry.key, list);
    }
  }
  /**
   * Re-read the run(s) around one changed seq: the run holding a message or
   * skill entry, or — for a boundary, or a seq that left the index — the runs
   * on both sides of that position.
   */
  collectAround(seq, names) {
    const at = this.lowerBound(seq);
    const here = this.sorted[at];
    if (here !== void 0 && here.seq === seq && here.kind !== "boundary") {
      this.assignRun(this.runStart(at), this.runEnd(at), names);
      return;
    }
    if (at - 1 >= 0 && this.sorted[at - 1]?.kind !== "boundary") {
      this.assignRun(this.runStart(at - 1), at - 1, names);
    }
    const right = here !== void 0 && here.seq === seq ? at + 1 : at;
    if (right < this.sorted.length && this.sorted[right]?.kind !== "boundary") {
      this.assignRun(right, this.runEnd(right), names);
    }
  }
};
var EMPTY_CONTRIBUTION = {
  anchorSeq: 0,
  nodes: EMPTY_LIST,
  partial: null,
  running: null
};
function legacyContribution(raw) {
  const node = raw;
  if (raw.visibility !== "visible" && node.kind !== "assistant-step") return EMPTY_CONTRIBUTION;
  switch (node.kind) {
    case "user":
    case "steering":
    case "context":
    case "command":
    case "compaction":
    case "turn-error":
    case "turn-max-tokens":
    case "unknown":
      return { anchorSeq: node.anchorSeq, nodes: [node.data], partial: null, running: null };
    case "assistant-step": {
      const data = node.data;
      if (data.status === "running") {
        if (raw.visibility !== "visible") return EMPTY_CONTRIBUTION;
        return {
          anchorSeq: node.anchorSeq,
          nodes: EMPTY_LIST,
          partial: { turn: data.turn, step: data.step, blocks: data.blocks },
          running: null
        };
      }
      return {
        anchorSeq: node.anchorSeq,
        nodes: data.finalNode === void 0 ? EMPTY_LIST : [data.finalNode],
        partial: null,
        running: null
      };
    }
    case "tool-call": {
      const root = node.data.root;
      return isRunningTool(root) ? { anchorSeq: node.anchorSeq, nodes: EMPTY_LIST, partial: null, running: root } : { anchorSeq: node.anchorSeq, nodes: [root], partial: null, running: null };
    }
    case "manual-compaction": {
      const data = node.data;
      return {
        anchorSeq: node.anchorSeq,
        nodes: data.compaction === null ? [data.command] : [data.command, data.compaction],
        partial: null,
        running: null
      };
    }
    case "model-retry":
      return {
        anchorSeq: node.anchorSeq,
        nodes: node.data.attempts,
        partial: null,
        running: null
      };
    case "turn-tail":
    case "system-prompt":
      return EMPTY_CONTRIBUTION;
    default:
      return EMPTY_CONTRIBUTION;
  }
}
function sameContribution(left, right) {
  return left !== void 0 && left.anchorSeq === right.anchorSeq && left.partial?.blocks === right.partial?.blocks && left.partial?.turn === right.partial?.turn && left.partial?.step === right.partial?.step && left.running === right.running && sameReferences2(left.nodes, right.nodes);
}
var LegacySliceBuilder = class {
  contributions = /* @__PURE__ */ new Map();
  finalizedContributions = /* @__PURE__ */ new Map();
  runningContributions = /* @__PURE__ */ new Map();
  partialContributions = /* @__PURE__ */ new Map();
  finalized = EMPTY_LIST;
  runningCalls = EMPTY_LIST;
  partial = null;
  timeline;
  turnTimings = /* @__PURE__ */ new Map();
  turnEnds = /* @__PURE__ */ new Map();
  replace(nodes, timeline) {
    this.contributions.clear();
    this.finalizedContributions.clear();
    this.runningContributions.clear();
    this.partialContributions.clear();
    for (const node of nodes) {
      const contribution = legacyContribution(node);
      this.contributions.set(node.key, contribution);
      this.indexContribution(node.key, contribution);
    }
    this.rebuildFinalized();
    this.rebuildRunning();
    this.rebuildPartial();
    this.updateTimeline(timeline);
    return this.snapshot();
  }
  apply(upserts, timeline) {
    let finalizedChanged = false;
    let runningChanged = false;
    let partialChanged = false;
    for (const node of upserts) {
      const contribution = legacyContribution(node);
      const previous = this.contributions.get(node.key);
      if (sameContribution(previous, contribution)) continue;
      finalizedChanged ||= finalizedContributionChanged(previous, contribution);
      runningChanged ||= runningContributionChanged(previous, contribution);
      partialChanged ||= partialContributionChanged(previous, contribution);
      this.contributions.set(node.key, contribution);
      this.indexContribution(node.key, contribution);
    }
    if (finalizedChanged) this.rebuildFinalized();
    if (runningChanged) this.rebuildRunning();
    if (partialChanged) this.rebuildPartial();
    this.updateTimeline(timeline);
    return this.snapshot();
  }
  indexContribution(key, contribution) {
    updateContributionIndex(this.finalizedContributions, key, contribution, contribution.nodes.length > 0);
    updateContributionIndex(this.runningContributions, key, contribution, contribution.running !== null);
    updateContributionIndex(this.partialContributions, key, contribution, contribution.partial !== null);
  }
  rebuildFinalized() {
    const finalized = [...this.finalizedContributions.values()].flatMap((value) => value.nodes).sort((left, right) => left.seq - right.seq);
    if (!sameReferences2(this.finalized, finalized)) this.finalized = finalized;
  }
  rebuildRunning() {
    const runningCalls = [...this.runningContributions.values()].sort((left, right) => left.anchorSeq - right.anchorSeq).flatMap((value) => value.running === null ? [] : [value.running]);
    if (!sameReferences2(this.runningCalls, runningCalls)) this.runningCalls = runningCalls;
  }
  rebuildPartial() {
    const partial = [...this.partialContributions.values()].sort((left, right) => left.anchorSeq - right.anchorSeq).findLast((value) => value.partial !== null)?.partial ?? null;
    if (this.partial?.blocks !== partial?.blocks || this.partial?.turn !== partial?.turn || this.partial?.step !== partial?.step) this.partial = partial;
  }
  updateTimeline(timeline) {
    if (this.timeline === timeline) return;
    this.timeline = timeline;
    const turnTimings = /* @__PURE__ */ new Map();
    const turnEnds = /* @__PURE__ */ new Map();
    for (const turn of timeline.turns.values()) {
      if (turn.start !== void 0) {
        turnTimings.set(turn.turn, {
          startTime: turn.start.time,
          ...turn.end === void 0 ? {} : { endTime: turn.end.time }
        });
      }
      if (turn.end !== void 0) turnEnds.set(turn.turn, turn.end.seq);
    }
    this.turnTimings = turnTimings;
    this.turnEnds = turnEnds;
  }
  snapshot() {
    return {
      nodes: this.finalized,
      turnTimings: this.turnTimings,
      turnEnds: this.turnEnds,
      partial: this.partial,
      runningCalls: this.runningCalls
    };
  }
};
function updateContributionIndex(index, key, contribution, present) {
  if (present) index.set(key, contribution);
  else index.delete(key);
}
function finalizedContributionChanged(previous, next) {
  const previousNodes = previous?.nodes ?? EMPTY_LIST;
  return !sameReferences2(previousNodes, next.nodes) || (previousNodes.length > 0 || next.nodes.length > 0) && previous?.anchorSeq !== next.anchorSeq;
}
function runningContributionChanged(previous, next) {
  return previous?.running !== next.running || (previous.running !== null || next.running !== null) && previous.anchorSeq !== next.anchorSeq;
}
function partialContributionChanged(previous, next) {
  return previous?.partial?.blocks !== next.partial?.blocks || previous?.partial?.turn !== next.partial?.turn || previous?.partial?.step !== next.partial?.step || ((previous?.partial ?? null) !== null || next.partial !== null) && previous?.anchorSeq !== next.anchorSeq;
}
var ChatSnapshotBuilder = class {
  store = new MutableChatNodeStore();
  locations = new MutableChatLocationIndex();
  navigation = new MutableTurnNavigationIndex();
  legacy = new LegacySliceBuilder();
  referenceLabels = new ReferenceLabelProjector();
  skillNames = new SkillNameProjector();
  order = EMPTY_KEYS;
  latestGroupInput;
  readGroupNode = (key) => this.store.get(key);
  readGroupTurn = (turn) => this.locations.getTurn(turn);
  readGroupPosition = (key) => this.locations.getPosition(key);
  /** Last published timeline: a Turn boundary can land without a new node. */
  timeline = null;
  empty;
  constructor() {
    this.empty = this.snapshot({ turnOrder: EMPTY_TURNS, turns: /* @__PURE__ */ new Map() });
    this.latestGroupInput = {
      kind: "replace",
      order: this.order,
      readNode: this.readGroupNode,
      readTurn: this.readGroupTurn,
      readPosition: this.readGroupPosition,
      timeline: this.empty.timeline
    };
  }
  replace(input) {
    const nodes = this.skillNames.replace(this.referenceLabels.replace(input.nodes));
    this.store.replace(nodes);
    this.order = orderedVisibleChatNodes(nodes).map((node) => node.key);
    this.locations.rebuild(this.order, this.store);
    this.store.replaceProcesses(this.order, this.locations);
    this.store.settleBottom(input.timeline.turnOrder, this.locations);
    this.navigation.rebuild(input.timeline, this.locations, this.store);
    this.timeline = input.timeline;
    this.latestGroupInput = {
      kind: "replace",
      order: this.order,
      readNode: this.readGroupNode,
      readTurn: this.readGroupTurn,
      readPosition: this.readGroupPosition,
      timeline: input.timeline
    };
    const snapshot = this.snapshot(input.timeline, this.legacy.replace(nodes, input.timeline));
    return snapshot;
  }
  apply(input) {
    const upserts = this.skillNames.apply(this.referenceLabels.apply(input.upserts, this.store), this.store);
    const processTurns = /* @__PURE__ */ new Set();
    let structural = false;
    const contentOnly = [];
    const changes = [];
    for (const node of upserts) {
      const previous = this.store.get(node.key);
      if (previous !== node) changes.push({ previous, current: node });
      const nodeStructural = previous === void 0 || previous.kind !== node.kind || previous.anchorSeq !== node.anchorSeq || previous.visibility !== node.visibility || previous.groupTree !== node.groupTree || locationIdentity(previous.location) !== locationIdentity(node.location);
      structural ||= nodeStructural;
      if (!nodeStructural) contentOnly.push(node);
      if (processPresentationInputChanged(previous, node, nodeStructural)) {
        const previousTurn = previous === void 0 ? void 0 : locationCoordinates(previous.location).turn;
        const nextTurn = locationCoordinates(node.location).turn;
        if (previousTurn !== void 0) processTurns.add(previousTurn);
        if (nextTurn !== void 0) processTurns.add(nextTurn);
      }
    }
    this.store.upsert(upserts);
    let changedTurnOrders = EMPTY_TURNS;
    if (structural) {
      const next = orderedVisibleChatNodes(this.store.values()).map((node) => node.key);
      this.order = sameReferences2(this.order, next) ? this.order : next;
      changedTurnOrders = this.locations.rebuild(this.order, this.store);
    }
    this.locations.touch(contentOnly);
    this.store.updateProcesses(processTurns, this.locations);
    this.store.settleBottom(input.timeline.turnOrder, this.locations);
    if (structural || input.timeline !== this.timeline) {
      this.navigation.rebuild(input.timeline, this.locations, this.store);
    } else {
      this.navigation.touch(turnsOf(contentOnly), this.locations, this.store);
    }
    this.timeline = input.timeline;
    this.latestGroupInput = {
      kind: "apply",
      changes,
      order: this.order,
      readNode: this.readGroupNode,
      readTurn: this.readGroupTurn,
      readPosition: this.readGroupPosition,
      timeline: input.timeline,
      changedTurns: input.changedTurns ?? EMPTY_TURNS,
      changedTurnOrders
    };
    const snapshot = this.snapshot(input.timeline, this.legacy.apply(upserts, input.timeline));
    return snapshot;
  }
  groupInput() {
    return this.latestGroupInput;
  }
  publish() {
    this.store.publish();
  }
  snapshot(timeline, legacy = this.legacy.replace(EMPTY_LIST, timeline)) {
    return {
      order: this.order,
      nodes: this.store,
      locations: this.locations,
      navigation: this.navigation,
      timeline,
      legacy
    };
  }
};
function turnsOf(nodes) {
  const turns = /* @__PURE__ */ new Set();
  for (const node of nodes) {
    const turn = locationCoordinates(node.location).turn;
    if (turn !== void 0) turns.add(turn);
  }
  return turns;
}
function locationIdentity(location) {
  const coordinates = locationCoordinates(location);
  return `${location.kind}:${coordinates.turn ?? ""}:${coordinates.step ?? ""}`;
}
var chatViewDefinition = {
  target: "chat",
  create: () => new ChatSnapshotBuilder(),
  isActive: (snapshot) => snapshot.order.some((key) => snapshot.nodes.get(key)?.kind !== "command")
};

// ../deepseek-harness/packages/util/brand/src/index.ts
function brandString(value) {
  return value;
}

// ../deepseek-harness/packages/client/ui-chat/src/client/reasoning-text.ts
function reasoningText(text) {
  if (text[0] !== "<") return text;
  const opening = "<signature>";
  if (opening.startsWith(text)) return "";
  if (!text.startsWith(opening)) return text;
  const closing = "</signature>";
  const end = text.indexOf(closing, opening.length);
  if (end === -1) return "";
  let start = end + closing.length;
  while (start < text.length) {
    if (text[start] === "\n") start++;
    else if (text[start] === "\r" && text[start + 1] === "\n") start += 2;
    else break;
  }
  return text.slice(start);
}

// ../deepseek-harness/packages/client/ui-chat/src/client/conversation-nodes/process-activity.ts
function activity(name) {
  if (name === "read") return "read";
  if (name === "read_image") return "readImage";
  if (name === "grep" || name === "glob" || name.endsWith("_inspect")) return "search";
  if (name === "write") return "write";
  if (name === "edit" || name === "apply_patch") return "edit";
  if (["bash", "pwsh", "exec_command", "write_stdin"].includes(name) || name.startsWith("terminal_")) return "commands";
  if (name === "run_code" || name === "cua_run_code") return "code";
  if (name === "web_search") return "webSearch";
  if (name === "web_fetch") return "webFetch";
  if (name === "subagent" || name.startsWith("subagent_")) return "subagents";
  if (["todo_write", "create_goal", "update_goal", "get_goal"].includes(name)) return "plan";
  if (name === "ask_user_question" || name === "request_user_input") return "questions";
  return "tools";
}
var LIVE_TOOL_DETAIL_MAX_CHARS = 160;
var LIVE_TOOL_DETAIL_PREFIX_CHARS = 512;
var LIVE_TOOL_DETAIL_SEGMENTER = new Intl.Segmenter(void 0, { granularity: "grapheme" });
var LIVE_TOOL_DETAIL_KEYS = [
  "title",
  "description",
  "objective",
  "task",
  "task_name",
  "name",
  "question",
  "questions",
  "prompt",
  "message",
  "command",
  "cmd",
  "queries",
  "query",
  "pattern",
  "url",
  "uri",
  "file_path",
  "path",
  "target",
  "action",
  "status"
];
function normalizeLiveToolText(text) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= LIVE_TOOL_DETAIL_MAX_CHARS) return { text: normalized, truncated: false };
  const chars = [];
  for (const { segment } of LIVE_TOOL_DETAIL_SEGMENTER.segment(normalized)) {
    if (chars.length === LIVE_TOOL_DETAIL_MAX_CHARS) {
      return {
        text: `${chars.slice(0, LIVE_TOOL_DETAIL_MAX_CHARS - 1).join("").trimEnd()}\u2026`,
        truncated: true
      };
    }
    chars.push(segment);
  }
  return { text: normalized, truncated: false };
}
function normalizeLiveToolDetail(value) {
  const text = typeof value === "string" ? value : Array.isArray(value) && value.every((item) => typeof item === "string") ? value.join(", ") : "";
  return normalizeLiveToolText(text).text;
}
function argumentTextDetail(args, key) {
  let limit = LIVE_TOOL_DETAIL_PREFIX_CHARS;
  while (true) {
    let prefix = args.textPrefix(key, limit);
    if (prefix === void 0) return void 0;
    const last = prefix.charCodeAt(prefix.length - 1);
    if (last >= 55296 && last <= 56319) {
      const extended = args.textPrefix(key, limit + 1);
      const next = extended.charCodeAt(prefix.length);
      if (next >= 56320 && next <= 57343) {
        prefix = extended;
        limit++;
      } else if (extended.length === prefix.length && !args.isSealed && !args.complete(key)) {
        prefix = prefix.slice(0, -1);
      }
    }
    const detail = normalizeLiveToolText(prefix);
    if (detail.truncated || !args.stringExceeds(key, limit)) return detail.text;
    limit *= 2;
  }
}
function questionDetail(value) {
  if (!Array.isArray(value)) return "";
  for (const item of value) {
    if (item === null || typeof item !== "object") continue;
    const detail = normalizeLiveToolDetail(Reflect.get(item, "question"));
    if (detail !== "") return detail;
  }
  return "";
}
function liveReasoningDetail(nodes) {
  for (let nodeIndex = nodes.length - 1; nodeIndex >= 0; nodeIndex--) {
    const node = nodes[nodeIndex];
    if (node?.kind !== "assistant-step" || node.data.status !== "running") continue;
    for (let blockIndex = node.data.blocks.length - 1; blockIndex >= 0; blockIndex--) {
      const block = node.data.blocks[blockIndex];
      if (block?.kind !== "reasoning") continue;
      const paragraphs = reasoningText(block.text).split(/\r?\n[\t ]*\r?\n/);
      for (let paragraphIndex = paragraphs.length - 1; paragraphIndex >= 0; paragraphIndex--) {
        const detail = normalizeLiveToolDetail(paragraphs[paragraphIndex]?.replaceAll("**", ""));
        if (detail !== "") return detail;
      }
    }
  }
  return "";
}
function liveToolDetail(name, args) {
  for (const key of LIVE_TOOL_DETAIL_KEYS) {
    if (!args.has(key)) continue;
    const detail = key === "questions" ? questionDetail(args.value(key)) : argumentTextDetail(args, key) ?? normalizeLiveToolDetail(args.value(key));
    if (detail !== "") return detail;
  }
  return args.closed() ? normalizeLiveToolDetail(name) : "";
}
function processActivity(nodes) {
  const counts = /* @__PURE__ */ new Map();
  const seen = /* @__PURE__ */ new Set();
  let running;
  let runningDetail = "";
  let runningTime = -Infinity;
  let preparing;
  const visit = (tool) => {
    if (seen.has(tool.callId)) return;
    seen.add(tool.callId);
    const call = isRunningTool(tool) ? tool : tool.call;
    if (call !== null) {
      const kind = activity(call.name);
      if (isRunningTool(tool) && tool.time >= runningTime) {
        running = kind;
        preparing = tool.phase === "preparing";
        runningDetail = liveToolDetail(tool.name, tool.args);
        runningTime = tool.time;
      }
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
    for (const child of tool.subCalls) visit(child);
  };
  for (const node of nodes) {
    if (node.kind === "tool-call") visit(node.data.root);
  }
  if (running === void 0) runningDetail = liveReasoningDetail(nodes);
  if (nodes.length > 0 && nodes.every((node) => node.kind === "context")) counts.set("context", nodes.length);
  return {
    counts: [...counts].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count),
    running,
    runningDetail,
    ...preparing ? { preparing: true } : {}
  };
}

// ../deepseek-harness/packages/client/ui-chat/src/client/conversation-nodes/process-groups.ts
function turnOf(node) {
  const location = node.location;
  return location.kind === "turn" || location.kind === "step" ? location.turn.turn : void 0;
}
function reasoning(node) {
  return node.kind === "assistant-step" && node.data.blocks.some((block) => block.kind === "reasoning" && block.text.trim() !== "");
}
function reply(node) {
  return node.kind === "assistant-step" && hasAssistantReplyContent(node.data.blocks);
}
function sameSummary(left, right) {
  return left.running === right.running && left.runningDetail === right.runningDetail && left.preparing === right.preparing && left.counts.length === right.counts.length && left.counts.every((value, index) => value.kind === right.counts[index]?.kind && value.count === right.counts[index].count);
}
function sameMembers(left, right) {
  return left.length === right.length && left.every((value, index) => value.key === right[index]?.key && value.groupPart === right[index].groupPart);
}
function structureChanged(previous, current2) {
  if (!isVisibleChatNode(current2) && (previous === void 0 || !isVisibleChatNode(previous))) return false;
  return previous === void 0 || previous.kind !== current2.kind || turnOf(previous) !== turnOf(current2) || isVisibleChatNode(previous) !== isVisibleChatNode(current2) || previous.groupTree !== current2.groupTree || reasoning(previous) !== reasoning(current2) || reply(previous) !== reply(current2);
}
function readNode(input, key) {
  const node = input.readNode(key);
  if (node === void 0) throw new Error(`Chat grouping input is missing Node ${key}`);
  return node;
}
var ProcessGroup = class {
  constructor(key, turn, members) {
    this.key = key;
    this.turn = turn;
    this.members = members;
    this.snapshot = { key, members, data: { turn, closed: false, summary: { counts: [], running: void 0, runningDetail: "" } } };
  }
  nodes = [];
  snapshot;
  refresh(input, closed) {
    const nodes = this.members.map((member) => readNode(input, member.key));
    const unchanged = nodes.length === this.nodes.length && nodes.every((node, index) => node === this.nodes[index]);
    const previous = this.snapshot.data;
    const activity2 = unchanged && previous.closed === closed ? previous.summary : processActivity(nodes);
    const summary2 = closed ? { counts: activity2.counts, running: void 0, runningDetail: "" } : activity2;
    this.nodes = nodes;
    if (previous.closed !== closed || !sameSummary(previous.summary, summary2)) {
      this.snapshot = {
        key: this.key,
        members: this.members,
        data: { turn: this.turn, closed, summary: summary2 }
      };
    }
  }
};
var TurnGroups = class {
  constructor(turn) {
    this.turn = turn;
  }
  groups = /* @__PURE__ */ new Map();
  membership = /* @__PURE__ */ new Map();
  roots = /* @__PURE__ */ new Map();
  references(key) {
    return this.roots.get(key) ?? [];
  }
  snapshots() {
    return [...this.groups.values()].map((group) => group.snapshot);
  }
  refresh(input, changed) {
    const dirty = /* @__PURE__ */ new Set();
    for (const node of changed) {
      const group = this.membership.get(node);
      if (group !== void 0) dirty.add(group);
    }
    const ended = input.timeline.turns.get(this.turn)?.status === "closed";
    if (ended) {
      for (const group of this.groups.values()) {
        if (!group.snapshot.data.closed) dirty.add(group.key);
      }
    }
    const upserts = [];
    for (const key of dirty) {
      const group = this.groups.get(key);
      const previous = group.snapshot;
      group.refresh(input, previous.data.closed || ended);
      if (group.snapshot !== previous) upserts.push(group.snapshot);
    }
    return upserts;
  }
  rebuild(input, added) {
    const roots = /* @__PURE__ */ new Map();
    const groups = /* @__PURE__ */ new Map();
    const membership = /* @__PURE__ */ new Map();
    let pending = [];
    const upserts = [];
    const emit = (key, entry) => {
      roots.set(key, [...roots.get(key) ?? [], entry]);
    };
    const flush = (closed) => {
      const first = pending[0];
      if (first === void 0) return;
      const retained = this.extendedGroup(pending, added);
      const key = retained?.key ?? brandString(JSON.stringify(["process", first.key, first.groupPart ?? null]));
      const previous2 = this.groups.get(key);
      const before = previous2?.snapshot;
      const group = previous2 !== void 0 && sameMembers(previous2.members, pending) ? previous2 : new ProcessGroup(key, this.turn, pending);
      group.refresh(input, closed || input.timeline.turns.get(this.turn)?.status === "closed");
      groups.set(group.key, group);
      emit(first.key, { kind: "group", key: group.key });
      for (const member of pending) membership.set(member.key, group.key);
      if (group.snapshot !== before) upserts.push(group.snapshot);
      pending = [];
    };
    let previous;
    let followed = false;
    for (const key of input.readTurn(this.turn)) {
      const position = readPosition(input, key);
      if (previous !== void 0 && position.previous !== previous) flush(true);
      previous = key;
      followed = position.next !== void 0;
      const node = readNode(input, key);
      if (isAtOrOutside(node, "process")) {
        flush(true);
        emit(key, { kind: "node", key });
      } else if (node.kind === "assistant-step") {
        if (reasoning(node)) pending.push({ kind: "node", key, groupPart: "reasoning" });
        if (reply(node)) {
          flush(true);
          emit(key, { kind: "node", key, groupPart: "response" });
        }
      } else pending.push({ kind: "node", key });
    }
    flush(followed);
    const removes = [...this.groups.keys()].filter((key) => !groups.has(key));
    this.groups = groups;
    this.membership = membership;
    this.roots = roots;
    return { upserts, removes };
  }
  extendedGroup(members, added) {
    const offset = members.findIndex((member) => !added.has(member.key));
    const first = members[offset];
    if (first === void 0) return void 0;
    const key = this.membership.get(first.key);
    const previous = key === void 0 ? void 0 : this.groups.get(key);
    if (previous === void 0 || offset + previous.members.length > members.length) return void 0;
    for (let index = 0; index < previous.members.length; index++) {
      const before = previous.members[index];
      const after = members[offset + index];
      if (before.key !== after.key || before.groupPart !== after.groupPart) return void 0;
    }
    for (let index = offset + previous.members.length; index < members.length; index++) {
      if (!added.has(members[index].key)) return void 0;
    }
    return previous;
  }
};
function readPosition(input, key) {
  const position = input.readPosition(key);
  if (position === void 0) throw new Error(`Chat grouping order is missing position for Node ${key}`);
  return position;
}
var ProcessState = class {
  turns = /* @__PURE__ */ new Map();
  order = [];
  pending = null;
  /**
   * Consume one synchronous Builder input without retaining its readers.
   * @param input - projected Node changes, indexed positions, and Turn lifecycle.
   */
  accept(input) {
    if (input.kind === "replace") {
      const previousKeys = new Set(this.order);
      const added2 = new Set(input.order.filter((key) => !previousKeys.has(key)));
      const turns = /* @__PURE__ */ new Map();
      for (const key of input.order) {
        const turn = readPosition(input, key).turn;
        if (turn === void 0 || turns.has(turn)) continue;
        const groups = this.turns.get(turn) ?? new TurnGroups(turn);
        groups.rebuild(input, added2);
        turns.set(turn, groups);
      }
      this.turns = turns;
      this.order = input.order;
      this.pending = {
        entries: this.rootEntries(input),
        groups: { kind: "replace", snapshots: [...turns.values()].flatMap((turn) => turn.snapshots()) }
      };
      return;
    }
    const regroup = new Set(input.changedTurnOrders);
    const added = /* @__PURE__ */ new Set();
    const changed = /* @__PURE__ */ new Map();
    const touch = (turn) => {
      let keys = changed.get(turn);
      if (keys === void 0) {
        keys = /* @__PURE__ */ new Set();
        changed.set(turn, keys);
      }
      return keys;
    };
    for (const change of input.changes) {
      const before = change.previous;
      const after = change.current;
      const turn = turnOf(after);
      if (before === void 0 || !isVisibleChatNode(before)) added.add(after.key);
      if (structureChanged(before, after)) {
        const previousTurn = before === void 0 ? void 0 : turnOf(before);
        if (previousTurn !== void 0) regroup.add(previousTurn);
        if (turn !== void 0) regroup.add(turn);
      }
      if (turn !== void 0) touch(turn).add(after.key);
    }
    for (const turn of input.changedTurns) touch(turn);
    const upserts = [];
    const removes = [];
    for (const turn of regroup) {
      const groups = this.turns.get(turn) ?? new TurnGroups(turn);
      const update = groups.rebuild(input, added);
      upserts.push(...update.upserts);
      removes.push(...update.removes);
      if (input.readTurn(turn).length === 0) this.turns.delete(turn);
      else this.turns.set(turn, groups);
    }
    for (const [turn, keys] of changed) {
      if (!regroup.has(turn)) upserts.push(...this.turns.get(turn)?.refresh(input, keys) ?? []);
    }
    const reordered = input.order !== this.order || regroup.size > 0;
    this.order = input.order;
    const installed = new Set(upserts.map((group) => group.key));
    this.pending = reordered || upserts.length > 0 || removes.length > 0 ? {
      ...reordered ? { entries: this.rootEntries(input) } : {},
      groups: { kind: "apply", upserts, removes: removes.filter((key) => !installed.has(key)) }
    } : null;
  }
  rootEntries(input) {
    return input.order.flatMap((key) => {
      const turn = readPosition(input, key).turn;
      if (turn === void 0) return [{ kind: "node", key }];
      const groups = this.turns.get(turn);
      if (groups === void 0) throw new Error(`Chat grouping order is missing Turn ${turn}`);
      return groups.references(key);
    });
  }
  /**
   * Read pending output without advancing State.
   * @returns the repeatable update for the last input batch.
   */
  output() {
    return this.pending;
  }
};
var processGroupDefinition = {
  kind: "process-groups",
  target: "chat",
  create: () => new ProcessState(),
  update: (context, input) => {
    context.state.accept(input);
    return context.state;
  },
  buildGroups: (context) => context.state.output()
};

// ../deepseek-harness/packages/core/session/src/surface.ts
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
function isAppendSurfaceEvent(event) {
  return isSurfaceEvent(event) && event.surfaceOp === "append";
}
function isReplacementSurfaceEvent(event) {
  return isSurfaceEvent(event) && event.surfaceOp !== "append";
}

// ../deepseek-harness/packages/client/ui-chat/src/client/conversation-nodes/message.ts
function isCompactionCheckpoint(event) {
  if (event.type !== "user/message" || !isReplacementSurfaceEvent(event)) return false;
  const source = event.data.source;
  return source.kind === "compact-checkpoint";
}
function contextMessage(event, message) {
  return {
    kind: "context",
    seq: event.seq,
    time: event.time,
    content: message.content,
    source: message.source,
    producer: contextProducer(message.source),
    form: contextForm(message.source)
  };
}
function followsProcessEvidence(location, reader) {
  if (location.kind !== "turn" && location.kind !== "step") return false;
  return reader.previous("process-evidence")?.state.turn === location.turn.turn;
}
var messageDefinition = {
  kind: "input-message",
  target: "chat",
  match: (event) => {
    if (event.type === "user/message") {
      return isAppendSurfaceEvent(event) && !isCompactionCheckpoint(event) ? { id: String(event.data.id), role: "start" } : null;
    }
    return null;
  },
  start: (_context, match, reader) => {
    const event = match.event;
    if (event.type !== "user/message") throw new Error("input-message start requires user/message");
    if (event.data.source.kind !== "user") {
      const nextTurn = reader.previous("inbox-next-turn")?.state;
      const nextStep = reader.previous("inbox-next-step")?.state;
      const location = match.location;
      const turnStart = location.kind === "step" ? location.turn.start?.seq : void 0;
      const idleSteer = location.kind === "step" && location.step.step === 1 && turnStart !== void 0 && (nextStep?.claimSeq ?? -1) > turnStart && (nextTurn?.claimSeq ?? -1) < turnStart && nextStep !== void 0 && nextStep.firstClaimedHuman === void 0 && nextStep.currentClaimed.has(String(event.data.id));
      return {
        ...contextMessage(event, event.data),
        waking: nextTurn?.currentClaimed.has(String(event.data.id)) === true || idleSteer
      };
    }
    const id = String(event.data.id);
    const claim = reader.previous("inbox-next-step")?.state;
    return claim?.currentClaimed.has(id) === true ? {
      kind: "steering",
      messageId: event.data.id,
      seq: event.seq,
      time: event.time,
      content: event.data.content,
      source: event.data.source,
      ...claim.firstClaimedHuman === id && followsProcessEvidence(match.location, reader) ? { batchStart: true } : {}
    } : {
      kind: "user",
      messageId: event.data.id,
      seq: event.seq,
      time: event.time,
      content: event.data.content,
      source: event.data.source
    };
  },
  update: (context) => context.state,
  buildViewNode: (context) => {
    if (context.state === void 0) return null;
    const location = contextLocation(context);
    if (context.state.kind === "context" && context.start?.event.type === "user/message" && context.start.event.data.source.kind === "retry" && context.start.event.data.content.length === 0) {
      return chatNode(context, "turn-trigger", context.state.seq, context.state, { location, groupTree: "input" });
    }
    const waking = context.state.kind === "context" && context.start?.event.type === "user/message" && context.state.waking === true;
    const human = context.state.kind === "user" || context.state.kind === "steering";
    const opensExchange = human && location.kind === "step" && location.step.step === 1;
    return chatNode(
      context,
      waking ? "turn-trigger" : context.state.kind,
      context.state.seq,
      context.state,
      { location, groupTree: opensExchange ? "exchange" : human || waking ? "input" : void 0 }
    );
  }
};
var developerMessageDefinition = {
  ...messageDefinition,
  kind: "developer-message",
  match: (event) => event.type === "developer/message" ? { id: String(event.data.message.id), role: "start" } : null,
  start: (_context, match) => {
    const event = match.event;
    if (event.type !== "developer/message") throw new Error("developer-message start requires developer/message");
    return contextMessage(event, event.data.message);
  }
};

// ../deepseek-harness/packages/client/ui-chat/src/client/conversation-nodes/tool.ts
var MAX_DEPTH = 256;
var projectedBlocks = /* @__PURE__ */ new WeakMap();
function jsonArguments(value) {
  return JSON.stringify(value);
}
function rootCall(match, previous) {
  if (match.event.type !== "tool/call") throw new Error("tool-call start requires tool/call");
  return {
    phase: "start",
    callId: String(match.event.data.callId),
    name: match.event.data.name,
    argsRaw: match.event.data.arguments,
    args: previous === void 0 ? PartialArguments.fromText(match.event.data.arguments) : previous.args.settle(match.event.data.arguments),
    turn: match.event.data.turn,
    step: match.event.data.step,
    time: match.event.time,
    subCalls: []
  };
}
function applyDelta(state, match) {
  const event = match.event;
  if (event.type !== "assistant/live-chunk") return state;
  const chunk = event.data.chunk;
  const root = state.root;
  if (chunk.type === "block-end" && chunk.block.type === "tool-call") {
    if (root === void 0 || "kind" in root || root.phase !== "preparing") return state;
    return { ...state, root: { ...root, name: chunk.block.name, args: root.args.settle(chunk.block.arguments) } };
  }
  if (chunk.type !== "tool-call-delta") return state;
  if (root === void 0) {
    if (!chunk.name) return state;
    const args = new PartialArguments();
    args.append(chunk.argumentsDelta);
    return {
      ...state,
      root: {
        phase: "preparing",
        callId: String(chunk.id),
        name: chunk.name,
        turn: event.data.turn,
        step: event.data.step,
        time: event.time,
        subCalls: [],
        args
      }
    };
  }
  if ("kind" in root || root.phase !== "preparing" || root.args.isSealed) return state;
  root.args.append(chunk.argumentsDelta);
  return state;
}
function preparingBlock(root, current2) {
  const changed = root.args.refresh();
  if (!changed && current2 !== void 0 && !("kind" in current2) && current2.phase === "preparing" && current2.name === root.name && current2.args === root.args) return current2;
  return changed ? { ...root } : root;
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
function childCall(match, data) {
  return {
    phase: "start",
    callId: data.subCallId,
    parentCallId: data.parentCallId,
    name: data.name,
    argsRaw: jsonArguments(data.arguments),
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
    args: previous !== void 0 && !("kind" in previous) ? previous.args : PartialArguments.fromObject(data.arguments),
    call: { name: data.name, argsRaw: jsonArguments(data.arguments) },
    callTime: previous?.time ?? null,
    content: data.content ?? [],
    meta: data.meta,
    isError: data.isError === true,
    ...data.error === void 0 ? {} : { error: data.error },
    subCalls: []
  };
}
function locationTurn(match) {
  return match.location.kind === "step" || match.location.kind === "turn" ? match.location.turn.turn : 0;
}
function locationStep(match) {
  return match.location.kind === "step" ? match.location.step.step : 0;
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
      pending.push({ callId: nested.callId, depth: candidate.depth + 1 });
    }
  }
  return parentDepth + subtreeDepth <= MAX_DEPTH;
}
function updateDispatch(state, match) {
  const event = match.event;
  if (event.type !== "tool/ptc-dispatch-start" && event.type !== "tool/ptc-dispatch") return state;
  const data = event.data;
  const parentCallId = String(data.parentCallId);
  const subCallId = String(data.subCallId);
  const siblings = state.children.get(parentCallId) ?? [];
  const index = siblings.findIndex((candidate) => candidate.callId === subCallId);
  if (event.type === "tool/ptc-dispatch-start") {
    if (index >= 0 || !acceptsEdge(state, parentCallId, subCallId)) return state;
    const children2 = new Map(state.children);
    children2.set(parentCallId, [...siblings, childCall(match, data)]);
    const parents2 = new Map(state.parents);
    parents2.set(subCallId, parentCallId);
    return { ...state, children: children2, parents: parents2 };
  }
  if (index < 0 && !acceptsEdge(state, parentCallId, subCallId)) return state;
  const previous = index < 0 ? void 0 : siblings[index];
  const settled = childResult(match, data, previous);
  const children = new Map(state.children);
  children.set(parentCallId, index < 0 ? [...siblings, settled] : siblings.map((child, at) => at === index ? settled : child));
  const parents = new Map(state.parents);
  if (index < 0) parents.set(subCallId, parentCallId);
  return { ...state, children, parents };
}
function projectBlock(block, state, interruptedAt, visited = /* @__PURE__ */ new Set(), depth = 1) {
  if (!("kind" in block) && block.phase === "preparing") return block;
  if (visited.has(block.callId) || depth > MAX_DEPTH) return { ...block, subCalls: [] };
  const nextVisited = new Set(visited);
  nextVisited.add(block.callId);
  const children = (state.children.get(block.callId) ?? block.subCalls).map((child) => projectBlock(child, state, interruptedAt, nextVisited, depth + 1));
  const interruptionSeq = "kind" in block ? void 0 : interruptedAt?.seq;
  const interruptionTime = "kind" in block ? void 0 : interruptedAt?.time;
  const cached = projectedBlocks.get(block);
  if (cached !== void 0 && cached.interruptionSeq === interruptionSeq && cached.interruptionTime === interruptionTime && sameReferences3(cached.children, children)) {
    return cached.value;
  }
  const projected = "kind" in block || interruptedAt === void 0 ? sameReferences3(block.subCalls, children) ? block : { ...block, subCalls: children } : {
    kind: "tool-result",
    seq: interruptedAt.seq + CHAT_SYNTHETIC_SEQ_OFFSETS.interruptedFollowup,
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
    subCalls: children
  };
  projectedBlocks.set(block, { children, interruptionSeq, interruptionTime, value: projected });
  return projected;
}
function sameReferences3(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
function interruption(context) {
  const location = context.start?.location;
  if (location?.kind === "step" && location.step.status === "closed") return location.step.end;
  if ((location?.kind === "step" || location?.kind === "turn") && location.turn.status === "closed") {
    return location.turn.end;
  }
  return void 0;
}
function fallbackState3(context) {
  const match = context.matches.find((candidate) => candidate.event.type === "tool/result");
  const root = match === void 0 ? void 0 : rootResult(match);
  if (root === void 0) return void 0;
  let state = { root, children: /* @__PURE__ */ new Map(), parents: /* @__PURE__ */ new Map() };
  for (const candidate of context.matches) state = updateDispatch(state, candidate);
  return state;
}
var toolDefinition = {
  kind: "tool-call",
  target: "chat",
  match: (event) => {
    if (event.type === "assistant/live-chunk") {
      const chunk = event.data.chunk;
      if (chunk.type === "block-end" && chunk.block.type === "tool-call") {
        return { id: String(chunk.block.id), role: "start" };
      }
      return chunk.type === "tool-call-delta" ? { id: String(chunk.id), role: "start" } : null;
    }
    if (event.type === "tool/call") return { id: String(event.data.callId), role: "start" };
    if (event.type === "tool/result" && isAppendSurfaceEvent(event)) {
      return { id: String(event.data.message.source.callId), role: "update" };
    }
    if (event.type === "tool/ptc-dispatch-start" || event.type === "tool/ptc-dispatch") {
      const rootCallId = event.data.rootCallId;
      return typeof rootCallId === "string" && rootCallId !== "" ? { id: rootCallId, role: "update" } : null;
    }
    return null;
  },
  start: (_context, match) => {
    const state = { root: void 0, children: /* @__PURE__ */ new Map(), parents: /* @__PURE__ */ new Map() };
    return match.event.type === "tool/call" ? { ...state, root: rootCall(match) } : applyDelta(state, match);
  },
  update: (context, match) => {
    if (match.event.type === "assistant/live-chunk") return applyDelta(context.state, match);
    if (match.event.type === "tool/call") return { ...context.state, root: rootCall(match, context.state.root) };
    if (match.event.type === "tool/result") {
      const root = context.state.root;
      const running = root !== void 0 && !("kind" in root) && root.phase === "start" ? root : void 0;
      const result = rootResult(match, running);
      return result === void 0 ? context.state : { ...context.state, root: result };
    }
    return updateDispatch(context.state, match);
  },
  publication: (match) => match.event.type === "assistant/live-chunk" ? "animation-frame" : "immediate",
  buildViewNode: (context) => {
    const current2 = context.current.get("chat");
    const state = context.state ?? fallbackState3(context);
    if (state?.root === void 0) {
      return current2 == null ? null : current2.visibility === "hidden" ? current2 : { ...current2, visibility: "hidden" };
    }
    const interruptedAt = interruption(context);
    const root = !("kind" in state.root) && state.root.phase === "preparing" ? preparingBlock(state.root, current2?.data.root) : state.root;
    const projected = projectBlock(root, state, interruptedAt);
    const anchor = context.start?.event.seq ?? ("kind" in state.root ? state.root.seq : context.matches[0]?.event.seq ?? 0);
    const preparing = !("kind" in projected) && projected.phase === "preparing";
    const visibility = preparing && interruptedAt !== void 0 ? "hidden" : "visible";
    const location = contextLocation(context);
    const data = current2?.data.root === projected ? current2.data : { root: projected };
    if (current2?.data === data && current2.anchorSeq === anchor && current2.visibility === visibility && current2.location === location) return current2;
    return chatNode(context, "tool-call", anchor, data, { visibility, location });
  }
};

// ../deepseek-harness/packages/llm/llm/src/assistant-stream.ts
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

// ../deepseek-harness/packages/api/session-controller/src/client/sessions/assistant-stream.ts
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

// qa/_chat-process-audit/original.ts
function original(entries, metrics) {
  const definitions = [messageDefinition, assistantDefinition, turnProcessDefinition, processEvidenceDefinition, toolDefinition];
  const assembler = new ConversationNodeAssembler({ entries: () => definitions, fallbackEntry: () => void 0 }, { entries: () => [metrics ? { ...chatViewDefinition, create: () => {
    const b = chatViewDefinition.create();
    const replace = b.replace.bind(b), apply = b.apply.bind(b);
    b.replace = (input) => {
      metrics.replaceCalls = (metrics.replaceCalls ?? 0) + 1;
      return replace(input);
    };
    b.apply = (input) => {
      metrics.applyCalls = (metrics.applyCalls ?? 0) + 1;
      metrics.nodeUpserts = (metrics.nodeUpserts ?? 0) + input.upserts.length;
      const turns = new Set(input.changedTurns ?? []);
      for (const n of input.upserts) {
        if (n.data.turn !== void 0) turns.add(n.data.turn);
      }
      metrics.affectedTurnUpdates = (metrics.affectedTurnUpdates ?? 0) + turns.size;
      return apply(input);
    };
    const values = b.legacy.finalizedContributions.values.bind(b.legacy.finalizedContributions);
    b.legacy.finalizedContributions.values = function* () {
      for (const v of values()) {
        metrics.legacyFinalizedEntriesRead = (metrics.legacyFinalizedEntriesRead ?? 0) + 1;
        yield v;
      }
    };
    return b;
  } } : chatViewDefinition] }, { entries: () => [processGroupDefinition], forTarget: (t) => t === "chat" ? processGroupDefinition : void 0 });
  assembler.replaceWindow(entries, false);
  assembler.activateTarget("chat");
  assembler.flush();
  return assembler;
}
function summary(a) {
  const s = a.snapshot("chat"), t = s.timeline.turns.get(1);
  return { process: t?.data.get("turn-process"), turnStatus: t?.status, steps: t?.steps.map((x) => ({ step: x.step, status: x.status })), nodes: s.nodes.values().map((n) => ({ key: n.key, kind: n.kind, anchorSeq: n.anchorSeq, visibility: n.visibility, status: n.data.status, step: n.data.step, blocks: n.data.blocks, final: n.data.finalNode })), grouped: a.grouped("chat")?.entries.map((e) => e.kind === "group" ? { ...e, group: a.grouped("chat").groupSource(e.key).getSnapshot() } : e) };
}
function metadataOriginal(entries, metrics = {}) {
  const definitions = [messageDefinition, assistantDefinition, turnProcessDefinition, processEvidenceDefinition, toolDefinition];
  const take = (input, baseline) => {
    metrics[baseline ? "replaceCalls" : "applyCalls"] = (metrics[baseline ? "replaceCalls" : "applyCalls"] ?? 0) + 1;
    metrics.nodeUpserts = (metrics.nodeUpserts ?? 0) + (baseline ? input.nodes.length : input.upserts.length);
    const turns = new Set(input.changedTurns ?? []);
    for (const n of baseline ? input.nodes : input.upserts) {
      if (n.data.turn !== void 0) turns.add(n.data.turn);
    }
    metrics.affectedTurnUpdates = (metrics.affectedTurnUpdates ?? 0) + turns.size;
    return { timeline: input.timeline };
  };
  const view = { target: "chat", create: () => ({ empty: { timeline: { turns: /* @__PURE__ */ new Map() } }, replace: (x) => take(x, true), apply: (x) => take(x, false), publish: () => {
  } }) };
  const assembler = new ConversationNodeAssembler({ entries: () => definitions, fallbackEntry: () => void 0 }, { entries: () => [view] });
  assembler.replaceWindow(entries, false);
  assembler.activateTarget("chat");
  assembler.flush();
  return assembler;
}
export {
  ClientAssistantStream,
  metadataOriginal,
  original,
  summary
};
