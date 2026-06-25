# XanaNode Workspace Substrate

This folder is the explicit substrate source generated from the XanaNode Workspace repository.

It exists so higher layers can federate with Workspace as a normal substrate instead of inferring Workspace facts ad hoc.

Regenerate it from the repository root with:

```powershell
node tools/build-substrate-source.mjs
```

Or from `XanaNode-Master`:

```powershell
npm run workspace:build-substrate-source
```
