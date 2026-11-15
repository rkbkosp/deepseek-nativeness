/**
 * The native client's method surface, carried by the local Host.
 *
 * `RemoteAdapter` owns the whole presentation contract: method dispatch, the
 * session projection, notification scoping and the mutation ledger. None of
 * that is Remote-server specific. The only part that is, is the carrier: the
 * frozen client reaches a Host over a Remote server (identity, devices, WebRTC),
 * while a Host this shell started answers the same Typert Remote surface on
 * loopback HTTP and `/api/remote.mux`.
 *
 * `LocalAdapter` therefore replaces the carrier and nothing else. The frozen
 * `RemoteTypertGateway` is reused unchanged over `LocalTransport`, because it
 * only needs the `rpc`/`onEvent`/`onClose`/`close` subset that the transport
 * implements.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RemoteAdapter } from "./client.mjs";
import {
  connectLocalHost,
  LOCAL_ACCOUNT_SCOPE,
  LOCAL_HOST_ID,
} from "./local-transport.mjs";

/** The Host's session wire format; the local runtime is the same release. */
const LOCAL_SESSION_FORMAT = 3;

function runtimeVersion(runtimeRoot) {
  try {
    const descriptor = JSON.parse(
      readFileSync(join(runtimeRoot, "dsh", "desktop-runtime.json"), "utf8"),
    );
    return typeof descriptor?.release?.version === "string"
      ? descriptor.release.version
      : undefined;
  } catch {
    return undefined;
  }
}

export class LocalAdapter extends RemoteAdapter {
  /**
   * @param emit - notification sink in the stdio protocol's shape.
   * @param options.url - the Host's `ready` URL, including its launch token.
   * @param options.runtimeRoot - the vendored runtime root holding the official
   *   stream-protocol and `ws` builds.
   * @param options.fetchImpl - transport override for tests.
   * @param options.webSocketImpl - transport override for tests.
   */
  constructor(emit = () => {}, options = {}) {
    super(emit);
    this.local = {
      url: options.url,
      runtimeRoot: options.runtimeRoot,
      fetchImpl: options.fetchImpl,
      webSocketImpl: options.webSocketImpl,
      inject: options.inject,
    };
    this.version = runtimeVersion(options.runtimeRoot);
    this.transport = undefined;
    // Local mode has no account system: the owner Peer always answers.
    this.authenticated = true;
    this.identityScope = LOCAL_ACCOUNT_SCOPE;
    this.identity = { deviceId: LOCAL_HOST_ID };
    this.server = {
      baseUrl: options.url ? new URL(options.url).origin : "local://host",
      close() {},
      async hasStoredAuthorization() {
        return true;
      },
    };
    // `RemoteAdapter.connect` only asks the connector for a carrier.
    this.connector = { connect: () => this.connectLocalHost() };
  }

  /** Configuration is the Host's own; nothing to configure or persist. */
  ensureConfigured() {}

  async configure() {
    return { ...this.status(), storageDirectory: "" };
  }

  async authStatus() {
    return { ...this.status(), authorized: true };
  }

  async authProviders() {
    return [];
  }

  /** One synthetic device: the Host this shell started. */
  async devices() {
    this.authenticated = true;
    return [
      {
        id: LOCAL_HOST_ID,
        name: this.deviceName(),
        online: true,
        platform: process.platform,
      },
    ];
  }

  deviceName() {
    return this.version ? `本地 Host · dsh ${this.version}` : "本地 Host";
  }

  /** Open the local carrier, shaped like the frozen connector's result. */
  async connectLocalHost() {
    if (this.transport !== undefined) await this.transport.close();
    const transport = await connectLocalHost({
      url: this.local.url,
      runtimeRoot: this.local.runtimeRoot,
      fetchImpl: this.local.fetchImpl,
      webSocketImpl: this.local.webSocketImpl,
      inject: this.local.inject,
    });
    this.transport = transport;
    return {
      client: transport,
      features: { remoteGateway: true, sessionFormat: LOCAL_SESSION_FORMAT },
      harnessVersion: this.version,
      target: {
        hostId: LOCAL_HOST_ID,
        name: this.deviceName(),
        origin: transport.origin,
      },
    };
  }

  async connect(hostId) {
    if (hostId !== undefined && hostId !== LOCAL_HOST_ID)
      throw Object.assign(new Error("本地模式只有一个 Host。"), {
        code: "HOST_NOT_FOUND",
        delivery: "rejected",
      });
    return super.connect(LOCAL_HOST_ID, {});
  }

  status() {
    const status = super.status();
    return {
      ...status,
      backend: "local-mux",
      protocol: "dsh-host@local",
      serverUrl: this.local.url ? new URL(this.local.url).origin : "local://host",
      deviceName: this.deviceName(),
      runtimeVersion: this.version ?? "",
    };
  }

  async close() {
    await super.close();
    const transport = this.transport;
    this.transport = undefined;
    if (transport !== undefined) await transport.close().catch(() => {});
  }
}
