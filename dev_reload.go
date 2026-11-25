package main

// reloadPage is the dev-only "Reload page" command: it drops a compatibility
// page and re-reads the catalogs the native view renders from, without
// restarting the Host or losing the Session selection.
func (a *app) reloadPage() {
	a.closeCompat()
	a.fetchWorkspaces()
	a.fetchSessions()
	a.fetchSchedules()
	a.error = ""
}
