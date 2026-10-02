# VSIX Inspector

Inspect a `.vsix` file from VS Code: installed size breakdown, files a
working `.vscodeignore` usually excludes but which shipped anyway,
`node_modules` directories a bundler should have inlined but didn't, and the
declared license of the extension and of any surviving dependencies.

## Usage

Right-click any `.vsix` file in the Explorer and choose **Inspect VSIX**, or
run the **Inspect VSIX** command from the Command Palette and pick a file.

## Development

```bash
npm install
npm run build      # bundle src/extension.ts -> dist/extension.js
npm test           # type-check + run the analyzer test suite
```

Press F5 in VS Code to launch an Extension Development Host with the
extension loaded.
