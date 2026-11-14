# Native DSH Remote client

This directory contains the new client. `../deepseek-harness`, `../mygo`, the installed Desktop application, `~/.dsh`, and its Remote plugin are frozen references: do not modify, update, restart, migrate, or reconfigure them.

All connections use the existing Remote protocol and permissions. Client identity and preferences use a separate application directory. Never log credentials or copy them into fixtures. Do not approve, interrupt, or send messages to existing sessions as a smoke test.

Preserve the DSH visual language and animation timing. The running indicator has a shared 1.5 second rotation and SVG-equivalent breathing arc. Animation must use paint-only scheduling, not a polling goroutine or per-frame business state updates. WebViews are created on demand and destroyed when closed.

Use Go 1.27.3 or newer and the local MyGo module through the declared `replace`. Build with CGO disabled. Report simulated tests separately from actual Remote and screen verification. No publication or deployment is authorized.
