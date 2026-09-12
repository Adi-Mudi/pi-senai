# My Pi Extension

A skeleton for a Pi extension. Replace this paragraph with a one-line description.

## Install

```bash
# Local development (symlink into Pi's global extensions)
ln -sf "$(pwd)" ~/.pi/agent/extensions/my-pi-extension

# Then restart Pi or run `/reload`.

# Or distribute via npm
npm install @scope/my-pi-extension
```

## Develop

```bash
npm install
npm run build
npm test
```

## Publish

```bash
npm publish
```

Pi discovers the extension automatically via the `pi` key in `package.json`.

## Reference

- [Pi extension docs](https://pi.dev/docs/latest/skills)
- [Extension API reference](https://app.unpkg.com/@mariozechner/pi-coding-agent@latest/files/docs/extensions.md)
- [Package manifest spec](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/packages.md)