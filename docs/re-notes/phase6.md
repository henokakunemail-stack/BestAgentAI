# Phase 6: Providers panel (Claude, ChatGPT, Antigravity, 9router)

## Decisions
- Login happens in the provider page or the 9router dashboard. The app never reads or imitates tokens of other apps (`~/.claude`, `~/.codex`, Antigravity).
- One Anthropic SDK client. `provider: '9router'` only adds `baseURL` (`agent/clientFactory.ts`); 9router translates to OpenAI/Gemini.
- Buttons: Claude opens console.anthropic.com keys; ChatGPT and Antigravity switch to 9router mode and open `<base>/dashboard`; 9router shows base URL + key, Test, Open dashboard.
- `providers:open` takes a fixed target name, never a URL from the renderer; router base URL is re-validated (http/https only).
- `providers:test` = `GET {base}/v1/models`; ids fill the model datalist.

## Limitations
- `thinking: adaptive` is off in 9router mode. `cache_control` blocks are still sent; non-Claude models may ignore or reject them.
- Tool-use fidelity on non-Claude models is untested with a real model call (no key supplied).
- No logout in-app; disconnect accounts in the 9router dashboard.
- Claude subscription login is not supported directly, only API key or via 9router.
- First `/v1/models` call can exceed the 8s timeout while 9router warms up.
- Warning shown for non-loopback `http` base URL (key travels unencrypted).

## Verified
- typecheck, selfcheck (normalizeBaseUrl, clientConfig, parseModelIds, isLoopback), build.
- CDP against built app: Test OK (1715 models, datalist filled), dead URL error, `ftp://` rejected, unknown open target rejected, `file://` base rejected.
- Not verified: 401 path (local 9router has no key requirement), real chat through 9router, browser actually opening.
