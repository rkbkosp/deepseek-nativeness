/** Fence pure upstream controllers whose original service owner supplied disposal. */
export function createPageLifetime() {
  let active = true;
  const disposers = new Set<() => void>();
  return {
    get active() {
      return active;
    },
    own(dispose: () => void) {
      if (active) disposers.add(dispose);
      else dispose();
    },
    guardStore(source: any) {
      if (!source || typeof source.getSnapshot !== "function")
        throw Error("Frozen controller store seam changed");
      for (const method of ["set", "update"])
        if (typeof source[method] === "function") {
          const original = source[method].bind(source);
          source[method] = (...args: any[]) => {
            if (active) return original(...args);
          };
        }
      const subscribe = source.subscribe.bind(source);
      source.subscribe = (listener: () => void) => {
        if (!active) return () => {};
        let disposed = false;
        const stop = subscribe(() => {
          if (active) listener();
        });
        const off = () => {
          if (disposed) return;
          disposed = true;
          disposers.delete(off);
          stop();
        };
        disposers.add(off);
        return off;
      };
      return source;
    },
    dispose() {
      if (!active) return;
      active = false;
      for (const off of [...disposers]) off();
      disposers.clear();
    },
  };
}
