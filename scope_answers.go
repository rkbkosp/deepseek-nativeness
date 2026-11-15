package main

import "fmt"

// Host answers that stay valid for a connection epoch are remembered per scope.
// The original client keeps these in stores and refreshes them from Host
// invalidation rows; re-reading them per Session switch cost several round
// trips each time, including a remoteAccess stream for the capability answer.
//
// Scope keys carry the account, Host and connection generation, so a reconnect
// or an identity change can never read another epoch's answer. Session and
// Workspace are part of the key where the answer depends on them: capability
// grants name either resource, and the command catalog is read for one agent.
type scopeAnswers struct {
	capabilities map[string]map[string]operationCapability
	modelCatalog map[string]composerModelCatalog
	permissions  map[string][]settingsPermissionOption
	commands     map[string][]composerCommand
}

func (a *app) hostScope() string {
	return fmt.Sprintf("%s\x00%s\x00%d", a.accountScope, a.hostID, a.remoteGeneration)
}

func (a *app) sessionScope() string {
	return a.hostScope() + "\x00" + a.workspaceID + "\x00" + a.sessionID
}

func (a *app) scopeCacheState() *scopeAnswers {
	if a.scopeCache == nil {
		a.scopeCache = &scopeAnswers{
			capabilities: map[string]map[string]operationCapability{},
			modelCatalog: map[string]composerModelCatalog{},
			permissions:  map[string][]settingsPermissionOption{},
			commands:     map[string][]composerCommand{},
		}
	}
	return a.scopeCache
}

// invalidateScopeAnswers drops every remembered answer. A Host invalidation row
// (adapters, settings, credentials), a new connection epoch and an identity
// change are the events that can make these answers stale.
func (a *app) invalidateScopeAnswers() {
	a.scopeCache = nil
}

func (a *app) rememberCapabilities(scope string, caps map[string]operationCapability) {
	a.scopeCacheState().capabilities[scope] = caps
}

// applyCachedCapabilities restores the last answer for exactly this Host,
// Workspace and Session instead of opening another remoteAccess stream. A grant
// revoked without an invalidation row still fails closed at the Host, which
// revalidates every write and returns a rejected receipt.
func (a *app) applyCachedCapabilities() bool {
	if a.scopeCache == nil {
		return false
	}
	caps, ok := a.scopeCache.capabilities[a.sessionScope()]
	if !ok {
		return false
	}
	a.operationCaps = caps
	return true
}

func (a *app) rememberModelCatalog(scope string, catalog composerModelCatalog) {
	a.scopeCacheState().modelCatalog[scope] = catalog
}

func (a *app) rememberPermissionCatalog(scope string, options []settingsPermissionOption) {
	a.scopeCacheState().permissions[scope] = options
}

func (a *app) rememberCommands(scope string, commands []composerCommand) {
	a.scopeCacheState().commands[scope] = commands
}
